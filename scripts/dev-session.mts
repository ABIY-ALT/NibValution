/**
 * Development helper: sign in as a seeded account and print a session cookie.
 *
 * Used for smoke-testing the running application from the shell. Refuses to run
 * outside development so it can never be used against a live system.
 *
 *   npx tsx scripts/dev-session.mts <email> <new-password>
 */
process.loadEnvFile('.env');

if ((process.env.APP_ENV ?? process.env.NODE_ENV) === 'production') {
  console.error('dev-session is refused in production.');
  process.exit(1);
}
process.env.APP_ENV = 'development';

const { login, changePassword } = await import('../src/server/application/auth-service.ts');

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: npx tsx scripts/dev-session.mts <email> <new-password>');
  process.exit(1);
}

const ctx = { ipAddress: '127.0.0.1', userAgent: 'dev-session', correlationId: 'dev-session' };
const seedPassword = process.env.SEED_DEFAULT_PASSWORD;

if (!seedPassword) {
  console.error('SEED_DEFAULT_PASSWORD is not set.');
  process.exit(1);
}

// Seeded accounts are created must-change, so the first sign-in rotates the
// password before a usable session exists.
const first = await login(email, seedPassword, ctx).catch(() => null);
if (first) {
  await changePassword(first.userId, first.session.sessionId, seedPassword, newPassword, ctx);
}

const session = await login(email, newPassword, ctx);
process.stdout.write(session.session.token);
process.exit(0);
