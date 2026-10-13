import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import { publishParameterVersion } from '@/server/application/admin-service';
import { ALL_PERMISSIONS, PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import { BusinessRuleError, ForbiddenError } from '@/lib/errors';
import { publishParameterSchema } from '@/lib/validation/parameters';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = Date.now();
const CODE = `SMOKE_PARAMS_${SUFFIX}`;
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'vitest', correlationId: `smoke-${SUFFIX}` };

// Far in the future, and the seed version inactive: nothing here can become
// the parameter set a real valuation is calculated with.
const START = new Date('2099-01-01T00:00:00Z');

let actorId = '';

function actorWith(permissions: readonly string[]): Actor {
  return {
    id: actorId,
    fullName: 'Smoke Test',
    roles: ['ADMIN'],
    permissions: new Set(permissions) as Actor['permissions'],
    organizationId: null,
    departmentId: null,
    discipline: 'BOTH',
    isActive: true,
    organizationScope: [],
  };
}

const admin = () => actorWith(ALL_PERMISSIONS);

function input(overrides: Record<string, unknown>) {
  return publishParameterSchema.parse({
    setCode: CODE,
    key: 'smoke.percent',
    name: 'Smoke percentage',
    type: 'PERCENT',
    numericValue: '65',
    table: [],
    unit: '%',
    discipline: 'ALL',
    effectiveFrom: '2099-06-01',
    reason: 'Changed by the smoke test.',
    ...overrides,
  });
}

async function version(n: number) {
  return prisma.valuationParameterSet.findUniqueOrThrow({
    where: { code_version: { code: CODE, version: n } },
    include: { parameters: true },
  });
}

describeIfDb('publishing valuation parameters', () => {
  beforeAll(async () => {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error('The database has no users; run the seed first.');
    actorId = user.id;

    await prisma.valuationParameterSet.create({
      data: {
        code: CODE,
        version: 1,
        effectiveFrom: START,
        isActive: false,
        parameters: {
          create: [
            {
              key: 'smoke.percent',
              name: 'Smoke percentage',
              type: 'PERCENT',
              numericValue: '60',
              unit: '%',
              categoryCode: '',
            },
            {
              key: 'smoke.table',
              name: 'Smoke table',
              type: 'TABLE',
              jsonValue: { EXACT: '0.70', PLAIN: 10, flag: true },
              categoryCode: '',
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.valuationParameterSet.deleteMany({ where: { code: CODE } });
    await prisma.$disconnect();
  });

  it('changes a value by publishing a new version, leaving the old one intact', async () => {
    const published = await publishParameterVersion(admin(), input({}), CONTEXT);
    expect(published.version).toBe(2);

    const v1 = await version(1);
    const v2 = await version(2);

    expect(v1.parameters.find((p) => p.key === 'smoke.percent')?.numericValue?.toString()).toBe(
      '60',
    );
    expect(v1.effectiveTo?.toISOString().slice(0, 10)).toBe('2099-06-01');

    expect(v2.isActive).toBe(true);
    expect(v2.description).toBe('Changed by the smoke test.');
    expect(v2.parameters).toHaveLength(2);
    expect(v2.parameters.find((p) => p.key === 'smoke.percent')?.numericValue?.toString()).toBe(
      '65',
    );
    // Everything else is carried over unchanged.
    expect(v2.parameters.find((p) => p.key === 'smoke.table')?.jsonValue).toEqual({
      EXACT: '0.70',
      PLAIN: 10,
      flag: true,
    });

    const audit = await prisma.auditLog.findFirst({
      where: {
        entity: 'ValuationParameterSet',
        entityId: published.id,
        action: 'CONFIGURATION_CHANGED',
      },
    });
    expect(audit).not.toBeNull();
  });

  it('stores table cells as the types the engine reads', async () => {
    await publishParameterVersion(
      admin(),
      input({
        key: 'smoke.table',
        name: 'Smoke table',
        type: 'TABLE',
        numericValue: '',
        unit: '',
        table: [
          { entry: 'EXACT', value: '0.75' },
          { entry: 'PLAIN', value: '12' },
          { entry: 'flag', value: 'false' },
          { entry: 'WORD', value: 'STRAIGHT_LINE' },
        ],
      }),
      CONTEXT,
    );

    const v3 = await version(3);
    // A cell stored as text stays text, so "0.75" keeps its exact decimal
    // form; a flag becomes a real boolean, since "false" would read as true.
    expect(v3.parameters.find((p) => p.key === 'smoke.table')?.jsonValue).toEqual({
      EXACT: '0.75',
      PLAIN: 12,
      flag: false,
      WORD: 'STRAIGHT_LINE',
    });
  });

  it('adds a new parameter alongside the existing ones', async () => {
    await publishParameterVersion(
      admin(),
      input({
        key: 'smoke.new_factor',
        name: 'Smoke factor',
        type: 'FACTOR',
        numericValue: '1.1',
        unit: '',
      }),
      CONTEXT,
    );
    const v4 = await version(4);
    expect(v4.parameters.map((p) => p.key).sort()).toEqual([
      'smoke.new_factor',
      'smoke.percent',
      'smoke.table',
    ]);
  });

  it('refuses to change the kind of value an existing key holds', async () => {
    await expect(
      publishParameterVersion(
        admin(),
        input({ type: 'TABLE', numericValue: '', table: [{ entry: 'A', value: '1' }] }),
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('refuses a date in the past, or before the latest version starts', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await expect(
      publishParameterVersion(admin(), input({ effectiveFrom: yesterday }), CONTEXT),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await expect(
      publishParameterVersion(admin(), input({ effectiveFrom: '2099-03-01' }), CONTEXT),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    const versions = await prisma.valuationParameterSet.count({ where: { code: CODE } });
    expect(versions).toBe(4);
  });

  it('requires the parameter permission', async () => {
    const withoutParameters = ALL_PERMISSIONS.filter((p) => p !== PERMISSIONS.PARAMETER_UPDATE);
    await expect(
      publishParameterVersion(actorWith(withoutParameters), input({}), CONTEXT),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
