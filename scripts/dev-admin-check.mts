/**
 * Development check: prove the administrator can act across the workflow, and
 * that the action is attributed to ADMIN in the case history.
 *
 *   npx tsx scripts/dev-admin-check.mts
 */
import { randomBytes } from 'node:crypto';

process.loadEnvFile('.env');

if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
  console.error('dev-admin-check is refused in production.');
  process.exit(1);
}
process.env.APP_ENV = 'development';

const { prisma } = await import('../src/server/infrastructure/db/client.ts');
const { createCase, performTransition, actionsFor } = await import(
  '../src/server/application/case-service.ts'
);
import type { Actor } from '../src/server/domain/rbac/authorize.ts';
import type { PermissionCode } from '../src/server/domain/rbac/permissions.ts';
import type { RoleCode } from '../src/server/domain/shared/enums.ts';

async function actorFor(email: string): Promise<Actor> {
  const user = await prisma.user.findFirstOrThrow({
    where: { email },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  const permissions = new Set<PermissionCode>();
  for (const ur of user.roles) {
    for (const g of ur.role.permissions) permissions.add(g.permission.code as PermissionCode);
  }
  return {
    id: user.id,
    fullName: user.fullName,
    roles: user.roles.map((r) => r.role.code as RoleCode),
    permissions,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    discipline: user.discipline,
    isActive: user.isActive,
    organizationScope: user.organizationId ? [user.organizationId] : [],
  };
}

const ctx = { correlationId: 'admin-check' };
const admin = await actorFor('admin@nibbank.example');
const owner = await actorFor('mexico.po@nibbank.example');
const maker = await actorFor('civil.maker@nibbank.example');

console.log(`admin roles=${admin.roles.join(',')} permissions=${admin.permissions.size}`);

// A case raised by a branch the administrator has no relationship to.
const created = await createCase(
  owner,
  {
    requestTypeCode: 'NEW',
    discipline: 'CIVIL',
    applicantName: 'Admin Authority Check',
    ownerName: 'Admin Authority Owner',
  },
  ctx,
);
console.log(`case         ${created.caseNumber}`);

// Satisfy the mandatory-document guard.
const categories = await prisma.documentCategory.findMany({
  where: { isMandatory: true, isActive: true, OR: [{ discipline: null }, { discipline: 'CIVIL' }] },
});
for (const category of categories) {
  await prisma.propertyDocument.create({
    data: {
      caseId: created.id,
      categoryId: category.id,
      originalFilename: `${category.code}.pdf`,
      // storageKey is globally unique, so the fixture generates a fresh one.
      storageKey: `documents/${randomBytes(16).toString('hex')}`,
      mimeType: 'application/pdf',
      sizeBytes: 512,
      sha256: 'c'.repeat(64),
      scanStatus: 'CLEAN',
      uploadedById: owner.id,
    },
  });
}

const version = async () =>
  (await prisma.valuationCase.findUniqueOrThrow({
    where: { id: created.id },
    select: { version: true },
  })).version;

// The administrator submits on the branch's behalf, then assigns — two roles
// they do not hold.
console.log(
  `submit       ${(await performTransition(admin, { caseId: created.id, action: 'SUBMIT_REQUEST', expectedVersion: await version() }, ctx)).status}`,
);
console.log(
  `assign       ${(await performTransition(admin, { caseId: created.id, action: 'ASSIGN_MAKER', expectedVersion: await version(), assigneeId: maker.id }, ctx)).status}`,
);

const snapshot = await prisma.valuationCase.findUniqueOrThrow({
  where: { id: created.id },
  select: {
    id: true, caseNumber: true, status: true, version: true, discipline: true, finalValue: true,
    requestingOrgId: true, departmentId: true, requestedById: true, makerId: true, checkerId: true,
  },
});

console.log(
  `admin can do ${actionsFor(admin, {
    ...snapshot,
    discipline: snapshot.discipline as 'CIVIL' | 'MECHANICAL',
    finalValue: snapshot.finalValue?.toString() ?? null,
  }).join(', ')}`,
);

const history = await prisma.workflowHistory.findMany({
  where: { caseId: created.id },
  orderBy: { occurredAt: 'asc' },
  select: { action: true, actorRole: true, toStatus: true },
});
console.log('history      ' + history.map((h) => `${h.action}[${h.actorRole}]`).join(' → '));

process.exit(0);
