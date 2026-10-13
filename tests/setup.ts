/**
 * Test bootstrap.
 *
 * Loads .env so integration tests reach the same database the application uses,
 * and pins APP_ENV to `test` so the strict production-only environment rules do
 * not reject a developer's local configuration.
 */
try {
  process.loadEnvFile('.env');
} catch {
  // Rely on the ambient environment (CI) when there is no .env file.
}

process.env.APP_ENV = 'test';

// NODE_ENV is typed readonly by @types/node, so it is set through an indexed
// write. Only defaulted, never overridden - a runner that already set it knows
// better than this file does.
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = 'test';
}
