/* eslint-disable no-console -- a command-line tool: the printed report is its output. */
// The morning sign-in rush (roadmap Phase 8): N people signing in at the same
// moment, through the real login form, from one address - which is how an
// office behind a single proxy or NAT looks to the server.
//
//   PERF_PASSWORD=... node scripts/perf/login-storm.mjs --sessions sessions.json \
//        --base http://localhost:3100 [--users 40]
//
// Posts the form exactly as a browser without JavaScript does (the server
// action's hidden fields plus identifier and password), and counts how many
// sign-ins succeed, how many are throttled, and how long each takes.

import { readFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const BASE = args.base ?? 'http://localhost:3100';
const password = process.env.PERF_PASSWORD;
if (!password) throw new Error('Set PERF_PASSWORD.');
const people = JSON.parse(readFileSync(args.sessions, 'utf8')).slice(0, Number(args.users ?? 40));

const page = await (await fetch(`${BASE}/login`)).text();
const form = page.slice(page.indexOf('<form'), page.indexOf('</form>'));
const hidden = [...form.matchAll(/<input type="hidden" name="([^"]+)"(?: value="([^"]*)")?\/>/g)].map(
  ([, name, value = '']) => [name, value.replaceAll('&quot;', '"').replaceAll('&amp;', '&')],
);

async function signIn(email) {
  const body = new FormData();
  for (const [name, value] of hidden) body.append(name, value);
  body.append('identifier', email);
  body.append('password', password);
  const started = performance.now();
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { origin: BASE, 'user-agent': 'nib-login-storm' },
  });
  const text = await res.text();
  const ms = performance.now() - started;
  const cookie = res.headers.get('set-cookie') ?? '';
  const outcome = cookie.includes('nib_session=')
    ? 'signed in'
    : /too many|try again in/i.test(text)
      ? 'throttled'
      : `refused (${res.status})`;
  return { ms, outcome };
}

const started = performance.now();
const results = await Promise.all(people.map((p) => signIn(p.email)));
const wall = performance.now() - started;

const byOutcome = {};
for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => Math.round(times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))]);
console.log(
  JSON.stringify({
    attempts: results.length,
    ...byOutcome,
    wallSeconds: Number((wall / 1000).toFixed(1)),
    p50: pct(50),
    p95: pct(95),
    max: pct(100),
  }),
);
