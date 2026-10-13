import type { Prisma } from '@prisma/client';
import { prisma, withTransaction, type TransactionClient } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import { assertPermission, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { addWorkingDays, evaluateSla, type SlaCalendar } from '@/server/domain/sla/sla-engine';
import { logger } from '@/lib/logger';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { HolidayInput, SlaPolicyInput } from '@/lib/validation/sla';
import { invalidateConfigurationCache, loadHolidays, loadSlaPolicy } from './configuration-service';
import type { AuditContextInput } from './admin-service';
import { caseScopeFilter } from './dashboard-service';
import { dispatchCaseEvents } from './notification-dispatch';

/**
 * SLA tracking (spec section 22; roadmap Phase 7).
 *
 * The clock starts when a request reaches the department, pauses while the case
 * is back with the requester, and closes on completion or cancellation. The
 * sweep below re-evaluates every open record against the configured calendar,
 * stores the state and the working-day figures, and raises "approaching" and
 * "breached" notifications once each - on the change, never on every pass.
 */

export async function calendarFor(policy: {
  workingDaysOfWeek: unknown;
  countCalendarDays: boolean;
}): Promise<SlaCalendar> {
  const holidays = await loadHolidays();
  return {
    workingDaysOfWeek: Array.isArray(policy.workingDaysOfWeek)
      ? (policy.workingDaysOfWeek as number[])
      : [1, 2, 3, 4, 5],
    holidays: new Set(
      holidays.map((h) => {
        const key = h.date.toISOString().slice(0, 10);
        return h.isRecurring ? key.slice(5) : key;
      }),
    ),
    countCalendarDays: policy.countCalendarDays,
  };
}

/** Open the case's SLA record when it reaches the department. */
export async function openSlaRecord(
  tx: TransactionClient,
  caseId: string,
  startedAt: Date,
): Promise<void> {
  const policy = await tx.slaPolicy.findFirst({ where: { code: 'STANDARD', isActive: true } });
  if (!policy) return;
  const calendar = await calendarFor(policy);
  await tx.slaRecord.upsert({
    where: { caseId },
    update: {},
    create: {
      caseId,
      policyId: policy.id,
      startedAt,
      dueAt: addWorkingDays(startedAt, policy.totalWorkingDays, calendar),
      status: 'GREEN',
    },
  });
}

/** Stop the clock while the request is back with the requester (assumption 4.3). */
export async function pauseSla(
  tx: TransactionClient,
  caseId: string,
  reason: string,
  at: Date,
): Promise<void> {
  const record = await tx.slaRecord.findUnique({ where: { caseId }, select: { id: true } });
  if (!record) return;
  const open = await tx.slaPause.findFirst({ where: { slaRecordId: record.id, resumedAt: null } });
  if (open) return;
  await tx.slaPause.create({ data: { slaRecordId: record.id, reason, pausedAt: at } });
  await tx.slaRecord.update({ where: { id: record.id }, data: { status: 'PAUSED' } });
}

/** Restart the clock; the paused working days move the due date out on the next sweep. */
export async function resumeSla(tx: TransactionClient, caseId: string, at: Date): Promise<void> {
  const record = await tx.slaRecord.findUnique({ where: { caseId }, select: { id: true } });
  if (!record) return;
  await tx.slaPause.updateMany({
    where: { slaRecordId: record.id, resumedAt: null },
    data: { resumedAt: at },
  });
}

/** Stop the clock for good - on completion or cancellation. */
export async function closeSla(tx: TransactionClient, caseId: string, at: Date): Promise<void> {
  await resumeSla(tx, caseId, at);
  await tx.slaRecord.updateMany({
    where: { caseId, completedAt: null },
    data: { completedAt: at, status: 'CLOSED' },
  });
}

export interface SweepResult {
  evaluated: number;
  changed: number;
  approaching: string[];
  breached: string[];
}

/**
 * Re-evaluate open SLA records - all of them, or one case's - and notify the
 * ones that have just crossed into "approaching" or "breached".
 */
export async function refreshSla(
  options: { caseId?: string; now?: Date } = {},
): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const records = await prisma.slaRecord.findMany({
    where: { completedAt: null, ...(options.caseId ? { caseId: options.caseId } : {}) },
    include: { pauses: true, policy: true },
  });

  const result: SweepResult = {
    evaluated: records.length,
    changed: 0,
    approaching: [],
    breached: [],
  };
  const calendars = new Map<string, SlaCalendar>();

  for (const record of records) {
    let calendar = calendars.get(record.policyId);
    if (!calendar) {
      calendar = await calendarFor(record.policy);
      calendars.set(record.policyId, calendar);
    }

    const evaluation = evaluateSla(
      {
        startedAt: record.startedAt,
        completedAt: null,
        totalWorkingDays: record.policy.totalWorkingDays,
        warningPercent: record.policy.warningPercent,
        pauses: record.pauses.map((p) => ({ pausedAt: p.pausedAt, resumedAt: p.resumedAt })),
        now,
      },
      calendar,
    );

    const unchanged =
      record.status === evaluation.state &&
      record.dueAt.getTime() === evaluation.dueAt.getTime() &&
      Number(record.elapsedWorkingDays) === evaluation.elapsedWorkingDays &&
      Number(record.netWorkingDays) === evaluation.netWorkingDays &&
      record.pausedSeconds === evaluation.pausedSeconds;
    if (unchanged) continue;

    // Only if nobody has touched the record since it was read. Sweeps overlap -
    // the scheduler's, a page load's, another application instance's - and
    // without this guard two of them would both see the same crossing and both
    // send the "breached" email. The loser's update matches no row; it moves on.
    const { count } = await prisma.slaRecord.updateMany({
      where: { id: record.id, updatedAt: record.updatedAt },
      data: {
        status: evaluation.state,
        dueAt: evaluation.dueAt,
        elapsedWorkingDays: evaluation.elapsedWorkingDays,
        netWorkingDays: evaluation.netWorkingDays,
        pausedSeconds: evaluation.pausedSeconds,
        breachedAt: record.breachedAt ?? (evaluation.state === 'BREACHED' ? now : null),
      },
    });
    if (count === 0) continue;
    result.changed += 1;

    // Notify on the crossing only. A breach is announced once, even if the
    // case later goes quiet on a pause and comes back still late.
    if (evaluation.state === 'WARNING' && record.status === 'GREEN') {
      result.approaching.push(record.caseId);
    }
    if (evaluation.state === 'BREACHED' && record.breachedAt === null) {
      result.breached.push(record.caseId);
    }
  }

  for (const caseId of result.approaching) await dispatchCaseEvents(['SLA_APPROACHING'], caseId);
  for (const caseId of result.breached) await dispatchCaseEvents(['SLA_BREACHED'], caseId);
  return result;
}

// ---------------------------------------------------------------------------
// Sweep scheduling
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = 0;
let running: Promise<unknown> | null = null;

/**
 * Run the sweep at most every five minutes, in the background, piggy-backing
 * on page loads - so states stay current without a scheduler. In production a
 * scheduler calls `/api/cron/sla` as well, so a quiet night still raises its
 * breaches on time.
 */
export function scheduleSlaSweep(): void {
  const now = Date.now();
  if (running || now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  running = refreshSla()
    .catch((error: unknown) => logger.error({ err: error }, 'SLA sweep failed'))
    .finally(() => {
      running = null;
    });
}

// ---------------------------------------------------------------------------
// The SLA register (reports/sla)
// ---------------------------------------------------------------------------

export const SLA_STATES = ['GREEN', 'WARNING', 'BREACHED', 'PAUSED', 'CLOSED'] as const;
export type SlaStateFilter = (typeof SLA_STATES)[number];

export interface SlaReportFilter {
  state?: SlaStateFilter;
  page?: number;
  pageSize?: number;
}

/**
 * The SLA register: headline figures over every record the actor may see, and
 * one page of rows. The figures are counted in the database over the scoped
 * set, so they never describe only the page on screen.
 *
 * Compliance is measured on finished work - cases closed without ever having
 * breached - because an open case that is on track today can still be late.
 */
export async function loadSlaReport(actor: Actor, filter: SlaReportFilter = {}) {
  assertPermission(actor, PERMISSIONS.REPORT_SLA);

  const scope: Prisma.SlaRecordWhereInput = { case: caseScopeFilter(actor) };
  const where: Prisma.SlaRecordWhereInput = filter.state
    ? { AND: [scope, { status: filter.state }] }
    : scope;
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filter.pageSize ?? 10));

  const [rows, total, byState, closedLate, policy] = await Promise.all([
    prisma.slaRecord.findMany({
      where,
      // Open work first, soonest due at the top; finished work after it.
      orderBy: [{ completedAt: { sort: 'desc', nulls: 'first' } }, { dueAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        case: {
          select: {
            id: true,
            caseNumber: true,
            applicantName: true,
            discipline: true,
            status: true,
            requestingOrg: { select: { name: true } },
          },
        },
      },
    }),
    prisma.slaRecord.count({ where }),
    prisma.slaRecord.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    prisma.slaRecord.count({
      where: { AND: [scope, { status: 'CLOSED', breachedAt: { not: null } }] },
    }),
    loadSlaPolicy().catch(() => null),
  ]);

  const counts = Object.fromEntries(SLA_STATES.map((s) => [s, 0])) as Record<
    SlaStateFilter,
    number
  >;
  for (const group of byState) counts[group.status] = group._count._all;
  const closed = counts.CLOSED;

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    counts,
    open: counts.GREEN + counts.WARNING + counts.BREACHED + counts.PAUSED,
    closed,
    closedLate,
    compliancePercent: closed === 0 ? null : Math.round(((closed - closedLate) / closed) * 100),
    policy,
  };
}

export type SlaReport = Awaited<ReturnType<typeof loadSlaReport>>;

// ---------------------------------------------------------------------------
// SLA configuration (admin/sla)
// ---------------------------------------------------------------------------

/** The standard policy and the holiday calendar, for the settings page. */
export async function loadSlaSettings(actor: Actor) {
  assertPermission(actor, PERMISSIONS.SLA_CONFIG);
  const [policy, holidays, openRecords] = await Promise.all([
    prisma.slaPolicy.findUnique({ where: { code: 'STANDARD' } }),
    prisma.holiday.findMany({ orderBy: { date: 'asc' } }),
    prisma.slaRecord.count({ where: { completedAt: null } }),
  ]);
  return {
    policy: policy && {
      ...policy,
      workingDaysOfWeek: Array.isArray(policy.workingDaysOfWeek)
        ? (policy.workingDaysOfWeek as number[])
        : [1, 2, 3, 4, 5],
    },
    holidays,
    openRecords,
  };
}

/**
 * Re-evaluate open cases after a calendar change, so the register and the due
 * dates reflect the new calendar at once rather than on the next sweep. The
 * change itself is committed; a failed sweep is logged, not reported as a
 * failed save.
 */
async function applyCalendarChange(): Promise<void> {
  invalidateConfigurationCache('holidays');
  invalidateConfigurationCache('sla:STANDARD');
  await refreshSla().catch((error: unknown) =>
    logger.error({ err: error }, 'SLA sweep after a calendar change failed'),
  );
}

export async function updateSlaPolicy(
  actor: Actor,
  input: SlaPolicyInput,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.SLA_CONFIG);

  await withTransaction(async (tx) => {
    const before = await tx.slaPolicy.findUnique({ where: { code: 'STANDARD' } });
    if (!before) throw new NotFoundError('The standard SLA policy is not configured.');

    await tx.slaPolicy.update({ where: { id: before.id }, data: input });
    await record(tx, {
      ...auditContext(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'SlaPolicy',
      entityId: before.id,
      before: {
        totalWorkingDays: before.totalWorkingDays,
        warningPercent: before.warningPercent,
        workingDaysOfWeek: before.workingDaysOfWeek,
        countCalendarDays: before.countCalendarDays,
      },
      after: { ...input },
    });
  });

  await applyCalendarChange();
}

export async function addHoliday(
  actor: Actor,
  input: HolidayInput,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.SLA_CONFIG);
  const date = new Date(`${input.date}T00:00:00.000Z`);

  await withTransaction(async (tx) => {
    const clash = await tx.holiday.findFirst({ where: { date }, select: { name: true } });
    if (clash) {
      throw new ConflictError(`${input.date} is already in the calendar as ${clash.name}.`);
    }
    const holiday = await tx.holiday.create({
      data: { date, name: input.name, isRecurring: input.isRecurring },
    });
    await record(tx, {
      ...auditContext(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'Holiday',
      entityId: holiday.id,
      after: { date: input.date, name: input.name, isRecurring: input.isRecurring },
    });
  });

  await applyCalendarChange();
}

export async function removeHoliday(
  actor: Actor,
  holidayId: string,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.SLA_CONFIG);

  await withTransaction(async (tx) => {
    const before = await tx.holiday.findUnique({ where: { id: holidayId } });
    if (!before) throw new NotFoundError('That holiday was not found.');
    await tx.holiday.delete({ where: { id: holidayId } });
    await record(tx, {
      ...auditContext(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'Holiday',
      entityId: holidayId,
      before: {
        date: before.date.toISOString().slice(0, 10),
        name: before.name,
        isRecurring: before.isRecurring,
      },
    });
  });

  await applyCalendarChange();
}

function auditContext(actor: Actor, ctx: AuditContextInput) {
  return {
    actorId: actor.id,
    actorRole: actor.roles.join(','),
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
    correlationId: ctx.correlationId ?? null,
  };
}
