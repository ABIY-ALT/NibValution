import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Integrity guarantees enforced by PostgreSQL itself (development rules 7, 9, 16).
 *
 * These deliberately bypass the application's service layer and write straight
 * to the database. That is the point: the application is expected to enforce
 * these rules too, but a bug, a maintenance script or a direct psql session
 * must not be able to corrupt a valuation record. If any of these tests starts
 * passing a write that should fail, the last line of defence is gone.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

let prisma: PrismaClient;

/** Ids created by this suite, torn down in reverse order of creation. */
const created = {
  caseIds: [] as string[],
  userIds: [] as string[],
  orgId: '',
  deptId: '',
  requestTypeId: '',
};

const SUFFIX = `it-${Date.now()}`;

describeIfDb('database integrity', () => {
  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });

    const org = await prisma.organization.create({
      data: { code: `ORG-${SUFFIX}`, name: 'Integration Test Branch', type: 'BRANCH' },
    });
    created.orgId = org.id;

    const dept = await prisma.department.create({
      data: { code: `DEPT-${SUFFIX}`, name: 'Integration Test Department' },
    });
    created.deptId = dept.id;

    const requestType = await prisma.requestType.findFirstOrThrow({ where: { code: 'NEW' } });
    created.requestTypeId = requestType.id;

    for (const suffix of ['maker', 'checker', 'owner']) {
      const user = await prisma.user.create({
        data: {
          employeeId: `EMP-${SUFFIX}-${suffix}`.toUpperCase(),
          email: `${suffix}.${SUFFIX}@test.invalid`,
          fullName: `Test ${suffix}`,
          organizationId: org.id,
          departmentId: dept.id,
          discipline: 'CIVIL',
        },
      });
      created.userIds.push(user.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;

    /**
     * Tearing this fixture down requires temporarily disabling the immutability
     * triggers - which is itself the clearest evidence that they work. In
     * production nothing removes a frozen valuation or a correction cycle;
     * here, a superuser session lifts the guard for the duration of the
     * cleanup and restores it immediately.
     *
     * Audit rows written by this suite are deliberately left in place: the
     * audit trail is append-only, and a test is not an exception to that.
     */
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "valuations" DISABLE TRIGGER "valuations_frozen_immutable"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "correction_cycles" DISABLE TRIGGER "correction_cycles_close_only"',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "valuation_cases" DISABLE TRIGGER "valuation_cases_delete_guard"',
    );

    try {
      // Cases first: users are referenced with ON DELETE RESTRICT.
      for (const caseId of created.caseIds) {
        await prisma.valuationCase.deleteMany({ where: { id: caseId } });
      }
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
      if (created.orgId) await prisma.organization.deleteMany({ where: { id: created.orgId } });
      if (created.deptId) await prisma.department.deleteMany({ where: { id: created.deptId } });
    } finally {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "valuations" ENABLE TRIGGER "valuations_frozen_immutable"',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "correction_cycles" ENABLE TRIGGER "correction_cycles_close_only"',
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "valuation_cases" ENABLE TRIGGER "valuation_cases_delete_guard"',
      );
      await prisma.$disconnect();
    }
  });

  async function createCase(
    overrides: Partial<{ makerId: string; checkerId: string; status: 'DRAFT' | 'APPROVED' }> = {},
  ) {
    const [makerId, checkerId, ownerId] = created.userIds as [string, string, string];
    const record = await prisma.valuationCase.create({
      data: {
        caseNumber: `PV-TEST-${SUFFIX}-${created.caseIds.length + 1}`,
        requestTypeId: created.requestTypeId,
        discipline: 'CIVIL',
        status: overrides.status ?? 'DRAFT',
        requestingOrgId: created.orgId,
        departmentId: created.deptId,
        requestedById: ownerId,
        makerId: overrides.makerId ?? makerId,
        checkerId: overrides.checkerId ?? checkerId,
        applicantName: 'Test Applicant',
        ownerName: 'Test Owner',
      },
    });
    created.caseIds.push(record.id);
    return record;
  }

  describe('segregation of duties (assumption 2.2)', () => {
    it('refuses a case whose maker and checker are the same person', async () => {
      const [makerId] = created.userIds as [string];
      await expect(createCase({ makerId, checkerId: makerId })).rejects.toThrow(
        /valuation_cases_maker_checker_distinct/,
      );
    });

    it('accepts a case with distinct maker and checker', async () => {
      const record = await createCase();
      expect(record.id).toBeTruthy();
    });
  });

  describe('append-only audit trail (spec section 25)', () => {
    it('rejects an update to an audit record', async () => {
      const entry = await prisma.auditLog.create({
        data: { action: 'LOGIN_SUCCESS', entity: 'Test', entityId: SUFFIX },
      });

      await expect(
        prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } }),
      ).rejects.toThrow(/append-only/);
    });

    it('rejects a delete of an audit record', async () => {
      const entry = await prisma.auditLog.create({
        data: { action: 'LOGOUT', entity: 'Test', entityId: SUFFIX },
      });

      await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/,
      );
    });
  });

  describe('valuation immutability (spec section 29, rule 9)', () => {
    it('rejects an update to a frozen valuation version', async () => {
      const record = await createCase();
      const valuation = await prisma.valuation.create({
        data: {
          caseId: record.id,
          version: 1,
          discipline: 'CIVIL',
          formulaVersion: 'test-1',
          marketValue: '1000000.00',
        },
      });

      // Freezing is itself an update, and must be permitted once.
      await prisma.valuation.update({
        where: { id: valuation.id },
        data: { frozenAt: new Date(), status: 'APPROVED' },
      });

      await expect(
        prisma.valuation.update({
          where: { id: valuation.id },
          data: { marketValue: '9999999.00' },
        }),
      ).rejects.toThrow(/frozen and cannot be/);
    });

    it('permits exactly one current version per case', async () => {
      const record = await createCase();
      await prisma.valuation.create({
        data: {
          caseId: record.id,
          version: 1,
          discipline: 'CIVIL',
          formulaVersion: 'test-1',
          isCurrent: true,
        },
      });

      await expect(
        prisma.valuation.create({
          data: {
            caseId: record.id,
            version: 2,
            discipline: 'CIVIL',
            formulaVersion: 'test-1',
            isCurrent: true,
          },
        }),
      ).rejects.toThrow(/valuations_one_current_per_case/);
    });
  });

  describe('reconciliation weights (spec section 11)', () => {
    it('rejects weights that do not total 100', async () => {
      const record = await createCase();
      const valuation = await prisma.valuation.create({
        data: { caseId: record.id, version: 1, discipline: 'CIVIL', formulaVersion: 'test-1' },
      });

      await expect(
        prisma.reconciliation.create({
          data: {
            valuationId: valuation.id,
            costWeight: '60',
            salesWeight: '30',
            reconciledValue: '1000000',
            formula: 'test',
          },
        }),
      ).rejects.toThrow(/reconciliations_weights_total_100/);
    });

    it('accepts weights that total exactly 100', async () => {
      const record = await createCase();
      const valuation = await prisma.valuation.create({
        data: { caseId: record.id, version: 1, discipline: 'CIVIL', formulaVersion: 'test-1' },
      });

      const reconciliation = await prisma.reconciliation.create({
        data: {
          valuationId: valuation.id,
          costWeight: '60',
          salesWeight: '40',
          reconciledValue: '1000000',
          formula: 'cost x 60% + sales x 40%',
        },
      });
      expect(reconciliation.id).toBeTruthy();
    });
  });

  describe('forced-sale override (spec section 12)', () => {
    it('rejects an override with no justification', async () => {
      const record = await createCase();
      const valuation = await prisma.valuation.create({
        data: { caseId: record.id, version: 1, discipline: 'CIVIL', formulaVersion: 'test-1' },
      });

      await expect(
        prisma.forcedSaleValuation.create({
          data: {
            valuationId: valuation.id,
            marketValue: '1000000',
            forcedSalePercent: '60',
            forcedSaleValue: '600000',
            formula: 'market x 60%',
            isOverridden: true,
          },
        }),
      ).rejects.toThrow(/forced_sale_override_requires_reason/);
    });

    it('rejects a forced-sale percentage outside 0-100', async () => {
      const record = await createCase();
      const valuation = await prisma.valuation.create({
        data: { caseId: record.id, version: 1, discipline: 'CIVIL', formulaVersion: 'test-1' },
      });

      await expect(
        prisma.forcedSaleValuation.create({
          data: {
            valuationId: valuation.id,
            marketValue: '1000000',
            forcedSalePercent: '150',
            forcedSaleValue: '1500000',
            formula: 'market x 150%',
          },
        }),
      ).rejects.toThrow(/forced_sale_percent_in_range/);
    });
  });

  describe('approved cases are retained (rule 7)', () => {
    it('refuses to delete an approved case', async () => {
      const record = await createCase({ status: 'APPROVED' });

      await expect(prisma.valuationCase.delete({ where: { id: record.id } })).rejects.toThrow(
        /cannot be deleted/,
      );

      // Return it to a deletable state so the suite can tear itself down.
      await prisma.valuationCase.update({
        where: { id: record.id },
        data: { status: 'CANCELLED' },
      });
    });
  });

  describe('correction cycles preserve the rework history (spec section 33)', () => {
    it('rejects a return comment that is too short to act on', async () => {
      const record = await createCase();
      const [makerId] = created.userIds as [string];

      await expect(
        prisma.correctionCycle.create({
          data: {
            caseId: record.id,
            sequence: 1,
            returnedById: makerId,
            returnedByRole: 'CHECKER',
            previousStatus: 'CHECKING',
            reasonCode: 'CALCULATION_ERROR',
            comment: 'wrong',
          },
        }),
      ).rejects.toThrow(/correction_cycles_comment_present/);
    });

    it('refuses to rewrite the recorded reason for a return', async () => {
      const record = await createCase();
      const [makerId] = created.userIds as [string];

      const cycle = await prisma.correctionCycle.create({
        data: {
          caseId: record.id,
          sequence: 1,
          returnedById: makerId,
          returnedByRole: 'CHECKER',
          previousStatus: 'CHECKING',
          reasonCode: 'CALCULATION_ERROR',
          comment: 'The depreciation rate applied does not match the approved table.',
        },
      });

      await expect(
        prisma.correctionCycle.update({
          where: { id: cycle.id },
          data: { comment: 'Actually it was fine.' },
        }),
      ).rejects.toThrow(/cannot be altered/);

      // Closing the cycle is permitted; only the grievance is immutable.
      const resolved = await prisma.correctionCycle.update({
        where: { id: cycle.id },
        data: { resolvedAt: new Date(), resolutionNote: 'Depreciation table corrected.' },
      });
      expect(resolved.resolvedAt).not.toBeNull();
    });
  });

  describe('case numbers', () => {
    it('rejects a duplicate case number', async () => {
      const record = await createCase();
      const [makerId, checkerId, ownerId] = created.userIds as [string, string, string];

      await expect(
        prisma.valuationCase.create({
          data: {
            caseNumber: record.caseNumber,
            requestTypeId: created.requestTypeId,
            discipline: 'CIVIL',
            requestingOrgId: created.orgId,
            departmentId: created.deptId,
            requestedById: ownerId,
            makerId,
            checkerId,
            applicantName: 'Duplicate',
            ownerName: 'Duplicate',
          },
        }),
      ).rejects.toThrow();
    });
  });
});
