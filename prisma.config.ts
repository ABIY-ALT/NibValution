import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * The connection URL lives here rather than in schema.prisma, and the runtime
 * client connects through the `pg` driver adapter (see
 * src/server/infrastructure/db/client.ts). That split is deliberate: the CLI
 * needs a direct URL for migrations, while the application pools connections
 * explicitly - which matters at 40 concurrent users on a single database.
 */

// Node loads .env for `next dev`, but the Prisma CLI runs outside that, so the
// file is loaded here as well. Missing .env is fine when the variable is
// already present in the environment (CI, container deployments).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file - rely on the ambient environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
});
