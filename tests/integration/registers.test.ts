import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import { createCase, getCase } from '@/server/application/case-service';
import {
  listCivilRegister,
  listMechanicalRegister,
} from '@/server/application/property-register-service';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { RoleCode } from '@/server/domain/shared/enums';
import { NotFoundError } from '@/lib/errors';

/**
 * The property registers are scoped like the case list (roadmap Phase 8,
 * spec section 26). They previously listed every property in the bank to any
 * user holding `valuation:read`, which every branch Process Owner does.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `reg-${Date.now()}`;
const CTX = { ipAddress: '10.0.0.8', userAgent: 'vitest', correlationId: SUFFIX };
const created = { userIds: [] as string[], caseIds: [] as string[], orgIds: [] as string[] };

async function makeActor(
  label: string,
  roles: RoleCode[],
  opts: { organizationId?: string; departmentId?: string } = {},
): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      employeeId: `REG-${SUFFIX}-${label}`.toUpperCase(),
      email: `${label}.${SUFFIX}@test.invalid`,
      fullName: `REG ${label}`,
      organizationId: opts.organizationId ?? null,
      departmentId: opts.departmentId ?? null,
      discipline: 'BOTH',
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

describeIfDb('property registers', () => {
  let ownerA: Actor;
  let ownerB: Actor;
  let manager: Actor;
  const lhc = { a: `LHC-A-${SUFFIX}`, b: `LHC-B-${SUFFIX}` };
  const plate = { a: `AA-${Date.now() % 100000}`, b: `BB-${Date.now() % 100000}` };

  async function civilCase(owner: Actor, lhcNumber: string, categoryId: string) {
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
    created.caseIds.push(intake.id);
    await prisma.civilProperty.create({
      data: {
        caseId: intake.id,
        categoryId,
        lhcNumber,
        subCity: 'Bole',
        landHoldingRight: 'FREEHOLD',
        plotArea: '250.5',
      },
    });
    return intake.id;
  }

  async function mechanicalCase(owner: Actor, plateNumber: string) {
    const intake = await createCase(
      owner,
      {
        requestTypeCode: 'NEW',
        discipline: 'MECHANICAL',
        applicantName: 'Applicant',
        ownerName: 'Owner',
      },
      CTX,
    );
    created.caseIds.push(intake.id);
    await prisma.mechanicalProperty.create({
      data: {
        caseId: intake.id,
        vehicles: { create: { itemNumber: 1, plateNumber, make: 'Isuzu', condition: 'GOOD' } },
      },
    });
    return intake.id;
  }

  beforeAll(async () => {
    const [orgA, orgB] = await Promise.all(
      ['A', 'B'].map((x) =>
        prisma.organization.create({
          data: { code: `REGORG${x}-${SUFFIX}`, name: `Register Branch ${x}`, type: 'BRANCH' },
        }),
      ),
    );
    created.orgIds.push(orgA!.id, orgB!.id);
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: 'PVD' } });

    ownerA = await makeActor('ownerA', ['PROCESS_OWNER'], { organizationId: orgA!.id });
    ownerB = await makeActor('ownerB', ['PROCESS_OWNER'], { organizationId: orgB!.id });
    manager = await makeActor('mgr', ['MAKER_MANAGER'], { departmentId: dept.id });

    const category = await prisma.propertyCategory.findFirstOrThrow({
      where: { discipline: 'CIVIL', isActive: true },
      select: { id: true },
    });
    await civilCase(ownerA, lhc.a, category.id);
    await civilCase(ownerB, lhc.b, category.id);
    await mechanicalCase(ownerA, plate.a);
    await mechanicalCase(ownerB, plate.b);
  });

  afterAll(async () => {
    const guards: [string, string][] = [
      ['valuation_cases', 'valuation_cases_delete_guard'],
      ['workflow_history', 'workflow_history_append_only'],
    ];
    for (const [table, trigger] of guards) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    }
    try {
      await prisma.valuationCase.deleteMany({ where: { id: { in: created.caseIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: created.userIds } } });
      await prisma.user.updateMany({
        where: { id: { in: created.userIds } },
        data: { organizationId: null, isActive: false },
      });
      await prisma.organization.deleteMany({ where: { id: { in: created.orgIds } } });
    } finally {
      for (const [table, trigger] of guards) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      }
      await prisma.$disconnect();
    }
  });

  const lhcs = (rows: { lhcNumber: string | null }[]) => rows.map((r) => r.lhcNumber);

  it('shows a branch its own civil collateral and nothing of another branch', async () => {
    const register = await listCivilRegister(ownerA, { pageSize: 100 });
    expect(lhcs(register.rows)).toContain(lhc.a);
    expect(lhcs(register.rows)).not.toContain(lhc.b);
    expect(register.summary.properties).toBe(register.total);
  });

  it('cannot be searched into another branch', async () => {
    const search = await listCivilRegister(ownerA, { search: lhc.b });
    expect(search.total).toBe(0);
    expect(search.rows).toEqual([]);
  });

  it('searches the whole register in the database, not the latest page', async () => {
    const found = await listCivilRegister(ownerB, { search: lhc.b.toLowerCase(), pageSize: 5 });
    expect(lhcs(found.rows)).toEqual([lhc.b]);
  });

  it('shows the department both branches', async () => {
    const register = await listCivilRegister(manager, { search: SUFFIX, pageSize: 100 });
    expect(lhcs(register.rows).sort()).toEqual([lhc.a, lhc.b].sort());
  });

  it('scopes the mechanical register and its totals the same way', async () => {
    const a = await listMechanicalRegister(ownerA, { tab: 'vehicles', pageSize: 100 });
    const plates = a.vehicles.map((v) => v.plateNumber);
    expect(plates).toContain(plate.a);
    expect(plates).not.toContain(plate.b);
    expect(a.summary.vehicles).toBe(a.total);

    const probe = await listMechanicalRegister(ownerA, { tab: 'vehicles', search: plate.b });
    expect(probe.total).toBe(0);
  });

  it('answers a malformed case id with "not found", not a database error', async () => {
    await expect(getCase(ownerA, 'not-a-uuid')).rejects.toBeInstanceOf(NotFoundError);
  });
});
