/**
 * One working demo account for every role, for testing each role's screens.
 *
 *   npx tsx scripts/ops/restore-role-accounts.mts                       new random password
 *   npx tsx scripts/ops/restore-role-accounts.mts --password "Nib@2026"  a password you choose
 *   ... --include-admin   also give the super administrator that password
 *
 * Reactivates the seeded account for each role (creating the one that no
 * longer exists) and gives them all the same password, which is printed at the
 * end. The super administrator (NIB-ADM-001) keeps their password unless
 * --include-admin is given, and no other account is touched.
 *
 * Unlike `npm run db:seed`, this resets nobody else's password - which is why
 * it exists: never run the seed on a database people are using.
 *
 * To remove these accounts again: npx tsx scripts/ops/remove-seed-users.mts --apply
 */
import { randomBytes } from 'node:crypto';

process.loadEnvFile('.env');

if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
  console.error('Demo accounts are refused in production.');
  process.exit(1);
}

const { prisma } = await import('../../src/server/infrastructure/db/client.ts');
const { hashPassword, paramsToJson } = await import(
  '../../src/server/infrastructure/auth/password.ts'
);
const { recordStandalone } = await import('../../src/server/infrastructure/audit/audit-service.ts');

const passwordIndex = process.argv.indexOf('--password');
const password =
  passwordIndex >= 0 && process.argv[passwordIndex + 1]
    ? process.argv[passwordIndex + 1]!
    : `Nib@${randomBytes(4).toString('hex')}`;

type Account = {
  role: string;
  employeeId: string;
  /** Used only when the account no longer exists. */
  create?: {
    email: string;
    fullName: string;
    organization: string;
    department?: string;
    discipline: 'CIVIL' | 'MECHANICAL' | 'BOTH' | 'NONE';
  };
};

const includeAdmin = process.argv.includes('--include-admin');

const ACCOUNTS: Account[] = [
  ...(includeAdmin ? [{ role: 'ADMIN', employeeId: 'NIB-ADM-001' }] : []),
  { role: 'PROCESS_OWNER', employeeId: 'NIB-PO-001' },
  { role: 'MAKER_MANAGER', employeeId: 'NIB-MGR-001' },
  { role: 'MAKER', employeeId: 'NIB-VAL-001' },
  {
    // The seed's checker manager (NIB-MGR-002) has become a real person's
    // account, so the demo one gets its own employee ID.
    role: 'CHECKER_MANAGER',
    employeeId: 'NIB-MGR-004',
    create: {
      email: 'checker.manager@nibbank.example',
      fullName: 'Meron Haile',
      organization: 'HO',
      department: 'PVD',
      discipline: 'BOTH',
    },
  },
  { role: 'CHECKER', employeeId: 'NIB-VAL-004' },
  { role: 'DIRECTOR', employeeId: 'NIB-DIR-001' },
];

const { hash, params } = await hashPassword(password);
const rows: Record<string, string>[] = [];

const admin = await prisma.user.findUnique({
  where: { employeeId: 'NIB-ADM-001' },
  select: { email: true, fullName: true, isActive: true },
});
if (admin && !includeAdmin) {
  rows.push({
    role: 'ADMIN (super admin)',
    name: admin.fullName,
    signIn: admin.email,
    employeeId: 'NIB-ADM-001',
    password: admin.isActive ? '(unchanged - your current one)' : '(INACTIVE)',
  });
}

for (const account of ACCOUNTS) {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: account.role } });

  let user = await prisma.user.findUnique({ where: { employeeId: account.employeeId } });
  if (!user) {
    if (!account.create) {
      console.warn(`${account.employeeId} no longer exists; skipped (${account.role}).`);
      continue;
    }
    const spec = account.create;
    const organization = await prisma.organization.findUnique({ where: { code: spec.organization } });
    const department = spec.department
      ? await prisma.department.findUnique({ where: { code: spec.department } })
      : null;
    user = await prisma.user.create({
      data: {
        employeeId: account.employeeId,
        email: spec.email,
        fullName: spec.fullName,
        organizationId: organization?.id ?? null,
        departmentId: department?.id ?? null,
        discipline: spec.discipline,
      },
    });
  }

  const userId = user.id;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { isActive: true, failedAttempts: 0, lockedUntil: null },
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      update: {},
      create: { userId, roleId: role.id },
    });
    const credential = {
      passwordHash: hash,
      algorithm: params.algorithm,
      params: paramsToJson(params),
      mustChange: false,
      expiresAt: null,
    };
    await tx.credential.upsert({
      where: { userId },
      update: credential,
      create: { userId, ...credential },
    });
  });

  await recordStandalone({
    actorId: null,
    actorRole: null,
    action: 'USER_DEACTIVATED',
    entity: 'User',
    entityId: userId,
    after: { isActive: true, via: 'restore-role-accounts script' },
  });

  rows.push({
    role: account.role,
    name: user.fullName,
    signIn: user.email,
    employeeId: account.employeeId,
    password,
  });
}

console.table(rows);
console.log('Sign in with the email (or the employee ID) and the password shown.');

await prisma.$disconnect();
