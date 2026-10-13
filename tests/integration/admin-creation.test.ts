import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import {
  createDocumentCategory,
  createPropertyCategory,
  createRequestType,
  createRole,
} from '@/server/application/admin-service';
import { ALL_PERMISSIONS, PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import { ForbiddenError } from '@/lib/errors';

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = Date.now();
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'vitest', correlationId: `smoke-${SUFFIX}` };

// The audit trail has a foreign key to the acting user, so the smoke actor
// borrows a real account rather than inventing an id.
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
const created = {
  roles: [] as string[],
  categories: [] as string[],
  types: [] as string[],
  docs: [] as string[],
};

describeIfDb('administration creation', () => {
  beforeAll(async () => {
    const user = await prisma.user.findFirst({ select: { id: true } });
    if (!user) throw new Error('The database has no users; run the seed first.');
    actorId = user.id;
  });

  afterAll(async () => {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: created.roles } } });
    await prisma.role.deleteMany({ where: { id: { in: created.roles } } });
    await prisma.propertyCategory.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.requestType.deleteMany({ where: { id: { in: created.types } } });
    await prisma.documentCategory.deleteMany({ where: { id: { in: created.docs } } });
    await prisma.$disconnect();
  });

  it('creates a role with grants, derives its code, and audits it', async () => {
    const role = await createRole(
      admin(),
      {
        name: `Smoke Reviewer ${SUFFIX}`,
        description: 'Created by the smoke test.',
        permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.ARCHIVE_SEARCH],
        isActive: true,
      },
      CONTEXT,
    );
    created.roles.push(role.id);

    expect(role.code).toBe(`SMOKE_REVIEWER_${SUFFIX}`);

    const stored = await prisma.role.findUnique({
      where: { id: role.id },
      include: { permissions: { include: { permission: true } } },
    });
    expect(stored?.isSystem).toBe(false);
    expect(stored?.isActive).toBe(true);
    expect(stored?.permissions.map((p) => p.permission.code).sort()).toEqual(
      [PERMISSIONS.ARCHIVE_SEARCH, PERMISSIONS.CASE_READ].sort(),
    );

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Role', entityId: role.id, action: 'ROLE_CREATED' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses a duplicate code rather than silently suffixing it', async () => {
    await expect(
      createRole(
        admin(),
        { name: `Smoke Reviewer ${SUFFIX}`, description: null, permissions: [], isActive: true },
        CONTEXT,
      ),
    ).rejects.toThrow(/already held/i);
  });

  it('refuses to grant a permission the actor does not hold', async () => {
    const limited = actorWith([PERMISSIONS.ROLE_MANAGE, PERMISSIONS.PERMISSION_MANAGE]);
    await expect(
      createRole(
        limited,
        {
          name: `Smoke Escalation ${SUFFIX}`,
          description: null,
          permissions: [PERMISSIONS.SIGNATURE_SIGN],
          isActive: true,
        },
        CONTEXT,
      ),
    ).rejects.toThrow(/do not hold/i);
  });

  it('refuses a caller without role:manage', async () => {
    const nobody = actorWith([PERMISSIONS.CASE_READ]);
    await expect(
      createRole(
        nobody,
        { name: `Smoke Denied ${SUFFIX}`, description: null, permissions: [], isActive: true },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('creates the three configuration kinds and audits each', async () => {
    const category = await createPropertyCategory(
      admin(),
      {
        name: `Smoke Warehouse ${SUFFIX}`,
        description: 'Created by the smoke test.',
        discipline: 'CIVIL',
        isActive: true,
      },
      CONTEXT,
    );
    created.categories.push(category.id);

    const type = await createRequestType(
      admin(),
      { name: `Smoke Revaluation ${SUFFIX}`, description: null, isActive: false },
      CONTEXT,
    );
    created.types.push(type.id);

    const doc = await createDocumentCategory(
      admin(),
      { name: `Smoke Deed ${SUFFIX}`, description: 'Created by the smoke test.', isActive: true },
      CONTEXT,
    );
    created.docs.push(doc.id);

    const storedType = await prisma.requestType.findUnique({ where: { id: type.id } });
    expect(storedType?.isActive).toBe(false);

    const storedCategory = await prisma.propertyCategory.findUnique({ where: { id: category.id } });
    expect(storedCategory?.description).toBe('Created by the smoke test.');
    expect(storedCategory?.discipline).toBe('CIVIL');

    for (const [entity, id] of [
      ['PropertyCategory', category.id],
      ['RequestType', type.id],
      ['DocumentCategory', doc.id],
    ] as const) {
      const audit = await prisma.auditLog.findFirst({
        where: { entity, entityId: id, action: 'CONFIGURATION_CHANGED' },
      });
      expect(audit, `${entity} audit entry`).not.toBeNull();
    }
  });

  it('refuses a request type from a caller holding only category:update', async () => {
    const categoriesOnly = actorWith([PERMISSIONS.CATEGORY_UPDATE]);
    await expect(
      createRequestType(
        categoriesOnly,
        { name: `Smoke Blocked ${SUFFIX}`, description: null, isActive: true },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
