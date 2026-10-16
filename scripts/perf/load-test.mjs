/* eslint-disable no-console -- a command-line tool: the printed report is its output. */
// Load test: N concurrent signed-in users working the application (roadmap
// Phase 8, "40 concurrent users").
//
//   node scripts/perf/load-test.mjs --sessions sessions.json --base http://localhost:3100 \
//        --duration 180 --think 1000-3000
//
// Each virtual user holds one session from prepare-sessions.mts and loops over
// the pages its role actually uses, pausing between clicks like a person does
// (--think, in ms; 0 for a flat-out stress run). Case pages use ids the user
// can see, read from their own request list. Reports p50/p95/p99 per page.

import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const BASE = args.base ?? 'http://localhost:3100';
const DURATION_MS = Number(args.duration ?? 120) * 1000;
const [THINK_MIN, THINK_MAX] = (args.think ?? '1000-3000').split('-').map(Number);
const sessions = JSON.parse(readFileSync(args.sessions, 'utf8'));
const users = sessions.slice(0, Number(args.users ?? sessions.length));

const SEARCH = ['Tadesse', 'Haile', 'PV-2024', 'Bekele', 'Almaz'];

/** The pages each role opens, weighted by how often. `:case` is one of their cases. */
const JOURNEYS = {
  PROCESS_OWNER: [
    ['/dashboard', 3], ['/requests', 3], ['/requests?search=:search', 2], ['/requests/:case', 4],
    ['/notifications', 2], ['/archive', 1],
  ],
  MAKER: [
    ['/dashboard', 2], ['/tasks', 3], ['/requests/:case', 4],
    ['/notifications', 1], ['/civil', 1], ['/mechanical?tab=vehicles', 1], ['/requests?search=:search', 1],
  ],
  CHECKER: [
    ['/dashboard', 2], ['/tasks', 3], ['/requests/:case', 4],
    ['/notifications', 1],
  ],
  MAKER_MANAGER: [
    ['/dashboard', 3], ['/tasks', 2], ['/requests', 2], ['/requests/:case', 2], ['/reports/sla', 1],
    ['/reports', 1], ['/requests?search=:search', 1], ['/tasks/overdue', 1],
  ],
  CHECKER_MANAGER: [
    ['/dashboard', 3], ['/tasks', 2], ['/requests', 2], ['/requests/:case', 2], ['/reports/sla', 1],
  ],
  DIRECTOR: [
    ['/dashboard', 3], ['/tasks/approvals', 2], ['/reports', 2], ['/reports/sla', 2], ['/requests/:case', 2],
  ],
  ADMIN: [['/dashboard', 2], ['/admin/audit', 2], ['/admin/users', 1], ['/requests', 1]],
};

const stats = new Map(); // route -> { times: [], errors: 0, statuses: {} }
const record = (route, ms, status, ok) => {
  const s = stats.get(route) ?? { times: [], errors: 0, statuses: {} };
  s.times.push(ms);
  s.statuses[status] = (s.statuses[status] ?? 0) + 1;
  if (!ok) s.errors += 1;
  stats.set(route, s);
};

async function get(path, token) {
  const started = performance.now();
  let status = 0;
  let body = '';
  try {
    const res = await fetch(BASE + path, {
      headers: { cookie: `nib_session=${token}`, 'user-agent': 'nib-load-test' },
      redirect: 'manual',
    });
    status = res.status;
    body = await res.text();
  } catch (error) {
    status = `ERR ${error.cause?.code ?? error.message}`;
  }
  return { ms: performance.now() - started, status, body };
}

const pick = (weighted) => {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [value, w] of weighted) if ((roll -= w) < 0) return value;
  return weighted[0][0];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = /\/requests\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

async function virtualUser(session, deadline) {
  // The cases this person can open, from their own list - never guessed ids.
  const list = await get('/requests', session.token);
  const cases = [...new Set([...list.body.matchAll(UUID)].map((m) => m[1]))];
  const journey = JOURNEYS[session.role];

  while (Date.now() < deadline) {
    let route = pick(journey);
    if (route.includes(':case') && cases.length === 0) route = '/dashboard';
    const path = route
      .replace(':case', cases[Math.floor(Math.random() * cases.length)] ?? '')
      .replace(':search', encodeURIComponent(SEARCH[Math.floor(Math.random() * SEARCH.length)]));
    const { ms, status } = await get(path, session.token);
    record(route, ms, status, status === 200);
    if (THINK_MAX > 0) await sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const started = Date.now();
const deadline = started + DURATION_MS;
console.log(
  `${users.length} users, ${DURATION_MS / 1000}s, think ${THINK_MIN}-${THINK_MAX}ms, against ${BASE}`,
);
await Promise.all(users.map((s, i) => sleep(i * 50).then(() => virtualUser(s, deadline))));
const elapsed = (Date.now() - started) / 1000;

const rows = [...stats.entries()]
  .map(([route, s]) => {
    const t = [...s.times].sort((a, b) => a - b);
    return {
      route,
      requests: t.length,
      errors: s.errors,
      p50: Math.round(pct(t, 50)),
      p95: Math.round(pct(t, 95)),
      p99: Math.round(pct(t, 99)),
      max: Math.round(t[t.length - 1]),
      statuses: Object.entries(s.statuses).map(([k, v]) => `${k}:${v}`).join(' '),
    };
  })
  .sort((a, b) => b.p95 - a.p95);

const all = [...stats.values()].flatMap((s) => s.times).sort((a, b) => a - b);
const errors = [...stats.values()].reduce((sum, s) => sum + s.errors, 0);
console.table(rows);
console.log(
  JSON.stringify({
    users: users.length,
    seconds: Math.round(elapsed),
    requests: all.length,
    perSecond: Number((all.length / elapsed).toFixed(1)),
    errors,
    p50: Math.round(pct(all, 50)),
    p95: Math.round(pct(all, 95)),
    p99: Math.round(pct(all, 99)),
  }),
);
