import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { CaseStatus } from '@/server/domain/shared/enums';

/**
 * Dashboard aggregates (spec section 21).
 *
 * Every query is built from a scope filter derived from the actor, so a Maker's
 * counts cover their own cases and a Process Owner's cover their own unit. The
 * filter is composed here rather than in the page, which means a dashboard can
 * never quietly count cases its viewer is not entitled to see - the figures
 * reconcile exactly with what the same user can open.
 */

export type DashboardKind = 'MAKER' | 'CHECKER' | 'MANAGER' | 'DIRECTOR' | 'REQUESTER' | 'ADMIN';

/** Pick the dashboard for an actor, most specific first for multi-role users. */
export function dashboardKindFor(actor: Actor): DashboardKind {
  // Checked first: an administrator now holds every dashboard permission, and
  // the whole-system view is the one that suits them.
  if (actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER)) return 'ADMIN';
  if (actor.permissions.has(PERMISSIONS.DASHBOARD_DIRECTOR)) return 'DIRECTOR';
  if (actor.permissions.has(PERMISSIONS.DASHBOARD_MANAGER)) return 'MANAGER';
  if (actor.permissions.has(PERMISSIONS.DASHBOARD_CHECKER)) return 'CHECKER';
  if (actor.permissions.has(PERMISSIONS.DASHBOARD_MAKER)) return 'MAKER';
  if (actor.permissions.has(PERMISSIONS.DASHBOARD_REQUESTER)) return 'REQUESTER';
  return 'ADMIN';
}

/**
 * The case-visibility filter for an actor.
 *
 * Mirrors the scope predicates in docs/04-rbac-matrix.md. An actor with no
 * qualifying relationship gets a filter that matches nothing, rather than an
 * empty filter that would match everything - the failure mode matters.
 */
export function caseScopeFilter(actor: Actor): Prisma.ValuationCaseWhereInput {
  // Whole-system visibility: an oversight reader (`case:read_all`) or an
  // administrator (`system:administer`). This governs what a list *shows*;
  // what a caller may *do* is decided per case by canAccessCase.
  if (
    actor.permissions.has(PERMISSIONS.CASE_READ_ALL) ||
    actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER)
  ) {
    return {};
  }

  const clauses: Prisma.ValuationCaseWhereInput[] = [];

  if (actor.departmentId && actor.permissions.has(PERMISSIONS.CASE_ASSIGN_MAKER)) {
    clauses.push({ departmentId: actor.departmentId });
  }
  if (actor.departmentId && actor.permissions.has(PERMISSIONS.CASE_ASSIGN_CHECKER)) {
    clauses.push({ departmentId: actor.departmentId });
  }
  if (actor.departmentId && actor.permissions.has(PERMISSIONS.APPROVAL_DIRECTOR)) {
    clauses.push({ departmentId: actor.departmentId });
  }
  if (actor.permissions.has(PERMISSIONS.VALUATION_START)) {
    clauses.push({ makerId: actor.id });
  }
  if (actor.permissions.has(PERMISSIONS.VALUATION_CHECK)) {
    clauses.push({ checkerId: actor.id });
  }
  if (actor.permissions.has(PERMISSIONS.CASE_CREATE)) {
    const orgIds: string[] =
      actor.organizationScope.length > 0
        ? [...actor.organizationScope]
        : actor.organizationId
          ? [actor.organizationId]
          : [];
    if (orgIds.length > 0) clauses.push({ requestingOrgId: { in: orgIds } });
    clauses.push({ requestedById: actor.id });
  }

  if (clauses.length === 0) {
    // Match nothing, rather than everything. An actor with no qualifying
    // relationship to any case should see an empty list, and that failure
    // direction is the safe one.
    return { id: { equals: '00000000-0000-0000-0000-000000000000' } };
  }

  return { OR: clauses };
}

export interface StatusCount {
  status: CaseStatus;
  count: number;
}

export interface DashboardSummary {
  kind: DashboardKind;
  total: number;
  byStatus: StatusCount[];
  openTasks: number;
  overdue: number;
  dueSoon: number;
  returned: number;
  unreadNotifications: number;
}

export async function loadDashboardSummary(actor: Actor): Promise<DashboardSummary> {
  const scope = caseScopeFilter(actor);
  const now = new Date();
  const soon = new Date(now.getTime() + 24 * 3_600_000);

  const [grouped, openTasks, overdue, dueSoon, unreadNotifications] = await Promise.all([
    prisma.valuationCase.groupBy({
      by: ['status'],
      where: scope,
      _count: { _all: true },
    }),
    prisma.workflowTask.count({ where: { assigneeId: actor.id, completedAt: null } }),
    // Late and due-soon read the state the SLA sweep stored, so the dashboard
    // and the SLA register count the same cases: a case paused with the
    // requester is neither, however old its due date.
    prisma.slaRecord.count({ where: { case: scope, status: 'BREACHED' } }),
    prisma.slaRecord.count({
      where: { case: scope, status: { in: ['GREEN', 'WARNING'] }, dueAt: { lt: soon } },
    }),
    prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),
  ]);

  const byStatus: StatusCount[] = grouped.map((row) => ({
    status: row.status as CaseStatus,
    count: row._count._all,
  }));

  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const returned = byStatus.find((row) => row.status === 'RETURNED_FOR_CORRECTION')?.count ?? 0;

  return {
    kind: dashboardKindFor(actor),
    total,
    byStatus,
    openTasks,
    overdue,
    dueSoon,
    returned,
    unreadNotifications,
  };
}

/**
 * Which status tiles a dashboard shows, per spec section 21. Kept as data so a
 * dashboard's composition is reviewable in one place rather than spread across
 * JSX.
 */
export const DASHBOARD_TILES: Record<DashboardKind, readonly CaseStatus[]> = {
  MAKER: [
    'ASSIGNED',
    'ON_PROGRESS',
    'NOT_VISITED',
    'PENDING',
    'RETURNED_FOR_CORRECTION',
    'SUBMITTED_FOR_CHECKING',
  ],
  CHECKER: ['CHECKING', 'COMMENTED', 'RETURNED_FOR_CORRECTION', 'CHECKED'],
  MANAGER: [
    'REQUESTED',
    'ASSIGNED',
    'ON_PROGRESS',
    'SUBMITTED_FOR_CHECKING',
    'CHECKING',
    'RETURNED_FOR_CORRECTION',
    'PENDING_MANAGER_APPROVAL',
    'COMPLETED',
  ],
  DIRECTOR: [
    'REQUESTED',
    'ON_PROGRESS',
    'CHECKING',
    'PENDING_MANAGER_APPROVAL',
    'PENDING_DIRECTOR_APPROVAL',
    'APPROVED',
    'COMPLETED',
  ],
  REQUESTER: ['DRAFT', 'REQUESTED', 'ON_PROGRESS', 'AWAITING_REQUESTER', 'COMPLETED'],
  // Administrators see and act across the whole system, so their dashboard
  // covers every status rather than one stage of the workflow.
  ADMIN: [
    'REQUESTED',
    'ASSIGNED',
    'ON_PROGRESS',
    'SUBMITTED_FOR_CHECKING',
    'CHECKING',
    'RETURNED_FOR_CORRECTION',
    'PENDING_MANAGER_APPROVAL',
    'PENDING_DIRECTOR_APPROVAL',
    'APPROVED',
    'COMPLETED',
    'ARCHIVED',
    'CANCELLED',
  ],
};

// ---------------------------------------------------------------------------
// The richer dashboard: pipeline, attention list and reminders
// ---------------------------------------------------------------------------

/** One stage of the workflow, with how much work sits there and for how long. */
export interface PipelineStage {
  key: string;
  label: string;
  statuses: readonly CaseStatus[];
  count: number;
  /** Mean age in days of the cases currently at this stage. */
  averageDays: number;
  overdue: number;
}

/**
 * The pipeline the Board Portal shows: where work currently sits, and how long
 * it has been sitting there.
 *
 * The average age is the number a manager acts on — a stage holding four cases
 * for an average of 26 days is a different problem from one holding four for
 * two days, and a bare count cannot tell them apart.
 */
const PIPELINE_STAGES: readonly { key: string; label: string; statuses: readonly CaseStatus[] }[] =
  [
    {
      key: 'intake',
      label: 'Requesting Unit',
      statuses: ['DRAFT', 'REQUESTED', 'AWAITING_REQUESTER'],
    },
    {
      key: 'valuation',
      label: 'Valuator (Maker)',
      statuses: ['ASSIGNED', 'ON_PROGRESS', 'NOT_VISITED', 'PENDING'],
    },
    {
      key: 'checking',
      label: 'Valuator (Checker)',
      statuses: ['SUBMITTED_FOR_CHECKING', 'CHECKING', 'COMMENTED'],
    },
    { key: 'rework', label: 'Returned for Correction', statuses: ['RETURNED_FOR_CORRECTION'] },
    { key: 'coverpage', label: 'Cover Page (Maker)', statuses: ['CHECKED'] },
    {
      key: 'approval',
      label: 'Approval',
      statuses: ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL'],
    },
    { key: 'signature', label: 'Signature & Issue', statuses: ['APPROVED', 'SIGNED'] },
  ];

export interface AttentionItem {
  id: string;
  caseNumber: string;
  title: string;
  status: CaseStatus;
  holder: string;
  dueAt: Date | null;
  daysOverdue: number;
}

export interface DashboardDetail {
  pipeline: PipelineStage[];
  attention: AttentionItem[];
  /** Cases that reached a terminal state in the last 7 days. */
  completedThisWeek: number;
  /** Total value of everything currently in scope, in ETB. */
  totalValue: string;
  awaitingAction: number;
  /** Open cases running against a turnaround standard. */
  slaTracked: number;
  /** Of those, the ones already past it. */
  slaLate: number;
  /** Share of tracked cases still within the standard, 0-100; null with none tracked. */
  slaOnTrackPercent: number | null;
}

export async function loadDashboardDetail(actor: Actor): Promise<DashboardDetail> {
  const scope = caseScopeFilter(actor);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [open, overdueCases, completedThisWeek, valueSum] = await Promise.all([
    prisma.valuationCase.findMany({
      where: {
        AND: [scope, { status: { notIn: ['COMPLETED', 'ARCHIVED', 'CANCELLED'] } }],
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        requestedAt: true,
        slaRecord: { select: { dueAt: true, status: true } },
      },
    }),
    prisma.valuationCase.findMany({
      where: {
        AND: [
          scope,
          { status: { notIn: ['COMPLETED', 'ARCHIVED', 'CANCELLED'] } },
          { slaRecord: { is: { status: 'BREACHED' } } },
        ],
      },
      orderBy: { requestedAt: 'asc' },
      take: 6,
      select: {
        id: true,
        caseNumber: true,
        ownerName: true,
        applicantName: true,
        status: true,
        maker: { select: { fullName: true } },
        checker: { select: { fullName: true } },
        requestType: { select: { name: true } },
        slaRecord: { select: { dueAt: true } },
      },
    }),
    prisma.valuationCase.count({
      where: { AND: [scope, { completedAt: { gte: weekAgo } }] },
    }),
    prisma.valuationCase.aggregate({ where: scope, _sum: { finalValue: true } }),
  ]);

  const pipeline: PipelineStage[] = PIPELINE_STAGES.map((stage) => {
    const here = open.filter((c) => stage.statuses.includes(c.status as CaseStatus));
    const ages = here.map((c) => {
      const from = (c.requestedAt ?? c.createdAt).getTime();
      return Math.max(0, (now.getTime() - from) / 86_400_000);
    });
    const averageDays =
      ages.length === 0 ? 0 : Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
    const overdue = here.filter((c) => c.slaRecord?.status === 'BREACHED').length;

    return { ...stage, count: here.length, averageDays, overdue };
  });

  const attention: AttentionItem[] = overdueCases.map((c) => {
    const dueAt = c.slaRecord?.dueAt ?? null;
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      title: `${c.requestType.name} — ${c.ownerName}`,
      status: c.status as CaseStatus,
      holder: c.checker?.fullName ?? c.maker?.fullName ?? 'Unassigned',
      dueAt,
      daysOverdue: dueAt
        ? Math.max(1, Math.ceil((now.getTime() - dueAt.getTime()) / 86_400_000))
        : 0,
    };
  });

  const awaitingAction = open.filter((c) =>
    (
      [
        'REQUESTED',
        'SUBMITTED_FOR_CHECKING',
        'CHECKED',
        'PENDING_MANAGER_APPROVAL',
        'PENDING_DIRECTOR_APPROVAL',
      ] as CaseStatus[]
    ).includes(c.status as CaseStatus),
  ).length;

  // Paused cases are on neither side of the line, so they are left out.
  const tracked = open.filter(
    (c) => c.slaRecord && ['GREEN', 'WARNING', 'BREACHED'].includes(c.slaRecord.status),
  );
  const slaLate = tracked.filter((c) => c.slaRecord?.status === 'BREACHED').length;

  return {
    pipeline,
    attention,
    completedThisWeek,
    totalValue: valueSum._sum.finalValue?.toString() ?? '0',
    awaitingAction,
    slaTracked: tracked.length,
    slaLate,
    slaOnTrackPercent:
      tracked.length === 0 ? null : Math.round(((tracked.length - slaLate) / tracked.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// Trends: what arrived and what finished, over the week and over the year
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** Axis label: `Mo`, or `Jan`. */
  label: string;
  /** Readout label: `Mon 22 Sep`, or `Jan 2026`. */
  fullLabel: string;
  count: number;
}

export interface DashboardTrends {
  /** Requests received per day over the last 7 days, today last. */
  requestsByDay: TrendPoint[];
  /** Cases completed per day over the last 7 days, today last. */
  completionsByDay: TrendPoint[];
  /** Totals for the 7 days before those, for the week-on-week change. */
  requestsPriorWeek: number;
  completionsPriorWeek: number;
  /** Requests received per month over the last 12 months, this month last. */
  requestsByMonth: TrendPoint[];
  /** Cases completed per month over the last 12 months, this month last. */
  completionsByMonth: TrendPoint[];
}

const DAY_MS = 86_400_000;
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const DAY_LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const MONTH_LONG = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Case volume over time, for the dashboard's charts.
 *
 * Days and months are cut in UTC, the zone every date in the application is
 * displayed in, so the bar for "Mon" counts exactly the cases whose dates read
 * Monday on every other screen.
 *
 * Only two timestamps are read, and only for the last year, so the bucketing
 * is done here rather than in a raw `date_trunc` query that would have to
 * re-express the scope filter in SQL - and could then drift from it.
 */
export async function loadDashboardTrends(
  actor: Actor,
  now = new Date(),
): Promise<DashboardTrends> {
  const scope = caseScopeFilter(actor);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const today = Date.UTC(year, month, now.getUTCDate());
  const weekStart = today - 6 * DAY_MS;
  const priorWeekStart = weekStart - 7 * DAY_MS;
  const monthStarts = Array.from({ length: 13 }, (_, i) => Date.UTC(year, month - 11 + i, 1));
  const from = new Date(Math.min(monthStarts[0] ?? priorWeekStart, priorWeekStart));

  const rows = await prisma.valuationCase.findMany({
    where: {
      AND: [scope, { OR: [{ requestedAt: { gte: from } }, { completedAt: { gte: from } }] }],
    },
    select: { requestedAt: true, completedAt: true },
  });

  const requested = rows.flatMap((r) => (r.requestedAt ? [r.requestedAt.getTime()] : []));
  const completed = rows.flatMap((r) => (r.completedAt ? [r.completedAt.getTime()] : []));
  const within = (times: number[], start: number, end: number) =>
    times.filter((t) => t >= start && t < end).length;

  const byDay = (times: number[]): TrendPoint[] =>
    Array.from({ length: 7 }, (_, i) => {
      const start = weekStart + i * DAY_MS;
      return {
        label: WEEKDAY.format(start).slice(0, 2),
        fullLabel: DAY_LONG.format(start),
        count: within(times, start, start + DAY_MS),
      };
    });

  const byMonth = (times: number[]): TrendPoint[] =>
    monthStarts.slice(0, 12).map((start, i) => ({
      label: MONTH.format(start),
      fullLabel: MONTH_LONG.format(start),
      count: within(times, start, monthStarts[i + 1] ?? start),
    }));

  return {
    requestsByDay: byDay(requested),
    completionsByDay: byDay(completed),
    requestsPriorWeek: within(requested, priorWeekStart, weekStart),
    completionsPriorWeek: within(completed, priorWeekStart, weekStart),
    requestsByMonth: byMonth(requested),
    completionsByMonth: byMonth(completed),
  };
}
