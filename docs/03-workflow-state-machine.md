# Workflow & State Machine

Every transition below is enforced by `WorkflowService` inside a single database transaction (§36, Rules 11–14). Nothing in the UI may set a status directly (§20).

## 1. Status set

| Status | Meaning | Case is held by |
|--------|---------|-----------------|
| `DRAFT` | Request being composed, not yet visible to PVD | Process Owner |
| `REQUESTED` | Submitted, awaiting maker-side assignment | Maker Manager |
| `ASSIGNED` | Maker named, not yet started | Maker |
| `ON_PROGRESS` | Valuation under way | Maker |
| `NOT_VISITED` | Site not accessible — mandatory remark | Maker |
| `PENDING` | Blocked on external input — mandatory remark | Maker |
| `AWAITING_REQUESTER` | Blocked on the requesting unit; **SLA clock paused** | Process Owner |
| `SUBMITTED_FOR_CHECKING` | Maker work complete, awaiting checker assignment | Checker Manager |
| `CHECKING` | Checker assigned and reviewing | Checker |
| `COMMENTED` | Checker raised comments, case not yet returned | Checker |
| `RETURNED_FOR_CORRECTION` | Sent back with mandatory reason | Maker |
| `CHECKED` | Checking complete; routing decision taken | Routing |
| `PENDING_MANAGER_APPROVAL` | Awaiting Maker Manager approval | Maker Manager |
| `PENDING_DIRECTOR_APPROVAL` | Awaiting Director approval | Director |
| `APPROVED` | All required approvals recorded | Signing authority |
| `SIGNED` | Digitally signed; report immutable | Letter authority |
| `COMPLETED` | Final letter issued and delivered to requester | Process Owner |
| `ARCHIVED` | Closed; searchable, read-only | — |
| `CANCELLED` | Withdrawn before completion, with reason | — |

## 2. Primary flow

```
              ┌─────────┐
              │  DRAFT  │
              └────┬────┘
                   │ submitRequest  (PROCESS_OWNER)
                   ▼
             ┌───────────┐
             │ REQUESTED │◄──────────────── returnToRequester
             └─────┬─────┘                  (MAKER_MANAGER, reason required)
                   │ assignMaker  (MAKER_MANAGER)
                   ▼
             ┌──────────┐
             │ ASSIGNED │
             └─────┬────┘
                   │ startValuation  (MAKER, self only)
                   ▼
           ┌───────────────┐   markNotVisited / markPending (remark required)
           │  ON_PROGRESS  │◄────────────────► NOT_VISITED · PENDING
           └───────┬───────┘   resume
                   │ submitForChecking  (MAKER)
                   │   guards: required documents present, calculation
                   │   complete and server-recomputed, all correction
                   │   cycles resolved
                   ▼
        ┌────────────────────────┐
        │ SUBMITTED_FOR_CHECKING │
        └───────────┬────────────┘
                    │ assignChecker  (CHECKER_MANAGER; checker ≠ maker)
                    ▼
              ┌──────────┐  addComment   ┌───────────┐
              │ CHECKING │──────────────►│ COMMENTED │
              └────┬─────┘◄──────────────└─────┬─────┘
                   │                            │ returnForCorrection
                   │ completeChecking           │ (mandatory comment)
                   │                            ▼
                   │                 ┌─────────────────────────┐
                   │                 │ RETURNED_FOR_CORRECTION │
                   │                 └────────────┬────────────┘
                   │                              │ resubmit (MAKER)
                   │                              │ → CHECKING, same checker,
                   │                              │   correction cycle closed
                   │◄─────────────────────────────┘
                   ▼
              ┌─────────┐
              │ CHECKED │
              └────┬────┘
                   │ ApprovalRoutingService.resolve(finalValue)
        ┌──────────┼───────────────────────┐
        │          │                       │
   ≤ 5M │   >5M and <80M │            ≥ 80M │
        │          ▼                       ▼
        │  ┌──────────────────────┐  ┌──────────────────────┐
        │  │ PENDING_MANAGER_     │  │ PENDING_MANAGER_     │
        │  │ APPROVAL             │  │ APPROVAL             │
        │  └──────────┬───────────┘  └──────────┬───────────┘
        │             │ approve                  │ approve
        │             │                          ▼
        │             │             ┌────────────────────────┐
        │             │             │ PENDING_DIRECTOR_      │
        │             │             │ APPROVAL               │
        │             │             └────────────┬───────────┘
        │             │                          │ approve
        └─────────────┴──────────────────────────┘
                                  ▼
                            ┌──────────┐
                            │ APPROVED │
                            └────┬─────┘
                                 │ sign  (re-authentication required;
                                 │        report version frozen)
                                 ▼
                            ┌────────┐
                            │ SIGNED │
                            └───┬────┘
                                │ generateFinalLetter
                                │   <100M → MAKER_MANAGER
                                │   ≥100M → DIRECTOR
                                │ then deliver → notify Process Owner
                                ▼
                          ┌───────────┐
                          │ COMPLETED │
                          └─────┬─────┘
                                │ archive (automatic after retention delay,
                                ▼         or manual by MAKER_MANAGER)
                          ┌──────────┐
                          │ ARCHIVED │
                          └──────────┘
```

`CANCELLED` is reachable from any pre-`APPROVED` status by the originating Process Owner or an administrator, with a mandatory reason. It is never reachable after `APPROVED` — an approved valuation is superseded by a new version, never cancelled (§29, Rule 9).

## 3. Return paths

Returns are never a bare status change (§33). Each opens a `CorrectionCycle` row recording sequence number, returned-by, returned-at, previous status, reason code, comment, and the specific fields or sections flagged; it closes on resubmission with the resolution note and the elapsed rework duration.

| Return | From | To | Actor | Guard |
|--------|------|----|-------|-------|
| Checker → Maker | `CHECKING` / `COMMENTED` | `RETURNED_FOR_CORRECTION` | Assigned checker | Comment mandatory (min length enforced) |
| Manager → Maker | `PENDING_MANAGER_APPROVAL` | `RETURNED_FOR_CORRECTION` | Maker Manager | Comment mandatory |
| Director → Manager or Maker | `PENDING_DIRECTOR_APPROVAL` | `RETURNED_FOR_CORRECTION` | Director | Comment mandatory; target role selectable |
| Manager → Requester | `REQUESTED` | `AWAITING_REQUESTER` | Maker Manager | Reason mandatory; **SLA paused** |

A returned case re-enters the flow at the point it left; it does not restart from `REQUESTED`, and its correction history persists for the life of the case.

## 4. Transition guard matrix (excerpt)

| Transition | Allowed from | Required role | Additional guards |
|------------|--------------|---------------|-------------------|
| `submitRequest` | `DRAFT` | `PROCESS_OWNER` | Mandatory request fields; ≥1 document of each required category |
| `assignMaker` | `REQUESTED`, `AWAITING_REQUESTER` | `MAKER_MANAGER` | Maker active, discipline matches, not the assigning manager |
| `startValuation` | `ASSIGNED` | `MAKER` | Caller **is** the assigned maker |
| `submitForChecking` | `ON_PROGRESS` | `MAKER` | Server recomputes valuation and compares to stored result; required documents present; no open correction cycle |
| `assignChecker` | `SUBMITTED_FOR_CHECKING` | `CHECKER_MANAGER` | `checker ≠ maker`; discipline matches |
| `completeChecking` | `CHECKING` | `CHECKER` | Caller is assigned checker; every raised comment resolved |
| `approve` | `PENDING_*_APPROVAL` | Per routing band | Caller is neither maker nor checker; approval chain position reached |
| `sign` | `APPROVED` | Signing authority | Re-authentication within the last 5 minutes; document hash matches the approved version |
| `generateFinalLetter` | `SIGNED` | Per letter authority | Signed report exists |
| `archive` | `COMPLETED` | `MAKER_MANAGER` / system | Retention delay elapsed |

## 5. Concurrency

Every transition takes `SELECT … FOR UPDATE` on the case row and verifies the client-supplied `version` matches. A stale version returns `409 Conflict` with the current state rather than silently overwriting — this is what prevents two managers from assigning the same case to different makers (Rules 12–14). Idempotency keys on submit/approve/sign endpoints make a double-clicked button a no-op rather than a duplicate approval.

## 6. Side effects

Only after the transaction commits does `WorkflowService` emit domain events (`CaseAssigned`, `CaseReturned`, `ApprovalRequired`, `SlaBreached`, …). Notification dispatch, PDF generation and SLA recalculation subscribe to those events. A failing mail server therefore cannot roll back an approval, and a retried notification cannot duplicate a state change.
