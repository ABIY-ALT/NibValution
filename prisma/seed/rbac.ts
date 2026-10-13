import type { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  splitPermission,
} from '../../src/server/domain/rbac/permissions';
import { ROLE_CODES, ROLE_LABELS } from '../../src/server/domain/shared/enums';

const ROLE_DESCRIPTIONS: Record<string, string> = {
  ADMIN: 'Manages users, roles and system configuration. Holds no valuation or approval rights.',
  PROCESS_OWNER: 'Requesting branch, district or head-office unit. Submits requests and receives reports.',
  MAKER_MANAGER: 'Assigns cases to Makers, approves within the manager band, issues final letters.',
  MAKER: 'Civil or Mechanical valuator who performs the valuation.',
  CHECKER_MANAGER: 'Assigns submitted cases to Checkers and monitors checking workload.',
  CHECKER: 'Validates a Maker valuation and may return it for correction.',
  DIRECTOR: 'Approves high-value cases and monitors department performance.',
};

/**
 * Seeds the permission catalogue and the default role grants.
 *
 * Grants are re-applied on every run so a code-level change to
 * DEFAULT_ROLE_PERMISSIONS reaches an existing environment. Grants an
 * administrator has *added* through the admin UI are preserved - only the
 * defaults are asserted, never the absence of others - because wiping an
 * operator's deliberate configuration on deploy would be its own kind of bug.
 */
export async function seedRbac(prisma: PrismaClient): Promise<void> {
  for (const code of ALL_PERMISSIONS) {
    const { resource, action } = splitPermission(code);
    await prisma.permission.upsert({
      where: { code },
      update: { resource, action, description: PERMISSION_DESCRIPTIONS[code] ?? null },
      create: { code, resource, action, description: PERMISSION_DESCRIPTIONS[code] ?? null },
    });
  }
  console.warn(`  permissions: ${ALL_PERMISSIONS.length}`);

  for (const code of ROLE_CODES) {
    await prisma.role.upsert({
      where: { code },
      update: { name: ROLE_LABELS[code], description: ROLE_DESCRIPTIONS[code] ?? null },
      create: {
        code,
        name: ROLE_LABELS[code],
        description: ROLE_DESCRIPTIONS[code] ?? null,
        isSystem: true,
      },
    });
  }
  console.warn(`  roles: ${ROLE_CODES.length}`);

  let grants = 0;
  for (const roleCode of ROLE_CODES) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    for (const permissionCode of DEFAULT_ROLE_PERMISSIONS[roleCode]) {
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { code: permissionCode },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      grants += 1;
    }
  }
  console.warn(`  role-permission grants: ${grants}`);
}
