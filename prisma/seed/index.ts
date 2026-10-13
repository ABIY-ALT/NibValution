import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedRbac } from './rbac';
import { seedConfiguration } from './configuration';
import { seedOrganizations } from './organization';
import { seedUsers, SEED_USER_SUMMARY } from './users';

try {
  process.loadEnvFile('.env');
} catch {
  // Rely on the ambient environment when there is no .env file.
}

/**
 * Development and UAT seed.
 *
 * Split in two by intent:
 *
 *  * **Reference data** - roles, permissions, request types, property and
 *    document categories, approval thresholds, valuation parameters, SLA policy,
 *    notification rules, system configuration. This is genuine configuration the
 *    system needs in every environment, production included, and it is
 *    idempotent: re-running never overwrites an operator's tuned values.
 *
 *  * **Sample records** - organisations and user accounts. These are
 *    development and UAT fixtures. The seed refuses to run in production so they
 *    cannot reach a live system.
 */
async function main(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (nodeEnv === 'production') {
    throw new Error(
      'Seeding is refused when NODE_ENV=production. Development accounts must never exist on a live system; ' +
        'load reference data through the administration UI or a reviewed migration instead.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  }

  const password = process.env.SEED_DEFAULT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error(
      'SEED_DEFAULT_PASSWORD must be set to at least 12 characters. ' +
        'There is deliberately no built-in default - a fallback credential is the kind that ends up in production.',
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    console.warn(`Seeding NIB Property Valuation database (NODE_ENV=${nodeEnv})`);

    console.warn('\nReference data');
    await seedRbac(prisma);
    await seedConfiguration(prisma);

    console.warn('\nSample records (development and UAT only)');
    await seedOrganizations(prisma);
    await seedUsers(prisma, password);

    console.warn('\nSeed complete.\n');
    console.warn('Development accounts (password from SEED_DEFAULT_PASSWORD, change on first login):');
    for (const user of SEED_USER_SUMMARY) {
      console.warn(`  ${user.employeeId.padEnd(12)} ${user.name.padEnd(22)} ${user.roles}`);
    }
    console.warn(
      '\nSeveral seeded valuation parameters await confirmation by the Property Valuation Department.\n' +
        'See docs/00-assumptions-and-open-questions.md - in particular MCF (3.1), lease-land treatment (3.5)\n' +
        'and the reconciliation weights (3.2). Figures produced before those are confirmed are provisional.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
