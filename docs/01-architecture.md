# System Architecture

## 1. Guiding constraints

Four requirements shape every structural decision:

1. **Calculation integrity (§28).** Money is never computed in the browser and never stored as a float. All arithmetic runs server-side in arbitrary-precision decimal and every result is persisted with the inputs, parameter set and formula version that produced it, so any historical valuation can be recomputed and reproduced during an audit.
2. **Server-enforced authorisation (§26, Rule 4).** The UI hides what a user may not do, but nothing depends on that. Every server action and route handler independently resolves the caller's permissions and the case's state before acting.
3. **Centralised workflow (§36).** One `WorkflowService` owns every transition. No React component, route handler or Prisma call moves a case between states on its own.
4. **Auditability (§25, §29).** Workflow transitions, calculations, document access and configuration changes write append-only audit records inside the same database transaction as the change they describe — so an audit gap cannot arise from a partial failure.

## 2. Deployment topology

```
                    ┌────────────────────────────────────────┐
   Desktop browser  │  Reverse proxy (TLS, HSTS, rate limit) │
   (40 concurrent)  └──────────────────┬─────────────────────┘
                                       │
                    ┌──────────────────▼─────────────────────┐
                    │  Next.js application (Node 24)         │
                    │  ├─ React Server Components (UI)       │
                    │  ├─ Server Actions  (mutations)        │
                    │  ├─ Route Handlers  (REST, files, PDF) │
                    │  └─ Domain services (workflow, calc,   │
                    │       approval, SLA, signature, audit) │
                    └──────┬──────────────┬──────────────┬───┘
                           │              │              │
              ┌────────────▼───┐  ┌───────▼──────┐  ┌────▼───────────┐
              │  PostgreSQL 18 │  │ Object /file │  │ Job runner     │
              │  (Prisma)      │  │ storage      │  │ (PDF, email,   │
              │                │  │ (S3 / local) │  │  SLA sweep,    │
              └────────────────┘  └──────────────┘  │  AV scan)      │
                                                    └────┬───────────┘
                                                         │
                          ┌──────────────────────────────┼──────────────┐
                          │                              │              │
                   ┌──────▼──────┐              ┌────────▼─────┐  ┌─────▼──────┐
                   │ SMTP / SMS  │              │ AV (ICAP /   │  │ Signature  │
                   │ gateway     │              │  ClamAV)     │  │ provider   │
                   └─────────────┘              └──────────────┘  └────────────┘
```

Every box outside the application is reached through an interface with at least two implementations (a development one and a production one), so no environment-specific concern leaks into domain code.

## 3. Layering

The codebase is a layered monolith. Dependencies point strictly downward; a lower layer never imports an upper one.

| Layer | Location | Responsibility | May import |
|-------|----------|----------------|------------|
| **Presentation** | `src/app/**`, `src/components/**` | Rendering, forms, client-side *convenience* validation. Holds no business rule. | Application |
| **Application** | `src/server/actions/**`, `src/app/api/**` | Authenticates the caller, parses and validates input with Zod, opens the transaction, calls domain services, maps results to responses. | Domain, Infrastructure |
| **Domain** | `src/server/domain/**` | Workflow, valuation calculation, approval routing, SLA, versioning, signature orchestration. Pure logic over repository interfaces — **no framework imports, no `next/*`, no HTTP**. | Domain only |
| **Infrastructure** | `src/server/infrastructure/**` | Prisma repositories, storage drivers, mailer, SMS, AV scanner, PDF renderer, signature providers, clock. | Domain interfaces |

The domain layer's independence from Next.js is what makes the valuation engine unit-testable without a database or a request context — which matters, because those are the tests an auditor will want to see.

## 4. Core domain services

### `WorkflowService`
The single authority on case movement (§36). Public surface:

`submitRequest · assignMaker · startValuation · submitForChecking · assignChecker · completeChecking · returnForCorrection · resubmit · approve · sign · generateFinalLetter · deliver · archive · cancel`

Each operation performs the same disciplined sequence inside **one database transaction**:

1. Load the case **`FOR UPDATE`** (pessimistic lock) and compare the caller-supplied `version` against the stored one — optimistic concurrency, so two managers assigning the same case simultaneously cannot both succeed (Rules 11–14).
2. Validate the transition against the state machine table: is this transition legal *from this status*, *for this role*, *for this user's relationship to the case*?
3. Enforce guards — mandatory comment on return, segregation of duties, approval level reached, no unresolved correction cycle, required documents present.
4. Apply the change, bump `version`, and write `WorkflowHistory` + `AuditLog` + `SlaRecord` updates.
5. Enqueue notifications **after commit**, never inside the transaction, so a mail failure cannot roll back a legitimate approval.

Because transition legality is table-driven rather than expressed as scattered `if` statements, adding a stage later is a data change plus a guard, not a hunt through the UI.

### `ValuationEngine`
Deterministic, pure, and versioned. `evaluate(input, parameterSet, formulaVersion) → CalculationResult`. It never reads the clock, never queries the database, and never mutates its arguments — the repository loads the parameter snapshot and hands it in. Every result persists its full input vector, the parameter snapshot, the formula version and a hash of the two, which is what makes §28's "reproduce a historical valuation" requirement achievable rather than aspirational.

Sub-engines: `CostApproach`, `SalesApproach`, `Reconciliation`, `Depreciation`, `ForcedSale`, `MechanicalMarketApproach`, `MechanicalCostApproach`.

### `ApprovalRoutingService`
Given a case's final value and configuration, returns the ordered approval chain and the final-letter authority (§17, §18). Reads `ApprovalThreshold` rows — never constants.

### `SlaService`
Working-day arithmetic against a configurable calendar; computes elapsed, remaining and status (green / warning / breached), and maintains `SlaRecord` including paused intervals.

### `SignatureService`
Orchestrates re-authentication, document hashing, provider invocation, and the immutable signed-version record. Delegates cryptography to a `SignatureProvider` (§19) — the system never invents its own signature scheme.

### `AuditService`
Append-only writer. Callable only from within an active transaction, so an audit record and the change it describes commit or fail together.

## 5. Authentication & authorisation

- **Sessions**: server-side session records keyed by an opaque, rotating token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Sessions are revocable centrally (an administrator disabling a user kills their live sessions immediately) — the reason for stateful sessions over stateless JWTs in a banking context.
- **Passwords**: Argon2id, per-user salt, parameters recorded alongside the hash so they can be raised later without invalidating existing credentials.
- **Authorisation** is a two-key check on *every* protected operation:
  1. **Permission** — does the caller's role grant `case:assign`, `valuation:submit`, `document:download`, …?
  2. **Scope** — is the caller *related to this specific case* in the required way (assigned maker, assigned checker, manager of the owning unit, director of the department, originating process owner)?

The second check is what closes IDOR (§26). It is implemented as `assertCaseAccess(user, case, action)` in the domain layer and is impossible to bypass from a route handler, because handlers receive cases only through repository functions that require an access assertion.

## 6. Data integrity

- **Money**: `NUMERIC(20,2)` in PostgreSQL, `Prisma.Decimal` in TypeScript, never `number`. A lint rule bans arithmetic operators on Decimal-typed fields.
- **Constraints in the database, not only in code** (Rule 16): unique case numbers, `checker_id <> maker_id`, weight sums, non-negative amounts, foreign keys with deliberate `ON DELETE` behaviour, and partial unique indexes (e.g. one active valuation version per case).
- **Immutability**: approved reports and signed documents are protected by a database trigger that rejects `UPDATE`/`DELETE` on rows in a terminal state — enforcement that survives a bug in application code (§29, Rule 9).
- **Case numbers**: allocated from a dedicated sequence table inside the creating transaction, so concurrent submissions cannot collide or leave gaps that look like deleted records.

## 7. File handling

Uploads are streamed to a quarantine area, validated (extension allow-list, MIME sniffing of actual content rather than the declared header, size, magic-byte check), scanned, and only then promoted to permanent storage under a random opaque key. Users address documents solely by database ID; **the physical path is never returned to the client** (§8, Rule 6). Downloads go through an authorising route handler that checks permission and case scope, then streams the object and writes an audit record.

## 8. Reports & versioning

PDF rendering runs in the job runner from a versioned template plus a frozen data snapshot — so re-rendering an old report reproduces the original document rather than today's data. Each generation creates a new `Report` row with an incrementing version; an approved version is immutable, and a post-approval correction produces a **new controlled version** (§29).

## 9. Observability

Structured JSON logs carrying a correlation ID propagated from the request through every service call into `AuditLog.correlation_id`, so an auditor can reconstruct a complete action chain. Health endpoints for database, storage, scanner and mail; metrics on transition counts, calculation latency, PDF queue depth and SLA breaches.

## 10. Why a modular monolith rather than services

At 40 concurrent users with strict transactional and audit requirements, a single deployable that can wrap a workflow transition, its audit record and its SLA update in one ACID transaction is a genuine correctness advantage, not merely simpler operations. The layer boundaries above are enforced by lint rules and by the domain layer's lack of framework imports, so extracting a service later remains open — but distribution is not paid for before it is needed.
