/**
 * Load-test sessions (roadmap Phase 8).
 *
 * Gives every seeded account a known password in a disposable *_perf database
 * and signs in the virtual users of the load test through the real login path,
 * writing their session tokens to a file for `load-test.mjs`.
 *
 *   DATABASE_URL=postgresql://.../nib_valuation_perf \
 *   PERF_PASSWORD='...' npx tsx scripts/perf/prepare-sessions.mts sessions.json
 *
 * Refuses to run against any database whose name does not end in _perf.
 */
process.loadEnvFile('.env');
process.env.APP_ENV = 'development';

const url = new URL(process.env.DATABASE_URL ?? '');
if (!url.pathname.endsWith('_perf')) {
  console.error(`Refusing: ${url.pathname.slice(1)} is not a *_perf database.`);
  process.exit(1);
}

const out = process.argv[2];
const password = process.env.PERF_PASSWORD;
if (!out || !password) {
  console.error('Usage: PERF_PASSWORD=... npx tsx scripts/perf/prepare-sessions.mts <out.json>');
  process.exit(1);
}

const { writeFileSync } = await import('node:fs');
const { prisma } = await import('../../src/server/infrastructure/db/client.ts');
const { login } = await import('../../src/server/application/auth-service.ts');
const { hashPassword, paramsToJson } = await import(
  '../../src/server/infrastructure/auth/password.ts'
);

// Forty people at once, in roughly the bank's proportions: branches raise
// requests, valuators and checkers work them, a few managers and a director
// approve, an administrator looks after it all.
const MIX: [employeeId: string, role: string, count: number][] = [
  ['NIB-PO-001', 'PROCESS_OWNER', 5],
  ['NIB-PO-002', 'PROCESS_OWNER', 5],
  ['NIB-PO-003', 'PROCESS_OWNER', 5],
  ['NIB-VAL-001', 'MAKER', 4],
  ['NIB-VAL-002', 'MAKER', 4],
  ['NIB-VAL-003', 'MAKER', 4],
  ['NIB-VAL-004', 'CHECKER', 3],
  ['NIB-VAL-005', 'CHECKER', 2],
  ['NIB-MGR-001', 'MAKER_MANAGER', 2],
  ['NIB-MGR-002', 'CHECKER_MANAGER', 2],
  ['NIB-MGR-003', 'MAKER_MANAGER', 1],
  ['NIB-DIR-001', 'DIRECTOR', 2],
  ['NIB-ADM-001', 'ADMIN', 1],
];

const { hash, params } = await hashPassword(password);
const users = await prisma.user.findMany({ select: { id: true, employeeId: true, email: true } });
for (const user of users) {
  await prisma.credential.update({
    where: { userId: user.id },
    data: { passwordHash: hash, params: paramsToJson(params), mustChange: false, expiresAt: null },
  });
}

const sessions: { employeeId: string; email: string; role: string; token: string }[] = [];
let vu = 0;
for (const [employeeId, role, count] of MIX) {
  const user = users.find((u) => u.employeeId === employeeId);
  if (!user) throw new Error(`${employeeId} is not seeded`);
  for (let i = 0; i < count; i += 1) {
    vu += 1;
    const result = await login(user.email, password, {
      ipAddress: `10.99.0.${vu}`,
      userAgent: 'nib-load-test',
      correlationId: `perf-prepare-${vu}`,
    });
    sessions.push({ employeeId, email: user.email, role, token: result.session.token });
  }
}

writeFileSync(out, JSON.stringify(sessions, null, 1));
console.log(`${sessions.length} sessions written to ${out}`);
await prisma.$disconnect();
process.exit(0);
