/**
 * Development helper: create a draft case owned by a seeded Process Owner and
 * print its id, for smoke-testing the running application.
 *
 *   npx tsx scripts/dev-case.mts [email]
 */
process.loadEnvFile('.env');

if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
  console.error('dev-case is refused in production.');
  process.exit(1);
}
process.env.APP_ENV = 'development';

const { prisma } = await import('../src/server/infrastructure/db/client.ts');
const { createCase } = await import('../src/server/application/case-service.ts');
import type { Actor } from '../src/server/domain/rbac/authorize.ts';
import type { PermissionCode } from '../src/server/domain/rbac/permissions.ts';
import type { RoleCode } from '../src/server/domain/shared/enums.ts';

const email = process.argv[2] ?? 'mexico.po@nibbank.example';

const user = await prisma.user.findFirstOrThrow({
  where: { email },
  include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
  },
});

const permissions = new Set<PermissionCode>();
for (const userRole of user.roles) {
  for (const grant of userRole.role.permissions) {
    permissions.add(grant.permission.code as PermissionCode);
  }
}

const actor: Actor = {
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

const created = await createCase(
  actor,
  {
    requestTypeCode: 'NEW',
    discipline: 'CIVIL',
    applicantName: 'Document Smoke Test',
    ownerName: 'Document Smoke Owner',
  },
  { correlationId: 'dev-case' },
);

process.stdout.write(created.id);
process.exit(0);
