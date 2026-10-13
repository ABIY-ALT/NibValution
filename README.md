# NIB International Bank — Property Valuation Management System

Digitises the end-to-end property valuation process for Civil and Mechanical collateral: request intake, assignment, valuation, checking, threshold-based approval, digital signature, report and final-letter generation, delivery and archival — with a complete audit trail and SLA tracking throughout.

**Status:** all eight phases built; ready for user acceptance testing. Go-live waits on UAT sign-off and the bank-owned items (mail server, malware scanner, confirmed valuation parameters, holidays) listed in [docs/12-release-readiness.md](docs/12-release-readiness.md). See [docs/07-implementation-roadmap.md](docs/07-implementation-roadmap.md).

Sections that are not built yet are deliberately absent from the navigation rather than present and broken; they appear as inert text under "Coming in a later phase".

---

## Documentation

Read these before changing anything structural — they are the design of record.

| Document | Contents |
|---|---|
| [docs/00-assumptions-and-open-questions.md](docs/00-assumptions-and-open-questions.md) | Every assumption applied, and the questions still open with the Property Valuation Department |
| [docs/01-architecture.md](docs/01-architecture.md) | Layering, domain services, security model, data integrity |
| [docs/02-data-model-erd.md](docs/02-data-model-erd.md) | Entity model and the integrity rules enforced in PostgreSQL |
| [docs/03-workflow-state-machine.md](docs/03-workflow-state-machine.md) | Statuses, transitions, guards, return/correction cycle |
| [docs/04-rbac-matrix.md](docs/04-rbac-matrix.md) | Role/permission/scope matrix |
| [docs/05-api-specification.md](docs/05-api-specification.md) | Endpoints, conventions, error semantics |
| [docs/06-folder-structure.md](docs/06-folder-structure.md) | Layout and the boundaries lint enforces |
| [docs/07-implementation-roadmap.md](docs/07-implementation-roadmap.md) | Phases and exit criteria |
| [docs/08-testing-guide.md](docs/08-testing-guide.md) | **How to check the functionality** — automated checks and a role-by-role walkthrough |
| [docs/09-performance-and-load.md](docs/09-performance-and-load.md) | Load and query-tuning evidence: 40 users, 50,000 cases, and how to re-run it |
| [docs/10-operations-runbook.md](docs/10-operations-runbook.md) | Installing, running, upgrading, backing up and restoring; troubleshooting |
| [docs/11-uat-script.md](docs/11-uat-script.md) | The UAT script: every workflow path and role, with sign-off |
| [docs/12-release-readiness.md](docs/12-release-readiness.md) | Each requirement with its evidence, and what remains before go-live |

> **Open items requiring PVD confirmation.** Several seeded valuation parameters are provisional — most importantly the meaning of **MCF**, the treatment of **lease-held land**, and the **reconciliation weights**. Figures produced before those are confirmed should not be treated as final. The full list is in document 00.

---

## Getting started

**Prerequisites:** Node 20.11+ (developed on 24), PostgreSQL 16+ (developed on 18). `docker compose up -d` provides PostgreSQL, MailHog, ClamAV and MinIO if you would rather not install them.

```bash
npm install
cp .env.example .env          # then edit it (see below)
createdb nib_valuation        # or: docker compose up -d postgres
npm run db:migrate            # apply schema, constraints and triggers
npm run db:seed               # reference data + development accounts
npm run dev
```

`.env` needs three values before anything will start:

- `DATABASE_URL` — your PostgreSQL connection string.
- `SESSION_SECRET` — 32+ random characters: `openssl rand -base64 48`.
- `SEED_DEFAULT_PASSWORD` — 12+ characters, applied to every development account. There is deliberately no built-in default.

Development accounts are printed by the seed. All are created with must-change-password set, and the seed **refuses to run when `NODE_ENV=production`**.

### `APP_ENV` vs `NODE_ENV`

`next build` always sets `NODE_ENV=production`, including on a developer's laptop, so the strict production checks (HTTPS, configured malware scanner, real mailer, signing key) key off **`APP_ENV`** instead. It defaults to `NODE_ENV` when unset — so a real deployment that forgets it still gets the strict checks, and relaxing them is an explicit, visible opt-out.

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run verify` | Typecheck, lint and test — run this before committing |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the layer-boundary rules |
| `npm test` | Full suite |
| `npm run test:unit` / `test:integration` / `test:security` | One suite |
| `npm run test:coverage` | Coverage (domain and lib) |
| `npm run db:migrate` / `db:deploy` | Migrate (dev) / apply (production) |
| `npm run db:seed` | Seed reference data and development accounts |
| `npm run db:studio` | Prisma Studio |

Integration tests run against the database named in `DATABASE_URL` and skip themselves when it is unset.

---

## Principles this codebase holds to

These are not style preferences; each one is load-bearing.

1. **Money is decimal, and computed on the server.** Every ETB amount is `NUMERIC(20,2)` in PostgreSQL and `Decimal` in TypeScript. No valuation figure is ever computed in the browser, and every calculation persists its inputs, parameter snapshot and formula version so it can be reproduced during an audit.
2. **Authorisation is server-side and case-scoped.** Holding a permission is not enough — the caller must also stand in the right relationship to the specific case. Hiding a button is a usability decision, never a security control.
3. **One workflow service owns every transition.** Status is never set from a component, a route handler or a query.
4. **The database is the last line of defence.** Segregation of duties, reconciliation weights, append-only audit and the immutability of approved reports are enforced by constraints and triggers, so an application bug cannot corrupt the record.
5. **Business rules are configuration.** Thresholds, SLA, parameters, categories, request types and permissions live in tables an administrator can edit — never in React components.
6. **Assumptions are written down, not invented silently.** Where the source specification was ambiguous, document 00 records the decision and flags what still needs confirming.

---

## Architecture in one paragraph

A layered Next.js monolith. `src/app` and `src/components` render; `src/server/actions` and `src/app/api` authenticate, validate and open transactions; `src/server/domain` holds the workflow, valuation, approval, SLA and RBAC logic and imports **no framework, Prisma or I/O** — which is what makes the valuation engine exhaustively unit-testable; `src/server/infrastructure` provides the database, storage, mail, scanning, PDF and signature adapters behind interfaces. ESLint enforces those boundaries as errors.
