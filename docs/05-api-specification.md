# API Specification

Two surfaces, chosen deliberately:

- **Server Actions** for form-driven mutations inside the app (progressive enhancement, no hand-written fetch layer).
- **Route Handlers under `/api`** for file transfer, PDF streaming, long-running jobs, and anything a future integration might call.

Both funnel into the *same* application-service functions, so authorisation and workflow rules cannot diverge between them. Every entry point begins with `requireActor()` then `authorize(actor, permission, scope)`.

## 1. Conventions

- **Auth**: `HttpOnly` session cookie. No bearer tokens in v1; an API-key surface for system integration is additive.
- **Idempotency**: mutating endpoints accept `Idempotency-Key`; a replay returns the original result rather than acting twice (Rule 12).
- **Concurrency**: mutations on a case require `If-Match: <version>` (or `version` in the body). A mismatch returns `409` with the current state (Rule 14).
- **Validation**: Zod schemas shared between client and server; the server never trusts the client's copy.
- **Errors**: RFC 7807 problem+json.
  `400` validation · `401` unauthenticated · `403` unauthorised (never leaks existence) · `404` not found or out of scope · `409` version/state conflict · `413` payload too large · `422` business-rule violation · `429` rate limited.
- **Not-found vs forbidden**: a case outside the caller's scope returns `404`, not `403` — enumerating case numbers must reveal nothing (§26, IDOR).
- **Pagination**: `?page&pageSize&sort&order`, envelope `{ data, page, pageSize, total }`.
- **Money**: serialised as decimal **strings**, never JSON numbers (§28).

## 2. Authentication

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/login` | Rate-limited per IP and per account; lockout after N failures; audited on success and failure |
| `POST` | `/api/auth/logout` | Revokes the session server-side |
| `POST` | `/api/auth/reauthenticate` | Required before signing (§19); issues a short-lived elevation |
| `POST` | `/api/auth/change-password` | Requires current password; enforces history and complexity |
| `POST` | `/api/auth/forgot-password` · `/api/auth/reset-password` | Single-use, expiring token; responses identical whether or not the account exists |
| `POST` | `/api/auth/mfa/enroll` · `/verify` | TOTP, off by default |
| `GET` | `/api/auth/session` | Current actor, roles, effective permissions |

## 3. Valuation cases

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/api/valuation-cases` | `case:create` | Creates `DRAFT`, allocates case number on submit |
| `GET` | `/api/valuation-cases` | `case:read` | Filters: status, type, discipline, org, maker, checker, date range, amount range, approval level. Always scope-filtered server-side |
| `GET` | `/api/valuation-cases/:id` | `case:read` + scope | |
| `PATCH` | `/api/valuation-cases/:id` | `case:update_request` | `DRAFT` only; field allow-list (mass-assignment guard, Rule 41.x) |
| `POST` | `/api/valuation-cases/:id/submit` | `case:create` | `DRAFT → REQUESTED` |
| `POST` | `/api/valuation-cases/:id/assign` | `case:assign_maker` | Body `{ makerId, dueAt?, note? }` |
| `POST` | `/api/valuation-cases/:id/assign-checker` | `case:assign_checker` | Rejects `checkerId === makerId` |
| `POST` | `/api/valuation-cases/:id/start` | `valuation:start` | |
| `POST` | `/api/valuation-cases/:id/mark` | `valuation:mark_status` | `{ status: NOT_VISITED\|PENDING, remark }` — remark mandatory |
| `POST` | `/api/valuation-cases/:id/submit-for-checking` | `valuation:submit` | Server recomputes and compares before accepting |
| `POST` | `/api/valuation-cases/:id/check` | `valuation:check` | Completes checking |
| `POST` | `/api/valuation-cases/:id/return` | `valuation:return` | `{ reasonCode, comment, flaggedSections[] }` — comment mandatory; opens a `CorrectionCycle` |
| `POST` | `/api/valuation-cases/:id/resubmit` | `valuation:submit` | Closes the open correction cycle |
| `POST` | `/api/valuation-cases/:id/approve` | `approval:manager` / `approval:director` | Level resolved server-side; caller may not be maker or checker |
| `POST` | `/api/valuation-cases/:id/reject` | same | Mandatory comment |
| `POST` | `/api/valuation-cases/:id/sign` | `signature:sign` | Requires recent re-authentication; freezes the report version |
| `POST` | `/api/valuation-cases/:id/generate-report` | `report:generate` | Async job; returns `202` + job id |
| `POST` | `/api/valuation-cases/:id/generate-cover-page` | `coverpage:generate` | Auto-populated from case data (§15) |
| `POST` | `/api/valuation-cases/:id/generate-final-letter` | `letter:generate` | Authority resolved from configured thresholds (§18) |
| `POST` | `/api/valuation-cases/:id/deliver` | `case:read` + manager | Marks `COMPLETED`, notifies requester |
| `POST` | `/api/valuation-cases/:id/archive` | `case:archive` | |
| `POST` | `/api/valuation-cases/:id/cancel` | `case:cancel` | Pre-approval only; mandatory reason |
| `GET` | `/api/valuation-cases/:id/timeline` | `case:timeline_read` | `WorkflowHistory` + correction cycles + durations (§32) |
| `GET` | `/api/valuation-cases/:id/corrections` | `case:read` | Full correction history |
| `GET` | `/api/valuation-cases/:id/available-transitions` | `case:read` | What *this* actor may do now — drives the UI without duplicating rules in it |

## 4. Property registration

`GET|PUT /api/valuation-cases/:id/civil-property` ·
`GET|POST /api/valuation-cases/:id/buildings` · `PATCH|DELETE /api/buildings/:buildingId` (≤40 enforced) ·
`GET|PUT /api/valuation-cases/:id/mechanical-property` ·
`GET|POST /api/valuation-cases/:id/vehicles` · `/machinery` · `PATCH|DELETE /api/vehicles/:id` · `/api/machinery/:id` (combined ≤300) ·
`POST /api/valuation-cases/:id/site-visits`.

## 5. Documents

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/documents/upload` | Multipart, streamed. Validates extension, sniffs real MIME, checks size, computes SHA-256, stores under a random key, queues AV scan. Returns metadata only |
| `GET` | `/api/documents?caseId=` | Metadata list; **no storage paths** (Rule 6) |
| `GET` | `/api/documents/:id/download` | Authorises, refuses non-`CLEAN` scan status, streams with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, audits the access |
| `GET` | `/api/documents/:id/preview` | Inline preview for PDF/images only, sandboxed |
| `POST` | `/api/documents/:id/version` | Uploads a superseding version |
| `DELETE` | `/api/documents/:id` | Soft delete with mandatory reason; blocked on approved cases |

## 6. Valuation & calculation

| Method | Path | Notes |
|---|---|---|
| `GET|PUT` | `/api/valuations/:id/cost-approach` | |
| `GET|PUT` | `/api/valuations/:id/sales-approach` | |
| `POST|DELETE` | `/api/valuations/:id/comparables` · `/api/comparables/:id` | |
| `GET|PUT` | `/api/valuations/:id/reconciliation` | Rejects weights not summing to 100 |
| `GET|PUT` | `/api/valuations/:id/forced-sale` | |
| `GET|PUT` | `/api/valuations/:id/mechanical/market-approach` · `/cost-approach` | |
| `POST` | `/api/valuations/:id/calculate` | **The authoritative computation** (§28). Runs server-side in decimal, persists a `CalculationRun`, returns the full breakdown |
| `POST` | `/api/valuations/:id/preview-calculation` | Same engine, nothing persisted — lets the UI show live figures without ever computing them itself |
| `GET` | `/api/valuations/:id/breakdown` | Input → formula → rate → quantity → amount → adjustment → depreciation → final (§9) |
| `POST` | `/api/valuations/:id/new-version` | Post-approval correction creates a new version, never an edit (§29) |

`preview-calculation` exists specifically so that no arithmetic ever needs to be reimplemented in JavaScript on the client.

## 7. Workflow, dashboards, search, reports, admin

- **Tasks**: `GET /api/tasks/my`, `GET /api/tasks/workload?role=`, `POST /api/tasks/:id/reassign`.
- **Dashboards**: `GET /api/dashboard/{maker|checker|manager|director|requester}` — each returns only its role's metrics (§21), computed with scope filters applied.
- **Search** (§24): `GET /api/search/cases` accepting case number, owner, applicant, LHC, plate, chassis, property/request type, org, sub-city, woreda, valuator, checker, status, date range, amount range, approval level; and `GET /api/search/archive`.
- **Reports** (§34): `GET /api/reports/operational?period=daily|weekly|monthly|quarterly|yearly`, `/performance?subject=maker|checker|manager|department`, `/sla`, `/valuation-summary`, each with `?format=json|pdf|xlsx`.
- **Notifications**: `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`.
- **Admin**: `/api/admin/users`, `/roles`, `/permissions`, `/organizations`, `/property-categories`, `/request-types`, `/approval-thresholds`, `/valuation-parameters`, `/report-templates`, `/notification-rules`, `/sla-policies`, `/holidays`, `/system-config`, `/audit-logs` (read-only, filterable, exportable). Every write is audited with before/after values.

## 8. Cross-cutting security

Applied uniformly by middleware rather than per-endpoint, so a new endpoint is secure by default: authentication, permission and scope resolution, rate limiting (stricter on auth and download), CSRF protection on cookie-authenticated mutations, security headers including a strict CSP, request-size limits, correlation-ID propagation, and structured audit logging. Responses are shaped by role — a Process Owner's case payload omits the calculation working entirely rather than relying on the UI not to render it.
