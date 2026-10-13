# RBAC Matrix

Authorisation is a **two-key check** on every protected operation (§26, Rule 4):

1. **Permission** — does any role held by the caller grant this permission?
2. **Scope** — does the caller stand in the required *relationship* to this specific record?

Both are enforced server-side. Hiding a button is a usability decision, never a security control.

## 1. Roles

| Code | Name | Scope of visibility |
|------|------|---------------------|
| `ADMIN` | System Administrator | **Everything.** Configuration, users, and full operating authority on every case in every unit |
| `PROCESS_OWNER` | Requesting branch / district / HO unit | Own organisation unit's cases |
| `MAKER_MANAGER` | Maker Manager | All cases in own department |
| `MAKER` | Valuator (Maker) | Cases assigned to self |
| `CHECKER_MANAGER` | Checker Manager | Cases at or past `SUBMITTED_FOR_CHECKING` in own department |
| `CHECKER` | Valuator (Checker) | Cases assigned to self for checking |
| `DIRECTOR` | Director | All cases in own department |

> **Policy change.** This system was first built with the administrator holding read-only oversight, so that segregation of duties was enforced for every account. The bank subsequently decided the administrator must be able to act on every page. That decision is implemented below; this note records that it was a deliberate reversal rather than an oversight.

`ADMIN` holds the complete permission catalogue and can act on any case, in any workflow role.

**What this costs.** For the administrator account, the system no longer *enforces* that two different people were involved in a valuation. One administrator could raise a case, value it, check it and sign it. Maker–checker separation remains enforced for every other role, but for this one it becomes a matter of procedure rather than something the software guarantees.

**What still holds.**

1. **Every action is audited**, with before/after values, and the audit log is append-only at the database level.
2. **Overrides are visible.** When an administrator acts in a role they do not hold, the workflow history records the actor role as `ADMIN` rather than as the role they stood in for — so an auditor reading a case timeline can tell an override from ordinary work.
3. **Participation still vetoes approval.** An administrator who personally valued or checked a case cannot approve or sign *that* case. This guard is about the specific record, not about role, so the override does not lift it.
4. **The approval chain order still applies.** An administrator may stand in for the *next* approver; they cannot skip a stage.
5. **No operating role gained anything.** `MAKER`, `CHECKER`, `MAKER_MANAGER`, `CHECKER_MANAGER`, `PROCESS_OWNER` and `DIRECTOR` remain scoped exactly as before.

Because this concentrates authority in one account, the controls that matter most are now operational rather than technical: keep administrator accounts few, name them to individuals rather than sharing one, enable MFA for the role, and review `audit:read` for actions attributed to `ADMIN`.

### The `system:administer` grant

Full authority is carried by one permission, `system:administer`, which satisfies the **scope** half of the two-key check for every permission and lets the holder act in any workflow role.

The narrower `case:read_all` remains in the catalogue: it satisfies scope for read-only permissions only, and is the right grant for an oversight or audit role that should see everything without being able to change anything. No role holds it by default now that `ADMIN` holds the broader grant.

Both are covered by `tests/security/admin-authority.test.ts`, which asserts that the authority is genuinely complete (no page silently refuses the administrator), that the surviving guards survive, and that the interface offers exactly the actions the server would accept.

## 2. Scope predicates

| Predicate | Definition |
|-----------|------------|
| `OWN_ORG` | `case.requesting_org_id` is the user's unit, or a descendant when the user holds `org:rollup` |
| `SELF_MAKER` | `case.maker_id = user.id` |
| `SELF_CHECKER` | `case.checker_id = user.id` |
| `DEPT` | `case.department_id` is the user's department |
| `NOT_PARTICIPANT` | User is neither maker nor checker on the case (segregation of duties) |
| `ANY` | No record-level restriction |
| `GLOBAL_READER` | Actor holds `case:read_all`. Satisfies scope for read-only permissions only |
| `GLOBAL_ADMIN` | Actor holds `system:administer`. Satisfies scope for **every** permission; `NOT_PARTICIPANT` still vetoes on top |

## 3. Case & workflow permissions

| Permission | ADMIN | PROCESS_OWNER | MAKER_MANAGER | MAKER | CHECKER_MANAGER | CHECKER | DIRECTOR |
|---|---|---|---|---|---|---|---|
| `case:create` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | — | — | — | — | — |
| `case:read` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `case:read_all` | — (superseded by `system:administer`) | — | — | — | — | — | — |
| `system:administer` | ✅ `ANY` | — | — | — | — | — | — |
| `case:update_request` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` (`DRAFT` only) | — | — | — | — | — |
| `case:cancel` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` (pre-approval) | — | — | — | — | — |
| `case:assign_maker` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | — | — | — |
| `case:assign_checker` | ✅ `GLOBAL_ADMIN` | — | — | — | ✅ `DEPT` | — | — |
| `case:reassign` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | ✅ `DEPT` | — | ✅ `DEPT` |
| `case:return_to_requester` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | — | — | — |
| `case:archive` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | — | — | — |
| `case:timeline_read` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |

## 4. Valuation permissions

| Permission | ADMIN | PROCESS_OWNER | MAKER_MANAGER | MAKER | CHECKER_MANAGER | CHECKER | DIRECTOR |
|---|---|---|---|---|---|---|---|
| `valuation:start` | ✅ `GLOBAL_ADMIN` | — | — | ✅ `SELF_MAKER` | — | — | — |
| `valuation:edit` | ✅ `GLOBAL_ADMIN` | — | — | ✅ `SELF_MAKER` (non-terminal only) | — | — | — |
| `valuation:calculate` | ✅ `GLOBAL_ADMIN` | — | — | ✅ `SELF_MAKER` | — | — | — |
| `valuation:submit` | ✅ `GLOBAL_ADMIN` | — | — | ✅ `SELF_MAKER` | — | — | — |
| `valuation:read` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` (post-completion, summary only) | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `valuation:check` | ✅ `GLOBAL_ADMIN` | — | — | — | — | ✅ `SELF_CHECKER` | — |
| `valuation:return` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | — | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `valuation:mark_status` (not visited / pending) | ✅ `GLOBAL_ADMIN` | — | — | ✅ `SELF_MAKER` | — | — | — |

A Process Owner sees the **result**, not the working. Exposing intermediate calculations to the requesting branch would invite pressure on the valuator, which is precisely what the maker–checker separation exists to prevent.

## 5. Approval & signature permissions

| Permission | ADMIN | PROCESS_OWNER | MAKER_MANAGER | MAKER | CHECKER_MANAGER | CHECKER | DIRECTOR |
|---|---|---|---|---|---|---|---|
| `approval:manager` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` + `NOT_PARTICIPANT` | — | — | — | — |
| `approval:director` | ✅ `GLOBAL_ADMIN` | — | — | — | — | — | ✅ `DEPT` + `NOT_PARTICIPANT` |
| `signature:sign` | ✅ `GLOBAL_ADMIN` | — | ✅ (when the routing chain names them) | — | — | — | ✅ (when named) |
| `letter:generate` | ✅ `GLOBAL_ADMIN` | — | ✅ (< configured letter threshold) | — | — | — | ✅ (≥ threshold) |
| `report:generate` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `report:download_final` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` (post-`COMPLETED`) | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `coverpage:generate` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | — | — | ✅ `DEPT` |

## 6. Document permissions

| Permission | ADMIN | PROCESS_OWNER | MAKER_MANAGER | MAKER | CHECKER_MANAGER | CHECKER | DIRECTOR |
|---|---|---|---|---|---|---|---|
| `document:upload` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | — | ✅ `SELF_MAKER` | — | — | — |
| `document:read_metadata` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `document:download` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | ✅ `DEPT` | ✅ `SELF_MAKER` | ✅ `DEPT` | ✅ `SELF_CHECKER` | ✅ `DEPT` |
| `document:delete` | ✅ `GLOBAL_ADMIN` | ✅ own upload, `DRAFT` only | ✅ `DEPT` pre-approval, audited | ✅ own upload, pre-submission | — | — | — |

No role can delete a document attached to an approved case (Rule 7). Deletion is always a soft delete carrying a reason, and the file itself is retained.

## 7. Administration permissions

All `ADMIN` only, all audited with before/after values: `user:*`, `role:*`, `permission:*`, `org:*`, `config:read` / `config:update`, `threshold:update`, `parameter:update`, `category:update`, `requesttype:update`, `template:update`, `notification:config`, `sla:config`, `audit:read`.

`audit:read` is additionally granted to `DIRECTOR` in read-only form for their own department, so a Director can investigate a case history without an administrator's help — which matters more now that the administrator can also act on cases. **No role may write or amend an audit record** — the table is append-only and enforced by a database trigger, not merely by convention.

## 8. Report & dashboard permissions

| Permission | ADMIN | PROCESS_OWNER | MAKER_MANAGER | MAKER | CHECKER_MANAGER | CHECKER | DIRECTOR |
|---|---|---|---|---|---|---|---|
| `dashboard:maker` | ✅ `GLOBAL_ADMIN` | — | — | ✅ | — | — | — |
| `dashboard:checker` | ✅ `GLOBAL_ADMIN` | — | — | — | — | ✅ | — |
| `dashboard:manager` | ✅ `GLOBAL_ADMIN` | — | ✅ | — | ✅ | — | ✅ |
| `dashboard:director` | ✅ `GLOBAL_ADMIN` | — | — | — | — | — | ✅ |
| `dashboard:requester` | ✅ `GLOBAL_ADMIN` | ✅ | — | — | — | — | — |
| `report:operational` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | ✅ `DEPT` | — | ✅ `DEPT` |
| `report:performance` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | own only | ✅ `DEPT` | own only | ✅ `DEPT` |
| `report:sla` | ✅ `GLOBAL_ADMIN` | — | ✅ `DEPT` | — | ✅ `DEPT` | — | ✅ `DEPT` |
| `archive:search` | ✅ `GLOBAL_ADMIN` | ✅ `OWN_ORG` | ✅ `DEPT` | ✅ `DEPT` (read-only) | ✅ `DEPT` | ✅ `DEPT` (read-only) | ✅ `DEPT` |

## 9. Implementation

Permissions are rows, not enum values in code (§37): `Role → RolePermission → Permission`. Adding a permission or re-granting one is a configuration change through the admin UI, fully audited. The application resolves a caller's effective permission set once per request and caches it for that request only, so a mid-session permission revocation takes effect on the next request rather than at next login.

Every server action and route handler begins with:

```ts
const actor = await requireActor();                       // authenticated session
await authorize(actor, 'case:assign_maker', { caseId });  // permission + scope, throws on failure
```

`authorize` throws rather than returning a boolean, so a forgotten check is a crash in testing rather than a silent authorisation bypass in production.
