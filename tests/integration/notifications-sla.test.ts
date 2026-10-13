import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import { createCase, performTransition } from '@/server/application/case-service';
import { calendarFor, loadSlaReport, refreshSla } from '@/server/application/sla-service';
import { addWorkingDays, type SlaCalendar } from '@/server/domain/sla/sla-engine';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { RoleCode } from '@/server/domain/shared/enums';
import { ForbiddenError } from '@/lib/errors';

/**
 * Notifications and SLA tracking against the real database (roadmap Phase 7):
 * a transition tells the roles its rule names - never the person who acted -
 * and the SLA clock starts at submission, pauses while the request is back
 * with the requester, turns amber and then red against the configured
 * calendar, and announces each crossing exactly once.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `sla-${Date.now()}`;
const CTX = { ipAddress: '10.0.0.7', userAgent: 'vitest', correlationId: SUFFIX };
const DAY_MS = 86_400_000;

const created = { userIds: [] as string[], caseIds: [] as string[], orgId: '' };

async function makeActor(
  label: string,
  roles: RoleCode[],
  opts: { organizationId?: string; departmentId?: string; discipline?: 'CIVIL' | 'BOTH' } = {},
): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      employeeId: `SLA-${SUFFIX}-${label}`.toUpperCase(),
      email: `${label}.${SUFFIX}@test.invalid`,
      fullName: `SLA ${label}`,
      organizationId: opts.organizationId ?? null,
      departmentId: opts.departmentId ?? null,
      discipline: opts.discipline ?? 'CIVIL',
    },
  });
  created.userIds.push(user.id);

  const permissions = new Set<PermissionCode>();
  for (const roleCode of roles) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      include: { permissions: { include: { permission: true } } },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    for (const grant of role.permissions) permissions.add(grant.permission.code as PermissionCode);
  }

  return {
    id: user.id,
    fullName: user.fullName,
    roles,
    permissions,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    discipline: user.discipline,
    isActive: true,
    organizationScope: user.organizationId ? [user.organizationId] : [],
  };
}

describeIfDb('notifications and SLA tracking', () => {
  let owner: Actor;
  let manager: Actor;
  let maker: Actor;
  let caseId = '';
  let calendar: SlaCalendar;
  let policy: { totalWorkingDays: number; warningPercent: number };

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { code: `SLAORG-${SUFFIX}`, name: 'SLA Test Branch', type: 'BRANCH' },
    });
    created.orgId = org.id;
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: 'PVD' } });

    owner = await makeActor('owner', ['PROCESS_OWNER'], { organizationId: org.id });
    manager = await makeActor('mgr', ['MAKER_MANAGER'], {
      departmentId: dept.id,
      discipline: 'BOTH',
    });
    maker = await makeActor('maker', ['MAKER'], { departmentId: dept.id });

    const standard = await prisma.slaPolicy.findUniqueOrThrow({ where: { code: 'STANDARD' } });
    policy = standard;
    calendar = await calendarFor(standard);

    const intake = await createCase(
      owner,
      {
        requestTypeCode: 'NEW',
        discipline: 'CIVIL',
        applicantName: 'Applicant',
        ownerName: 'Owner',
      },
      CTX,
    );
    caseId = intake.id;
    created.caseIds.push(caseId);

    const categories = await prisma.documentCategory.findMany({
      where: {
        isMandatory: true,
        isActive: true,
        OR: [{ discipline: null }, { discipline: 'CIVIL' }],
      },
      select: { id: true, code: true },
    });
    for (const category of categories) {
      await prisma.propertyDocument.create({
        data: {
          caseId,
          categoryId: category.id,
          originalFilename: `${category.code}.pdf`,
          storageKey: `test/${caseId}/${category.code}-${Math.random().toString(36).slice(2)}`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
          scanStatus: 'CLEAN',
          uploadedById: owner.id,
        },
      });
    }
  });

  afterAll(async () => {
    const guards: [table: string, trigger: string][] = [
      ['valuation_cases', 'valuation_cases_delete_guard'],
      ['workflow_history', 'workflow_history_append_only'],
    ];
    for (const [table, trigger] of guards) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    }
    try {
      const caseIds = { in: created.caseIds };
      // Notifications, SLA records and pauses cascade with the case.
      await prisma.propertyDocument.deleteMany({ where: { caseId: caseIds } });
      await prisma.valuationCase.deleteMany({ where: { id: caseIds } });
      await prisma.userRole.deleteMany({ where: { userId: { in: created.userIds } } });
      await prisma.user.updateMany({
        where: { id: { in: created.userIds } },
        data: { organizationId: null, isActive: false },
      });
      if (created.orgId) await prisma.organization.deleteMany({ where: { id: created.orgId } });
    } finally {
      for (const [table, trigger] of guards) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      }
      await prisma.$disconnect();
    }
  });

  async function transition(
    actor: Actor,
    action: string,
    extra: { assigneeId?: string; comment?: string } = {},
  ) {
    const { version } = await prisma.valuationCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { version: true },
    });
    await performTransition(
      actor,
      {
        caseId,
        action: action as never,
        expectedVersion: version,
        assigneeId: extra.assigneeId ?? null,
        comment: extra.comment ?? null,
      },
      CTX,
    );
  }

  const notificationsFor = (recipientId: string, eventType: string) =>
    prisma.notification.findMany({
      where: { caseId, recipientId, eventType },
      orderBy: { channel: 'asc' },
    });

  const slaRecord = () =>
    prisma.slaRecord.findUniqueOrThrow({ where: { caseId }, include: { pauses: true } });

  it('tells the department a request has arrived, in-app and by email', async () => {
    await transition(owner, 'SUBMIT_REQUEST');

    const rows = await notificationsFor(manager.id, 'CASE_REQUESTED');
    expect(rows.map((r) => r.channel)).toEqual(['IN_APP', 'EMAIL']);
    // The development mail driver logs rather than sends, and says it did.
    expect(rows.every((r) => r.status === 'SENT' && r.sentAt !== null)).toBe(true);
    const intake = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(rows[0]?.subject).toContain(intake.caseNumber);
    expect(rows[0]?.payload).toMatchObject({
      link: expect.stringContaining(`/requests/${caseId}`),
    });

    // The requester acted; the requester is not told about it.
    expect(await prisma.notification.count({ where: { caseId, recipientId: owner.id } })).toBe(0);
  });

  it('starts the SLA clock at submission, due after the allowance in working days', async () => {
    const record = await slaRecord();
    expect(record.status).toBe('GREEN');
    expect(record.completedAt).toBeNull();
    expect(record.dueAt.getTime()).toBe(
      addWorkingDays(record.startedAt, policy.totalWorkingDays, calendar).getTime(),
    );
  });

  it('pauses while the request is back with the requester, and cannot breach meanwhile', async () => {
    await transition(manager, 'RETURN_TO_REQUESTER', { comment: 'Title deed copy is illegible' });

    const record = await slaRecord();
    expect(record.status).toBe('PAUSED');
    expect(record.pauses).toHaveLength(1);
    expect(record.pauses[0]?.reason).toBe('Title deed copy is illegible');
    expect(record.pauses[0]?.resumedAt).toBeNull();

    // A month later, still paused: no breach, and nobody is told of one.
    const later = new Date(record.startedAt.getTime() + 30 * DAY_MS);
    const sweep = await refreshSla({ caseId, now: later });
    expect(sweep.breached).toEqual([]);
    expect((await slaRecord()).status).toBe('PAUSED');
  });

  it('resumes when the case moves on, pushing the due date out by the paused working days', async () => {
    await transition(manager, 'ASSIGN_MAKER', { assigneeId: maker.id });
    const resumed = await slaRecord();
    expect(resumed.pauses[0]?.resumedAt).not.toBeNull();
    expect(resumed.status).not.toBe('PAUSED');

    // Stretch the pause over three working days, as if the requester had
    // taken that long, and re-evaluate.
    const pause = resumed.pauses[0]!;
    const resumedAt = addWorkingDays(resumed.startedAt, 3, calendar);
    await prisma.slaPause.update({
      where: { id: pause.id },
      data: { pausedAt: resumed.startedAt, resumedAt },
    });
    await refreshSla({ caseId, now: resumedAt });

    const record = await slaRecord();
    expect(record.dueAt.getTime()).toBe(
      addWorkingDays(record.startedAt, policy.totalWorkingDays + 3, calendar).getTime(),
    );
    expect(Number(record.elapsedWorkingDays) - Number(record.netWorkingDays)).toBe(3);
  });

  it('tells the maker they have been assigned - and not the manager who assigned them', async () => {
    const rows = await notificationsFor(maker.id, 'CASE_ASSIGNED');
    expect(rows.map((r) => r.channel)).toEqual(['IN_APP', 'EMAIL']);
    expect(await notificationsFor(manager.id, 'CASE_ASSIGNED')).toHaveLength(0);
  });

  it('turns amber at the warning point and announces it once', async () => {
    const record = await slaRecord();
    // The first working day on which the net figure reaches the warning point,
    // counted after the three paused days.
    const warnDays = Math.ceil((policy.totalWorkingDays * policy.warningPercent) / 100);
    const pausedUntil = record.pauses[0]!.resumedAt!;
    const warnAt = addWorkingDays(pausedUntil, warnDays, calendar);
    expect(warnAt.getTime()).toBeLessThanOrEqual(record.dueAt.getTime());

    const first = await refreshSla({ caseId, now: warnAt });
    expect(first.approaching).toEqual([caseId]);
    expect((await slaRecord()).status).toBe('WARNING');
    expect(await notificationsFor(maker.id, 'SLA_APPROACHING')).toHaveLength(2);

    const again = await refreshSla({ caseId, now: warnAt });
    expect(again.approaching).toEqual([]);
    expect(await notificationsFor(maker.id, 'SLA_APPROACHING')).toHaveLength(2);
  });

  it('breaches after the due date, announces it once and remembers when', async () => {
    const { dueAt } = await slaRecord();
    const late = new Date(dueAt.getTime() + 2 * DAY_MS);

    // Three sweeps at once - the scheduler, a page load, a second instance -
    // and still one announcement.
    const sweeps = await Promise.all([1, 2, 3].map(() => refreshSla({ caseId, now: late })));
    expect(sweeps.flatMap((s) => s.breached)).toEqual([caseId]);
    const breached = await slaRecord();
    expect(breached.status).toBe('BREACHED');
    expect(breached.breachedAt).not.toBeNull();
    expect(await notificationsFor(manager.id, 'SLA_BREACHED')).toHaveLength(2);

    const again = await refreshSla({ caseId, now: new Date(late.getTime() + DAY_MS) });
    expect(again.breached).toEqual([]);
    expect(await notificationsFor(manager.id, 'SLA_BREACHED')).toHaveLength(2);
    expect((await slaRecord()).breachedAt?.getTime()).toBe(breached.breachedAt?.getTime());
  });

  it('shows the case in the SLA register of those who may see it', async () => {
    const report = await loadSlaReport(manager, { state: 'BREACHED', pageSize: 100 });
    expect(report.rows.some((row) => row.caseId === caseId)).toBe(true);
    expect(report.counts.BREACHED).toBeGreaterThanOrEqual(1);

    // A maker holds no report permission at all.
    await expect(loadSlaReport(maker)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('closes the clock for good when the case is cancelled, keeping the breach on record', async () => {
    await transition(owner, 'CANCEL', { comment: 'Customer withdrew the facility request' });

    const record = await slaRecord();
    expect(record.status).toBe('CLOSED');
    expect(record.completedAt).not.toBeNull();
    expect(record.breachedAt).not.toBeNull();

    // A closed record is no longer swept.
    const sweep = await refreshSla({ caseId, now: new Date(record.dueAt.getTime() + 60 * DAY_MS) });
    expect(sweep.evaluated).toBe(0);
  });
});
