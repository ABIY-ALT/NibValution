# Implementation Roadmap

The build follows §40's eight phases. Each phase ends with a green build, applied migrations and passing tests — a phase is not "done" while any of those is broken (§43.9).

## Phase 1 — Foundation *(complete)*

- [x] Requirements analysis, assumptions register, architecture, ERD, workflow, RBAC, API spec, folder structure
- [x] Next.js 16 + TypeScript (strict, `noUncheckedIndexedAccess`) + Tailwind 4 scaffold; ESLint layer-boundary rules as errors
- [x] Prisma schema (37 models) and initial migration, including 30+ check constraints, partial unique indexes, trigram search indexes and 10 append-only / immutability triggers
- [x] Seed: 53 permissions, 7 roles, 115 grants, 5 request types, 32 property categories, 14 document categories, 3 approval bands, 2 final-letter bands, 12 valuation parameters, SLA policy, 13 notification rules, 15 configuration keys, and development accounts
- [x] Decimal money module — no ETB figure ever touches an IEEE float
- [x] Workflow state machine as a declarative, testable transition table
- [x] Approval routing and final-letter authority resolved from temporal configuration
- [x] Depreciation engine (straight-line, age-life with condition, declining balance)
- [x] Authentication: Argon2id, server-side revocable sessions, account lockout, rate limiting, password history and expiry, re-authentication for signing
- [x] RBAC: permission resolution and `authorize()` with scope predicates
- [x] Audit logging written inside the caller's transaction, append-only in the database
- [x] Application shell: NIB-branded layout, permission-derived navigation, role-specific dashboard reading live data
- [x] Administration pages: users (activate, unlock, roles, discipline), roles and the permission matrix, approval thresholds with live validation and editable chains, valuation parameters with provisional values flagged, categories and types, and a filterable paginated audit log
- [x] 142 tests passing — unit, integration (against a real database) and security

**Exit criteria — met.** Verified end to end against the built application: each seeded role signs in and reaches a role-appropriate shell; an unauthenticated request to any protected route is redirected; a must-change-password account is held at the change-password page; a Maker sees the Maker dashboard and a Director the Director dashboard with only the navigation their permissions allow; all six administration pages render live data for an administrator, are refused with a plain explanation for a Maker, and grant a Director the audit log but nothing else; login successes and failures are written to the audit log; the audit log rejects UPDATE and DELETE at the database level.

**Navigation policy.** Menu items carry a `built` flag and unbuilt destinations are rendered as inert text under "Coming in a later phase" rather than as links. A menu entry that 404s reads as a broken system rather than an unfinished one, and a security test asserts that no role is ever offered a link to a route that does not exist.

## Phase 2 — Intake *(complete)*

**Delivered**

- [x] `WorkflowService` — the centralised transition engine (§36). Pure and framework-free: it decides, and the application layer persists the decision with the history, tasks, correction cycle, SLA and audit record in one transaction
- [x] Case numbering from an in-transaction sequence (`PV-YYYY-NNNNNN`), so concurrent submissions cannot collide or leave gaps
- [x] Request creation, with prior-case linkage enforced for re-estimation, appeal and progress
- [x] Optimistic locking on every transition, and a pessimistic `FOR UPDATE` lock so simultaneous callers serialise
- [x] Request list with scope-filtered search, status and discipline filters, and pagination
- [x] Case detail with the timeline (§32), correction history (§33) and role-appropriate actions
- [x] My Tasks — personal assignments plus the role queues a user may pick up from
- [x] Live navigation badges driven by real counters

- [x] Document management: `StorageProvider` and `MalwareScanner` abstractions; upload with extension, size and **magic-byte** validation; quarantine-then-scan-then-promote; SHA-256 hashing; opaque random storage keys; versioning; soft delete with a mandatory reason; authorised, audited download
- [x] Work-queue and archive views: Pending Approvals, Returned Cases, Overdue Cases and the Closed Archive, all sharing one scope-filtered case table

**Completed in Phase 3**

- [x] Civil property and building registration (≤40 buildings) — in the valuation workspace
- [x] Mechanical vehicle and machinery registration (≤300 items) — in the valuation workspace

**Exit criteria:** a Process Owner submits a complete request *with documents*; nothing exposes a storage path; limits and file rules are enforced server-side.

**Document security, verified against the running application.** A genuine PDF uploads and downloads byte-identical. A Windows executable renamed to `.pdf` and declared as `application/pdf` is refused — the decisive check is the file's own leading bytes, not what it claims. A mechanical-only category is refused on a civil case. A document is addressed only by database id: the storage key appears nowhere in any response, and a cross-branch user receives 404 rather than 403 for both the case and the document.

**Fail-closed scanning.** With no scanner configured, development passes files and production quarantines them. An unscanned file never becomes downloadable.

## Phase 3 — Valuation *(built; parameters await PVD confirmation)*

Maker workflow (`ASSIGNED → ON_PROGRESS → SUBMITTED_FOR_CHECKING`, plus not-visited and pending with mandatory remarks); the decimal valuation engine — cost approach, depreciation, sales approach with comparables, reconciliation, forced sale, mechanical market and cost approaches; `CalculationRun` persistence; the transparent breakdown view; site visits and photographs.

**Delivered**

- [x] Civil engine (`src/server/domain/valuation/civil-engine.ts`): land on the configured lease basis, buildings at replacement cost less depreciation or x completion, external works, MCF, sales approach from adjusted comparables, reconciliation, forced sale
- [x] Mechanical engine (`mechanical-engine.ts`): per item, cost approach from CIF + loadings or a quote less depreciation and a condition adjustment, and/or market approach from adjusted comparables, reconciled per item and summed
- [x] Every rate, weight, table and percentage read from the parameter set in force on the valuation date; overrides of weights and forced-sale percentage require a written justification
- [x] Persistence in one transaction: the current `Valuation`, the approach rows, an append-only `CalculationRun` (input, parameter snapshot, output, SHA-256 input hash), the case's final value and an audit record
- [x] The submit-for-checking guard re-runs the stored calculation and refuses a figure that does not reproduce; any property change clears the figures until recalculated
- [x] Valuation workspace (`/requests/[id]/valuation`): property registration, the worksheet, the full breakdown and the site-visit log; a valuation card on the case page
- [x] Unit tests with hand-worked figures; an integration test of calculate → verify → tamper → invalidate → submit against the database

**Open**

- [ ] PVD to confirm the parameters the figures depend on: MCF (3.1), weights (3.2), depreciation method and life tables (3.3), forced-sale percentage (3.4), lease-land basis (3.5), CIF loadings (3.7)
- [ ] Element-weighted completion for buildings under construction (the building's recorded completion percentage is used today)

**Exit criteria:** valuation figures are computed server-side only, reproducible from a stored `CalculationRun`, and the full breakdown is visible.

## Phase 4 — Checking *(complete)*

Checker Manager assignment with the maker ≠ checker rule; checker review, comments and validation; return-for-correction with mandatory comment and `CorrectionCycle` records; maker correction and resubmission; correction history display.

- [x] Review comments (`review-service.ts`): raised by the assigned checker and tagged with the section they concern; the first moves the case CHECKING → COMMENTED through the workflow engine; maker and checker reply in threads; only the checker resolves or reopens
- [x] Complete-checking refuses while any top-level comment is open; a return records the flagged sections on its correction cycle
- [x] Resubmission requires a note of what was corrected; the cycle closes with that note and its rework time, and the review task returns to the same checker
- [x] A return, rejection or cancellation closes every task open on the case (previously the checker's task stayed open and the resubmission collided with it)
- [x] The valuation's status follows the case (submitted, under check, checked, draft on return) and records who checked it
- [x] The checker sees whether the stored calculation verifies; the case page shows open comments, flagged sections and rework time
- [x] Integration test of the full round trip: assign → comment → refuse completion → return → reply and recalculate → resubmit → resolve → complete

**Exit criteria — met.** The return → correct → resubmit cycle round-trips with complete history (timeline, correction cycle with flagged sections, resolution note and rework seconds), verified against the database.

## Phase 5 — Approval & signature *(complete)*

`ApprovalThreshold`-driven routing; manager and director approval and rejection; segregation-of-duties enforcement; the `SignatureProvider` interface with the default provider; re-authentication before signing; immutability of signed documents; signature audit trail.

- [x] Approval routing fixed end to end: the checker's place in each band's chain is the completion of checking itself, so a case now routes CHECKED → the configured gates → APPROVED (previously every case failed entering approval, and no approver could act)
- [x] Submitting for approval uses the Maker's `valuation:submit` right; it required `coverpage:generate`, which no Maker holds
- [x] Every decision is an append-only `Approval` record - checker, manager and director approvals, rejections and returns - carrying the value it was taken on; only the current round's approvals count after a correction
- [x] Approval freezes the valuation (the database then refuses any change) and records the approval level on the case
- [x] `SignatureProvider` port with a local ECDSA P-256 provider; production requires the configured key, development keeps a generated key in `keys/` (git-ignored); the external PKI adapter fails closed until connected
- [x] Signing requires the password in the same step; it stores the signed document as an immutable VALUATION report and signs the SHA-256 of its canonical form; every view re-hashes the report and re-checks the signature
- [x] Case page: approval decisions and signature status
- [x] Tests: approval gates per band (unit); route → approve → freeze → refuse unauthenticated signing → sign → verify → refuse alteration (integration)

**Exit criteria — met.** Routing is read purely from the threshold configuration, approved valuations are frozen, and a signed document cannot be altered; tampering would show as "document altered" on verification.

**Open:** NIB to name the signature infrastructure (assumption 5.2) - the adapter slot is ready.

## Phase 6 — Reports *(complete, with PDF files via the browser)*

Versioned PDF valuation report with NIB branding, the automated cover page (§15), the final letter with authority resolved by threshold (§18), print-friendly output, report versioning with immutable approved versions, delivery to the requester, and archival.

- [x] Every case document is a frozen, immutable, versioned `Report` snapshot with its SHA-256 (`case-document-service.ts`): the cover page on submission for approval, the valuation report on signing, the final letter on issue
- [x] Final letter issued only by the authority the value resolves to (`FinalLetterAuthority`, rules in force on the request date), once per valuation
- [x] Delivery refused until the final letter exists; the requester sees the valuation report and the final letter only after delivery, never the cover page
- [x] NIB-branded A4 document viewer (`/requests/[id]/reports/[reportId]`) rendered only from the snapshot, with an integrity check on every open; print styles output the document alone, so "Save as PDF" produces the file
- [x] Case page lists every document and version
- [x] Integration tests: cover page frozen, delivery gated, letter authority and single issue, requester visibility, and re-rendering from the snapshot after the case data changes

**Exit criteria — met.** Re-opening an issued document shows the snapshot it was issued with; the integration test changes the owner's name after issue and the letter still shows the original.

**Open:** server-side PDF files (stored with their own hash) need a PDF library such as `pdfkit`; today the PDF comes from the print-ready page. The final-letter wording is a neutral draft for PVD to replace with the bank's template. Archiving uses the existing retention rule (30 days after completion).

## Phase 7 — Dashboards, SLA, notifications *(complete; email and SMS await the bank's servers)*

Role-specific dashboards (§21); working-day SLA engine with pauses, amber/breach states and history; in-app, email and SMS-interface notifications for all §23 events; operational, performance, SLA and valuation reports with PDF and Excel export; advanced search and archive.

- [x] SLA engine (`sla-engine.ts`), pure and clock-free: working days against the configured week and holiday calendar (one-off and every-year holidays), or calendar days if the policy says so; pauses push the due date out and are reported separately (gross and net days), so a pause cannot flatter the KPI
- [x] The clock opens on submission, pauses while the request is back with the requester, resumes when it moves on, and closes on completion or cancellation; states GREEN → WARNING → BREACHED, PAUSED and CLOSED, with the breach time kept even after closing
- [x] Sweep (`sla-service.ts`): after every transition for that case, in the background on page loads (at most every 5 minutes), and from a scheduler via `/api/cron/sla` (Bearer `CRON_SECRET`; the endpoint does not exist without one). "Approaching" and "breached" are announced once each, on the crossing
- [x] SLA & Calendar administration (`/admin/sla`, `sla:config`): allowance, warning point, working week, counting basis and public holidays; every change audited and applied to open cases at once
- [x] SLA register (`/reports/sla`): scoped to what the viewer may see, filterable by state, paginated; compliance measured on completed cases (closed without a breach)
- [x] Dashboard, navigation badges, overdue list and notification centre read the stored SLA state, so every screen counts the same late cases as the register
- [x] Notifications (`notification-dispatch.ts`): the `NotificationRule` table decides which roles hear of which event on which channels; every §23 event is wired to its transition; nobody is told of their own action; dispatch runs after commit and never fails the transition. In-app rows appear in the notification centre; email and SMS go through a `MessageSender` port
- [x] Advanced search: case number, owner, applicant, LHC number, plate, chassis and serial number
- [x] Tests: SLA engine (unit, incl. recurring holidays); submit → notify department → pause → no breach while paused → resume and move the due date → amber once → breach once → register → cancel closes the clock (integration)

**Exit criteria — met.** The dashboard, badges and register all read the one stored SLA state, whose figures come from the configured calendar; the integration test checks the due date against the policy and holidays in the database.

**Open**

- [ ] Email and SMS: the `log` driver records each message in the server log and marks it sent. Connecting the bank's mail server (SMTP host, port, sender, credentials) and SMS gateway only needs their `MessageSender` adapters and the settings
- [ ] A scheduler must call `/api/cron/sla` every 15 minutes in production (cron, Windows Task Scheduler or the platform's jobs) with `CRON_SECRET` set
- [ ] Exports: operational reports download as CSV (with a UTF-8 marker so Excel opens Amharic names correctly); a native `.xlsx` file and server-side PDF need a library (e.g. `exceljs`, `pdfkit`)
- [ ] Per-stage budgets are displayed but not yet tracked per stage; the SLA is measured end to end
- [ ] Prisma's pg adapter still issues one overlapping query inside a transaction (a `pg` deprecation warning, harmless until pg 9); the application's own parallel queries inside transactions have been made sequential

## Phase 8 — Hardening & delivery *(complete; UAT execution with the bank)*

Security review against the §26 list (authorisation, IDOR, upload, session, CSRF, SSRF, mass assignment); load testing at 40 concurrent users; query and index tuning; backup and restore rehearsal; deployment configuration and runbook; UAT execution per role and workflow path; defect fixing.

**Security review: defects found and fixed**

- [x] **Production pages did not work:** the static CSP (`script-src 'self'`) blocked Next.js's inline bootstrap scripts, so no page became interactive in a production build. Now a per-request nonce with `'strict-dynamic'`, set in `src/proxy.ts`; verified in a browser against the production build
- [x] **Cross-branch data leak:** the civil and mechanical registers listed every branch's collateral to anyone with `valuation:read`, which every Process Owner holds. Now scoped like the case list (`property-register-service.ts`), searched in the database, paginated
- [x] **Forgeable client address:** the first `X-Forwarded-For` entry, written by the client, was trusted for the audit log and the sign-in limiter. Now read from the entry our proxy appended (`TRUSTED_PROXY_HOPS`)
- [x] Upload and delete route handlers refuse cross-site requests (origin check); server actions already had Next.js's
- [x] A caller-supplied correlation id is validated before it reaches logs and the audit trail
- [x] Malformed ids in URLs answer "not found" instead of a database error
- [x] Expired sessions are purged nightly (`/api/cron/maintenance`); the purge existed but nothing called it
- [x] Password hashing falls back to a WebAssembly Argon2id where an application-control policy blocks the native module; same hashes, verified against existing accounts
- [x] Signing-key rotation: retired public keys keep old signatures verifiable (`SIGNATURE_RETIRED_PUBLIC_KEYS`)
- [x] `npm audit`: fixable advisories fixed; 4 remain inside the Prisma CLI toolchain, not loaded at run time (accepted)
- [x] Reviewed with no defect: server-side authorisation on every action and route, session handling, SSRF (no user-directed outbound requests), mass assignment (schema-parsed, field-by-field)

**Performance** (`docs/09-performance-and-load.md`)

- [x] Production-scale data set (50,000 cases, 1.5 M rows) and repeatable scripts in `scripts/perf/`
- [x] 40 concurrent users: 0 errors; median 421 → **132 ms**, 95th percentile 1,146 → **455 ms** after tuning
- [x] Audit Log page 15–19 s → 132 ms (index skip-scan instead of Prisma's in-memory `distinct`; index on `occurredAt`)
- [x] Four indexes for newest-first lists (migration `20260930060000_phase8_list_indexes`)
- [x] Sign-in rush: 20 of 40 simultaneous sign-ins from one office address were refused; the per-address limit is now a setting (`security.login_attempts_per_ip`, default 100) and all 40 succeed in 0.5 s
- [x] Session idle window slid at most once a minute instead of a write per request
- [x] Overlapping SLA sweeps could send a breach email twice; each change is now claimed by exactly one sweep (tested with three concurrent sweeps)

**Operations**

- [x] Backup and restore rehearsed: 1.5 M rows dumped in 9 s and restored in 11 s, fingerprint identical, protections probed (`scripts/ops/verify-restore.sql`)
- [x] Runbook (`docs/10-operations-runbook.md`): configuration, reverse proxy, services, scheduled jobs, upgrades, backups, monitoring, troubleshooting
- [x] `/api/health` for load balancers and monitoring
- [x] UAT script (`docs/11-uat-script.md`): 66 tests across every workflow path and role, with sign-off
- [x] Release-readiness checklist with evidence per line (`docs/12-release-readiness.md`)

**Exit criteria: met for everything the development team owns.** 352 tests pass, type check and lint are clean, and the production build is verified. Remaining: UAT execution by the bank's testers, and the bank-owned go-live items in `docs/12-release-readiness.md`.

---

## Sequencing rationale

Intake precedes valuation because every later module depends on a real case aggregate; approval precedes reporting because a report must render an actually-approved case rather than a placeholder; dashboards come late because they aggregate data the earlier phases produce, and building them earlier would mean building them twice.

## Verification discipline

Tests are written with each phase, not after: unit tests for calculations, thresholds, SLA and permissions; integration tests exercising complete workflow paths against a real PostgreSQL instance; security tests asserting that each role is refused what it must not do. Migrations are forward-only and reviewed; no phase proceeds on a failing migration or a red build (§43.9–10).
