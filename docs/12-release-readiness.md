# Release Readiness

The Phase 8 exit criterion is the §42 Definition of Done, "met in full, with test evidence for each line". The specification's own §42 wording is not in this repository, so this checklist is built from the requirements the project documents cite (§26 security, the workflow, approval, valuation, SLA and reporting rules, and the non-functional targets). Each line names its evidence. Status as of 30 September 2026.

**Overall: ready for UAT, not yet for go-live.** Every line the development team can close is closed. What remains is UAT execution by the bank's testers and the bank-owned items in the last section.

## Quality gates

| Requirement | Evidence | Status |
|---|---|---|
| Type check clean | `npm run typecheck`: 0 errors | Met |
| Lint clean | `npm run lint`: 0 problems | Met |
| All automated tests pass | `npm test`: **352 passed, 0 failed**, in 22 files | Met |
| Production build succeeds | `npm run build`: every route built | Met |
| Migrations apply forward-only to an empty database | `nib_valuation_perf` built from nothing with `prisma migrate deploy`; schema matches `schema.prisma` apart from the documented trigram indexes | Met |

## Security (§26)

| Requirement | Evidence | Status |
|---|---|---|
| Authorisation enforced on the server, per permission and per case | `tests/security/authorization.test.ts` (24), `admin-authority.test.ts` (15), `navigation.test.ts` (9); every server action and route handler resolves the caller | Met |
| IDOR: another unit's case answers "not found" | `authorization.test.ts`; `tests/integration/registers.test.ts` (6): registers scoped, cross-branch search finds nothing. **Fixed in Phase 8:** the civil and mechanical registers listed every branch's collateral | Met |
| Malformed ids answer "not found", not a server error | `request-hardening.test.ts`; `registers.test.ts` | Met |
| Upload validation: content not name, archives refused, scanning fail-closed | `tests/security/file-upload.test.ts` (45) | Met |
| Sessions: server-side, hashed, idle and absolute expiry, revoked on deactivation and password change | `tests/integration/auth.test.ts` (22); expired sessions purged nightly (`/api/cron/maintenance`) | Met |
| CSRF | Server actions: Next.js origin check. Upload and delete routes: origin check added in Phase 8, `request-hardening.test.ts` | Met |
| SSRF | No server-side request goes to an address a user supplies (code review of every outbound call) | Met |
| Mass assignment | Every input parsed by a schema and copied field by field; the signing re-authentication flag is computed on the server (code review) | Met |
| Content-Security-Policy that blocks injected script | Per-request nonce with `strict-dynamic`, `request-hardening.test.ts`; production build checked in a browser with no violations. **Fixed in Phase 8:** the previous static policy stopped every page working in production | Met |
| Client address cannot be forged | `request-hardening.test.ts`. **Fixed in Phase 8:** the first `X-Forwarded-For` entry, which the client writes, was trusted | Met |
| Passwords: Argon2id, lockout, rate limits, no account enumeration | `tests/unit/password.test.ts` (5), `password-policy.test.ts` (9), `auth.test.ts` | Met |
| Audit trail complete and unalterable | `tests/integration/database-integrity.test.ts` (14); the restore rehearsal probes that the audit log refuses changes | Met |
| Dependencies free of known exploitable vulnerabilities | `npm audit --omit=dev`: 4 advisories remain, all inside the Prisma command-line toolchain (bundled MySQL client, config merging), none loaded by the running application; the only fix npm offers downgrades Prisma a major version | Accepted risk |

## Business rules

| Requirement | Evidence | Status |
|---|---|---|
| Workflow follows the state machine, nothing else | `tests/unit/workflow-transitions.test.ts` (24); `tests/integration/workflow.test.ts` (18) | Met |
| Approval routed by threshold configuration | `approval-routing.test.ts` (26), `approval-gates.test.ts` (4), `valuation.test.ts` | Met |
| Segregation of duties (valuer ≠ checker ≠ approver) | `authorization.test.ts`, `workflow.test.ts`, database check constraint | Met |
| Valuation computed on the server in exact decimals, reproducible, tamper-evident | `valuation-engines.test.ts` (14), `depreciation.test.ts` (16), `money.test.ts` (17), `valuation.test.ts` (31: calculate, verify, tamper, invalidate) | Met; parameters await PVD |
| Checking cycle with mandatory comments and correction history | `valuation.test.ts` | Met |
| Approved valuations frozen; signed documents immutable and verifiable | `valuation.test.ts`; `signature-rotation.test.ts` (3): old signatures still verify after a key rotation (added in Phase 8) | Met |
| Reports rendered from frozen snapshots; delivery gated on the final letter | `valuation.test.ts` | Met |
| SLA in working days with pauses; amber and breach announced once | `sla-engine.test.ts` (10), `notifications-sla.test.ts` (9), including three simultaneous sweeps. **Fixed in Phase 8:** overlapping sweeps could send the breach email twice | Met |
| Notifications to the roles each event names, never to the actor | `notifications-sla.test.ts` | Met (in-app); email awaits SMTP |

## Non-functional

| Requirement | Evidence | Status |
|---|---|---|
| 40 concurrent users | `docs/09-performance-and-load.md`: 0 errors, median 132 ms, 95th percentile 455 ms with 50,000 cases | Met |
| Sign-in rush | 40 simultaneous sign-ins from one address, all succeed in 0.5 s. **Fixed in Phase 8:** 20 of 40 were refused | Met |
| Query and index tuning | Migration `20260930060000_phase8_list_indexes`; audit log 15 s → 132 ms | Met |
| Backup and restore rehearsed | `docs/10-operations-runbook.md` §8: 1.5 M rows restored in 11 s, fingerprint identical; `scripts/ops/verify-restore.sql` | Met |
| Deployment configuration and runbook | `docs/10-operations-runbook.md` | Met |
| Health check for monitoring | `GET /api/health` | Met |
| UAT per role and workflow path | Script: `docs/11-uat-script.md` (66 tests across 10 areas) | Script ready; **execution by bank testers** |

## Owned by the bank before go-live

| Item | Why it blocks |
|---|---|
| UAT execution and sign-off (`docs/11-uat-script.md`) | Acceptance is the bank's decision |
| PVD confirmation of valuation parameters | Figures are provisional until then |
| Mail server details | Production refuses the log driver; email notifications would be recorded as failed |
| Malware scanner endpoint | Production refuses to start without one |
| Signature infrastructure decision | The local key works; the external adapter awaits the bank's choice |
| Public holidays entered | SLA due dates skip weekends only until then |
| Final-letter wording | A neutral draft is in place |
| TLS certificate, DNS name, servers, scheduler | See the runbook |
