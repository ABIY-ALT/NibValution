import type { PrismaClient } from '@prisma/client';
import {
  hashPassword,
  paramsToJson,
  CURRENT_HASH_PARAMS,
} from '../../src/server/infrastructure/auth/password';

/**
 * Development and UAT accounts (spec section 39).
 *
 * Two rules govern this file:
 *
 *  1. **No credential appears in source.** The password comes from
 *     SEED_DEFAULT_PASSWORD and the seed refuses to run without it. There is no
 *     fallback default, because a fallback is exactly what ends up shipped.
 *  2. **Never in production.** `prisma/seed/index.ts` aborts when
 *     NODE_ENV=production, so these accounts cannot be created on a live system
 *     even by accident.
 *
 * Every account is created with `mustChange: true`, so the first login forces a
 * new password even in a test environment.
 */

type UserSeed = {
  employeeId: string;
  email: string;
  fullName: string;
  roles: readonly string[];
  organization?: string;
  department?: string;
  discipline: 'CIVIL' | 'MECHANICAL' | 'BOTH' | 'NONE';
};

const USERS: readonly UserSeed[] = [
  {
    employeeId: 'NIB-ADM-001',
    email: 'admin@nibbank.example',
    fullName: 'System Administrator',
    roles: ['ADMIN'],
    organization: 'HO',
    discipline: 'NONE',
  },

  // --- Requesting units ---
  {
    employeeId: 'NIB-PO-001',
    email: 'mexico.po@nibbank.example',
    fullName: 'Hanna Girma',
    roles: ['PROCESS_OWNER'],
    organization: 'BR_MEXICO',
    discipline: 'NONE',
  },
  {
    employeeId: 'NIB-PO-002',
    email: 'bole.po@nibbank.example',
    fullName: 'Dawit Alemu',
    roles: ['PROCESS_OWNER'],
    organization: 'BR_BOLE',
    discipline: 'NONE',
  },
  {
    employeeId: 'NIB-PO-003',
    email: 'bahirdar.po@nibbank.example',
    fullName: 'Selam Tadesse',
    roles: ['PROCESS_OWNER'],
    organization: 'BR_BAHIRDAR',
    discipline: 'NONE',
  },

  // --- Valuation department ---
  {
    employeeId: 'NIB-MGR-001',
    email: 'maker.manager@nibbank.example',
    fullName: 'Yonas Bekele',
    roles: ['MAKER_MANAGER'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'BOTH',
  },
  {
    employeeId: 'NIB-MGR-002',
    email: 'checker.manager@nibbank.example',
    fullName: 'Meron Haile',
    roles: ['CHECKER_MANAGER'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'BOTH',
  },
  {
    employeeId: 'NIB-VAL-001',
    email: 'civil.maker@nibbank.example',
    fullName: 'Abel Tesfaye',
    roles: ['MAKER'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'CIVIL',
  },
  {
    employeeId: 'NIB-VAL-002',
    email: 'civil.maker2@nibbank.example',
    fullName: 'Rahel Mengistu',
    roles: ['MAKER'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'CIVIL',
  },
  {
    employeeId: 'NIB-VAL-003',
    email: 'mech.maker@nibbank.example',
    fullName: 'Samuel Wolde',
    roles: ['MAKER'],
    organization: 'HO',
    department: 'PVD_MECH',
    discipline: 'MECHANICAL',
  },
  {
    employeeId: 'NIB-VAL-004',
    email: 'civil.checker@nibbank.example',
    fullName: 'Tigist Assefa',
    roles: ['CHECKER'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'CIVIL',
  },
  {
    employeeId: 'NIB-VAL-005',
    email: 'mech.checker@nibbank.example',
    fullName: 'Bereket Nigussie',
    roles: ['CHECKER'],
    organization: 'HO',
    department: 'PVD_MECH',
    discipline: 'MECHANICAL',
  },
  {
    employeeId: 'NIB-DIR-001',
    email: 'director@nibbank.example',
    fullName: 'Almaz Kebede',
    roles: ['DIRECTOR'],
    organization: 'HO',
    department: 'PVD',
    discipline: 'BOTH',
  },

  // A user holding both manager roles, which the spec permits. The workflow
  // engine still forbids them from checking a case they made, so this account
  // exercises the segregation-of-duties guard rather than bypassing it.
  {
    employeeId: 'NIB-MGR-003',
    email: 'dual.manager@nibbank.example',
    fullName: 'Kalkidan Fikru',
    roles: ['MAKER_MANAGER', 'CHECKER_MANAGER'],
    organization: 'HO',
    department: 'PVD_MECH',
    discipline: 'BOTH',
  },
];

export async function seedUsers(prisma: PrismaClient, password: string): Promise<void> {
  const { hash, params } = await hashPassword(password, CURRENT_HASH_PARAMS);

  for (const seed of USERS) {
    const organization = seed.organization
      ? await prisma.organization.findUniqueOrThrow({ where: { code: seed.organization } })
      : null;
    const department = seed.department
      ? await prisma.department.findUniqueOrThrow({ where: { code: seed.department } })
      : null;

    const user = await prisma.user.upsert({
      where: { employeeId: seed.employeeId },
      update: {
        email: seed.email,
        fullName: seed.fullName,
        organizationId: organization?.id ?? null,
        departmentId: department?.id ?? null,
        discipline: seed.discipline,
        isActive: true,
      },
      create: {
        employeeId: seed.employeeId,
        email: seed.email,
        fullName: seed.fullName,
        organizationId: organization?.id ?? null,
        departmentId: department?.id ?? null,
        discipline: seed.discipline,
      },
    });

    await prisma.credential.upsert({
      where: { userId: user.id },
      update: { passwordHash: hash, params: paramsToJson(params), mustChange: true },
      create: {
        userId: user.id,
        passwordHash: hash,
        algorithm: params.algorithm,
        params: paramsToJson(params),
        mustChange: true,
      },
    });

    for (const roleCode of seed.roles) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
  }

  console.warn(`  users: ${USERS.length} (all flagged must-change-password)`);
}

export const SEED_USER_SUMMARY = USERS.map((u) => ({
  employeeId: u.employeeId,
  name: u.fullName,
  roles: u.roles.join(', '),
}));
