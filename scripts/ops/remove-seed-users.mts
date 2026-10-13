/**
 * Remove the demo accounts the seed creates - every one except the super
 * administrator (NIB-ADM-001), and never any account holding the ADMIN role.
 *
 *   npx tsx scripts/ops/remove-seed-users.mts            preview only, changes nothing
 *   npx tsx scripts/ops/remove-seed-users.mts --apply    do it
 *
 * Add `--keep NIB-DIR-001,NIB-VAL-001` to leave named accounts alone, e.g. a
 * seeded account someone has since taken over as their own.
 *
 * An account nothing refers to is deleted outright. One that appears in cases
 * or the audit trail cannot be - the history must keep the identity behind
 * what was done - so it is deactivated instead: signed out everywhere, its
 * password and any set-up links removed, so it can never sign in again.
 *
 * Re-running `npm run db:seed` would bring the accounts back (and reset the
 * seeded passwords), so do not run the seed afterwards.
 */
process.loadEnvFile('.env');

const apply = process.argv.includes('--apply');
const keepIndex = process.argv.indexOf('--keep');
const keep = new Set(
  keepIndex >= 0
    ? (process.argv[keepIndex + 1] ?? '')
        .split(',')
        .map((id) => id.trim().toUpperCase())
        .filter(Boolean)
    : [],
);

const { prisma } = await import('../../src/server/infrastructure/db/client.ts');
const { recordStandalone } = await import('../../src/server/infrastructure/audit/audit-service.ts');
const { SEED_USER_SUMMARY } = await import('../../prisma/seed/users.ts');

const SUPER_ADMIN = 'NIB-ADM-001';

class Rollback extends Error {}

/** A foreign-key refusal: something still refers to the account. */
function isReferenced(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 'P2003' || /foreign key/i.test(message);
}

const candidates = await prisma.user.findMany({
  where: {
    employeeId: {
      in: SEED_USER_SUMMARY.map((u) => u.employeeId).filter(
        (id) => id !== SUPER_ADMIN && !keep.has(id),
      ),
    },
    // Belt and braces: whatever the list says, an administrator is never touched.
    NOT: { roles: { some: { role: { code: 'ADMIN' } } } },
  },
  select: { id: true, employeeId: true, email: true, fullName: true, isActive: true },
  orderBy: { employeeId: 'asc' },
});

if (candidates.length === 0) {
  console.log('No seeded demo accounts found. Nothing to do.');
  await prisma.$disconnect();
  process.exit(0);
}

console.log(apply ? 'Removing seeded demo accounts:\n' : 'PREVIEW - nothing is changed. Add --apply to do it.\n');

const results: { employeeId: string; email: string; outcome: string }[] = [];

for (const user of candidates) {
  // Try the delete in a transaction; in preview it is always rolled back.
  let outcome: string;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: user.id } });
      if (!apply) throw new Rollback();
    });
    outcome = 'deleted';
  } catch (error) {
    if (error instanceof Rollback) {
      outcome = 'would be deleted';
    } else if (isReferenced(error)) {
      if (apply) {
        await prisma.$transaction(async (tx) => {
          await tx.session.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          await tx.passwordToken.deleteMany({ where: { userId: user.id } });
          await tx.credential.deleteMany({ where: { userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: { isActive: false, failedAttempts: 0, lockedUntil: null },
          });
        });
        outcome = 'deactivated (has history)';
      } else {
        outcome = 'would be deactivated (has history)';
      }
    } else {
      throw error;
    }
  }

  if (apply) {
    await recordStandalone({
      actorId: null,
      actorRole: null,
      action: 'USER_DEACTIVATED',
      entity: 'User',
      entityId: user.id,
      before: { isActive: user.isActive, employeeId: user.employeeId },
      after: { isActive: false, deleted: outcome === 'deleted', via: 'remove-seed-users script' },
    });
  }

  results.push({ employeeId: user.employeeId, email: user.email, outcome });
}

console.table(results);

const admins = await prisma.user.count({
  where: { isActive: true, roles: { some: { role: { code: 'ADMIN' } } } },
});
console.log(`\nActive administrators remaining: ${admins}`);
if (!apply) console.log('Run again with --apply to make these changes.');

await prisma.$disconnect();
