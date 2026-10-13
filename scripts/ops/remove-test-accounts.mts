/**
 * Remove the inactive accounts the integration tests leave behind.
 *
 *   npx tsx scripts/ops/remove-test-accounts.mts            preview only, changes nothing
 *   npx tsx scripts/ops/remove-test-accounts.mts --apply    do it
 *
 * Only accounts that are both inactive and on the reserved `@test.invalid`
 * domain are considered - no real address can end that way. Of those, only
 * the ones nothing refers to are deleted. An account that appears in the audit
 * trail, a case or a workflow step stays (deactivated, unable to sign in):
 * the audit trail is append-only by design and must keep the identity behind
 * every action, so its references cannot be removed.
 */
process.loadEnvFile('.env');

const apply = process.argv.includes('--apply');

const { prisma } = await import('../../src/server/infrastructure/db/client.ts');
const { recordStandalone } = await import('../../src/server/infrastructure/audit/audit-service.ts');

// Every foreign key that would block deleting a user, read from the database
// itself so a table added later is respected without editing this script.
const blockers = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(`
  select tc.table_name, kcu.column_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
  join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
  where tc.constraint_type = 'FOREIGN KEY'
    and ccu.table_name = 'users' and ccu.column_name = 'id'
    and rc.delete_rule not in ('CASCADE', 'SET NULL')
`);

const unreferenced = blockers
  .map((b) => `not exists (select 1 from "${b.table_name}" r where r."${b.column_name}" = u.id)`)
  .join('\n    and ');

const where = `
  not u."isActive"
    and u.email like '%@test.invalid'
    ${unreferenced ? `and ${unreferenced}` : ''}`;

const [counts] = await prisma.$queryRawUnsafe<{ inactive_test: number; removable: number }[]>(`
  select
    (select count(*)::int from users u where not u."isActive" and u.email like '%@test.invalid') as inactive_test,
    (select count(*)::int from users u where ${where}) as removable
`);

console.log(`Inactive test accounts:            ${counts.inactive_test}`);
console.log(`  can be deleted (no history):     ${counts.removable}`);
console.log(`  must stay (in audit/cases):      ${counts.inactive_test - counts.removable}`);

if (!apply) {
  console.log('\nPREVIEW - nothing was changed. Run again with --apply to delete them.');
} else if (counts.removable > 0) {
  const deleted = await prisma.$executeRawUnsafe(`delete from users u where ${where}`);
  await recordStandalone({
    actorId: null,
    actorRole: null,
    action: 'USER_UPDATED',
    entity: 'User',
    entityId: null,
    after: { removedTestAccounts: deleted, via: 'remove-test-accounts script' },
  });
  console.log(`\nDeleted ${deleted} test accounts.`);
} else {
  console.log('\nNothing to delete.');
}

await prisma.$disconnect();
