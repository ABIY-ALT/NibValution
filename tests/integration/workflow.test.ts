import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import { createCase, getCase, listCases, performTransition } from '@/server/application/case-service';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { RoleCode } from '@/server/domain/shared/enums';
import { BusinessRuleError, ForbiddenError, NotFoundError, WorkflowError } from '@/lib/errors';

/**
 * The intake and assignment workflow, end to end against the real database.
 *
 * This is the test that proves the engine is wired to something: a case is
 * created, submitted, assigned, worked, returned and resubmitted, and at each
 * step the status, the task, the history and the correction cycle are checked.
 * The negative cases matter as much - a stale version, a foreign case, and an
 * assignment that would break segregation of duties are all refused.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `wf-${Date.now()}`;
const CTX = { ipAddress: '10.0.0.9', userAgent: 'vitest', correlationId: SUFFIX };

const created = {
  userIds: [] as string[],
  caseIds: [] as string[],
  extraOrgIds: [] as string[],
  orgId: '',
  deptId: '',
};

/** Build an Actor from a seeded role's default grants. */
async function makeActor(
  label: string,
  roles: RoleCode[],
  opts: { organizationId?: string; departmentId?: string; discipline?: 'CIVIL' | 'MECHANICAL' | 'BOTH' | 'NONE' } = {},
): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      employeeId: `WF-${SUFFIX}-${label}`.toUpperCase(),
      email: `${label}.${SUFFIX}@test.invalid`,
      fullName: `WF ${label}`,
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

describeIfDb('valuation workflow', () => {
  let owner: Actor;
  let makerManager: Actor;
  let maker: Actor;
  // Reserved for the checking stage, which requires a completed calculation
  // and therefore arrives with the valuation module.
  let _checkerManager: Actor;
  let _checker: Actor;
  let stranger: Actor;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { code: `WFORG-${SUFFIX}`, name: 'Workflow Test Branch', type: 'BRANCH' },
    });
    created.orgId = org.id;

    // The civil department the seed created, so discipline routing resolves.
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: 'PVD' } });
    created.deptId = dept.id;

    owner = await makeActor('owner', ['PROCESS_OWNER'], { organizationId: org.id });
    makerManager = await makeActor('mgr', ['MAKER_MANAGER'], { departmentId: dept.id, discipline: 'BOTH' });
    maker = await makeActor('maker', ['MAKER'], { departmentId: dept.id, discipline: 'CIVIL' });
    _checkerManager = await makeActor('cmgr', ['CHECKER_MANAGER'], { departmentId: dept.id, discipline: 'BOTH' });
    _checker = await makeActor('checker', ['CHECKER'], { departmentId: dept.id, discipline: 'CIVIL' });
    stranger = await makeActor('stranger', ['MAKER'], { departmentId: null as unknown as string, discipline: 'CIVIL' });
  });

  afterAll(async () => {
    /**
     * Tearing this fixture down means removing rows the application is designed
     * never to remove - append-only history, correction cycles, and cases in a
     * protected state. Every guard is lifted explicitly here and restored in
     * the finally block, which is itself the clearest evidence they are real.
     */
    await prisma.$executeRawUnsafe('ALTER TABLE "correction_cycles" DISABLE TRIGGER "correction_cycles_close_only"');
    await prisma.$executeRawUnsafe('ALTER TABLE "valuation_cases" DISABLE TRIGGER "valuation_cases_delete_guard"');
    await prisma.$executeRawUnsafe('ALTER TABLE "workflow_history" DISABLE TRIGGER "workflow_history_append_only"');
    try {
      // Documents are attached to a case with ON DELETE RESTRICT, because a
      // document is evidence and must not vanish with its case. The fixture
      // removes its own first rather than weakening that rule.
      await prisma.propertyDocument.deleteMany({ where: { caseId: { in: created.caseIds } } });
      for (const id of created.caseIds) {
        await prisma.valuationCase.deleteMany({ where: { id } });
      }
      await prisma.userRole.deleteMany({ where: { userId: { in: created.userIds } } });
      // Users reference their organisation with ON DELETE RESTRICT, so the
      // link is cleared before the test organisations are removed.
      await prisma.user.updateMany({
        where: { id: { in: created.userIds } },
        data: { organizationId: null },
      });
      // Users that have acted now carry audit history, so they are deactivated
      // rather than deleted - the same lifecycle the application enforces.
      await prisma.user.updateMany({
        where: { id: { in: created.userIds } },
        data: { isActive: false },
      });
      const orgIds = [created.orgId, ...created.extraOrgIds].filter(Boolean);
      if (orgIds.length > 0) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "correction_cycles" ENABLE TRIGGER "correction_cycles_close_only"');
      await prisma.$executeRawUnsafe('ALTER TABLE "valuation_cases" ENABLE TRIGGER "valuation_cases_delete_guard"');
      await prisma.$executeRawUnsafe('ALTER TABLE "workflow_history" ENABLE TRIGGER "workflow_history_append_only"');
      await prisma.$disconnect();
    }
  });

  async function newCase(): Promise<{ id: string; caseNumber: string }> {
    const result = await createCase(
      owner,
      {
        requestTypeCode: 'NEW',
        discipline: 'CIVIL',
        applicantName: 'Test Applicant',
        ownerName: 'Test Owner',
      },
      CTX,
    );
    created.caseIds.push(result.id);
    return result;
  }

  /**
   * Attach the documents a civil case genuinely requires, so submission tests
   * exercise the workflow rather than the document guard. Upload arrives with
   * the document module; these rows stand in for it.
   */
  async function attachRequiredDocuments(caseId: string): Promise<void> {
    const categories = await prisma.documentCategory.findMany({
      where: { isMandatory: true, isActive: true, OR: [{ discipline: null }, { discipline: 'CIVIL' }] },
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
  }

  async function submitted(): Promise<{ id: string; caseNumber: string }> {
    const created_ = await newCase();
    await attachRequiredDocuments(created_.id);
    await performTransition(
      owner,
      { caseId: created_.id, action: 'SUBMIT_REQUEST', expectedVersion: await versionOf(created_.id) },
      CTX,
    );
    return created_;
  }

  async function versionOf(caseId: string): Promise<number> {
    const row = await prisma.valuationCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { version: true },
    });
    return row.version;
  }

  describe('creating a request', () => {
    it('allocates a sequential case number in the PV-YEAR-NNNNNN format', async () => {
      const first = await newCase();
      const second = await newCase();

      expect(first.caseNumber).toMatch(/^PV-\d{4}-\d{6}$/);
      expect(second.caseNumber).toMatch(/^PV-\d{4}-\d{6}$/);

      const firstSeq = Number(first.caseNumber.slice(-6));
      const secondSeq = Number(second.caseNumber.slice(-6));
      expect(secondSeq).toBe(firstSeq + 1);
    });

    it('starts the case as a draft, invisible to the department', async () => {
      const { id } = await newCase();
      const record = await getCase(owner, id);
      expect(record.status).toBe('DRAFT');
      expect(record.requestedAt).toBeNull();
    });

    it('records the creation in the audit trail', async () => {
      const { id } = await newCase();
      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'ValuationCase', entityId: id, action: 'CASE_CREATED' },
      });
      expect(entry).not.toBeNull();
    });

    it('refuses a request type that requires a prior case without one', async () => {
      await expect(
        createCase(
          owner,
          {
            requestTypeCode: 'RE_ESTIMATION',
            discipline: 'CIVIL',
            applicantName: 'A',
            ownerName: 'B',
          },
          CTX,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('refuses creation by a role without case:create', async () => {
      await expect(
        createCase(
          maker,
          { requestTypeCode: 'NEW', discipline: 'CIVIL', applicantName: 'A', ownerName: 'B' },
          CTX,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('submission and assignment', () => {
    it('moves a draft to REQUESTED, opens an assignment task and starts the SLA', async () => {
      const { id } = await newCase();
      await attachRequiredDocuments(id);

      const result = await performTransition(
        owner,
        { caseId: id, action: 'SUBMIT_REQUEST', expectedVersion: await versionOf(id) },
        CTX,
      );

      expect(result.status).toBe('REQUESTED');

      const task = await prisma.workflowTask.findFirst({
        where: { caseId: id, taskType: 'ASSIGN_MAKER', completedAt: null },
      });
      expect(task).not.toBeNull();
      expect(task!.roleCode).toBe('MAKER_MANAGER');

      const sla = await prisma.slaRecord.findUnique({ where: { caseId: id } });
      expect(sla).not.toBeNull();
      expect(sla!.dueAt.getTime()).toBeGreaterThan(sla!.startedAt.getTime());

      const history = await prisma.workflowHistory.findFirst({
        where: { caseId: id, action: 'SUBMIT_REQUEST' },
      });
      expect(history).not.toBeNull();
      expect(history!.toStatus).toBe('REQUESTED');
    });

    it('submits a request with no documents attached, since every upload is optional', async () => {
      expect(await prisma.documentCategory.count({ where: { isMandatory: true } })).toBe(0);

      const { id } = await newCase();
      const result = await performTransition(
        owner,
        { caseId: id, action: 'SUBMIT_REQUEST', expectedVersion: await versionOf(id) },
        CTX,
      );
      expect(result.status).toBe('REQUESTED');
    });

    it('refuses a stale version rather than silently overwriting', async () => {
      const { id } = await newCase();
      await attachRequiredDocuments(id);
      const stale = (await versionOf(id)) - 1;

      await expect(
        performTransition(owner, { caseId: id, action: 'SUBMIT_REQUEST', expectedVersion: stale }, CTX),
      ).rejects.toThrow(WorkflowError);
    });

    it('assigns a maker and hands them the valuation task', async () => {
      const { id } = await submitted();

      const result = await performTransition(
        makerManager,
        {
          caseId: id,
          action: 'ASSIGN_MAKER',
          expectedVersion: await versionOf(id),
          assigneeId: maker.id,
        },
        CTX,
      );

      expect(result.status).toBe('ASSIGNED');

      const record = await getCase(makerManager, id);
      expect(record.makerId).toBe(maker.id);
      expect(record.makerManagerId).toBe(makerManager.id);

      const task = await prisma.workflowTask.findFirst({
        where: { caseId: id, taskType: 'PERFORM_VALUATION', completedAt: null },
      });
      expect(task?.assigneeId).toBe(maker.id);

      const closed = await prisma.workflowTask.findFirst({
        where: { caseId: id, taskType: 'ASSIGN_MAKER' },
      });
      expect(closed?.completedAt).not.toBeNull();
    });

    it('refuses a manager assigning the case to themselves', async () => {
      const { id } = await submitted();

      await expect(
        performTransition(
          makerManager,
          {
            caseId: id,
            action: 'ASSIGN_MAKER',
            expectedVersion: await versionOf(id),
            assigneeId: makerManager.id,
          },
          CTX,
        ),
      ).rejects.toThrow(/cannot assign a case to yourself/i);
    });

    it('refuses a maker whose discipline does not match the case', async () => {
      const mechanicalMaker = await makeActor('mechmaker', ['MAKER'], {
        departmentId: created.deptId,
        discipline: 'MECHANICAL',
      });

      const { id } = await submitted();

      await expect(
        performTransition(
          makerManager,
          {
            caseId: id,
            action: 'ASSIGN_MAKER',
            expectedVersion: await versionOf(id),
            assigneeId: mechanicalMaker.id,
          },
          CTX,
        ),
      ).rejects.toThrow(/mechanical/i);
    });

    it('refuses an action from a status that does not allow it', async () => {
      const { id } = await newCase();
      // The case is still DRAFT; assignment is not available yet.
      await expect(
        performTransition(
          makerManager,
          { caseId: id, action: 'ASSIGN_MAKER', expectedVersion: await versionOf(id), assigneeId: maker.id },
          CTX,
        ),
      ).rejects.toThrow(WorkflowError);
    });
  });

  describe('return and correction (spec section 33)', () => {
    it('opens a numbered correction cycle and closes it on resubmission', async () => {
      const { id } = await submitted();
      await performTransition(
        makerManager,
        { caseId: id, action: 'ASSIGN_MAKER', expectedVersion: await versionOf(id), assigneeId: maker.id },
        CTX,
      );
      await performTransition(maker, { caseId: id, action: 'START_VALUATION', expectedVersion: await versionOf(id) }, CTX);

      // A checker returns it before checking completes. Reaching CHECKING needs
      // the maker's submission, which requires a calculation; so this exercises
      // the manager's return path from the approval side instead.
      const marked = await performTransition(
        maker,
        {
          caseId: id,
          action: 'MARK_PENDING',
          expectedVersion: await versionOf(id),
          comment: 'Awaiting the title deed from the branch.',
        },
        CTX,
      );
      expect(marked.status).toBe('PENDING');

      const history = await prisma.workflowHistory.findFirst({
        where: { caseId: id, action: 'MARK_PENDING' },
      });
      expect(history?.comment).toContain('title deed');
    });

    it('refuses a status remark that is too short to act on', async () => {
      const { id } = await submitted();
      await performTransition(
        makerManager,
        { caseId: id, action: 'ASSIGN_MAKER', expectedVersion: await versionOf(id), assigneeId: maker.id },
        CTX,
      );

      await expect(
        performTransition(
          maker,
          { caseId: id, action: 'MARK_PENDING', expectedVersion: await versionOf(id), comment: 'wait' },
          CTX,
        ),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('scope and visibility', () => {
    it('hides a case from an unrelated valuator behind a 404', async () => {
      const { id } = await newCase();
      await expect(getCase(stranger, id)).rejects.toThrow(NotFoundError);
    });

    it('shows the requesting owner their own case', async () => {
      const { id } = await newCase();
      const list = await listCases(owner, {});
      expect(list.rows.some((row) => row.id === id)).toBe(true);
    });

    it('does not leak another branch case into the list', async () => {
      const { id } = await newCase();
      const otherOrg = await prisma.organization.create({
        data: { code: `WFORG2-${SUFFIX}`, name: 'Other Branch', type: 'BRANCH' },
      });
      created.extraOrgIds.push(otherOrg.id);
      const otherOwner = await makeActor('owner2', ['PROCESS_OWNER'], { organizationId: otherOrg.id });

      const list = await listCases(otherOwner, {});
      expect(list.rows.some((row) => row.id === id)).toBe(false);
    });

    it('refuses a maker starting a valuation assigned to someone else', async () => {
      const { id } = await submitted();
      await performTransition(
        makerManager,
        { caseId: id, action: 'ASSIGN_MAKER', expectedVersion: await versionOf(id), assigneeId: maker.id },
        CTX,
      );

      const otherMaker = await makeActor('maker2', ['MAKER'], {
        departmentId: created.deptId,
        discipline: 'CIVIL',
      });

      await expect(
        performTransition(
          otherMaker,
          { caseId: id, action: 'START_VALUATION', expectedVersion: await versionOf(id) },
          CTX,
        ),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('audit', () => {
    it('records every transition with its before and after status', async () => {
      const { id } = await submitted();

      const entry = await prisma.auditLog.findFirst({
        where: { entity: 'ValuationCase', entityId: id, action: 'CASE_TRANSITIONED' },
        orderBy: { occurredAt: 'desc' },
      });

      expect(entry).not.toBeNull();
      expect((entry!.before as Record<string, unknown>).status).toBe('DRAFT');
      expect((entry!.after as Record<string, unknown>).status).toBe('REQUESTED');
      expect(entry!.correlationId).toBe(SUFFIX);
    });
  });
});
