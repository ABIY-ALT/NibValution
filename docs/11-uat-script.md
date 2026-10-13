# User Acceptance Test Script

For the bank's UAT testers: one test per business rule, grouped by workflow path, with the role that performs it and the result to look for. Record **Pass / Fail / Blocked** and the case number in the last column; for a failure, note what you saw and the time, so it can be traced in the audit log.

**Environment:** the UAT (staging) server, freshly seeded. **Accounts:** see `docs/08-testing-guide.md` §2. Every account must set its own password at first sign-in. Use a separate browser profile per role.

**Approval bands (seeded):** up to ETB 5,000,000 → checker only; above 5,000,000 and below 80,000,000 → checker + manager; 80,000,000 and above → checker + manager + director. **Final letter:** below ETB 100,000,000 → manager issues; 100,000,000 and above → director.

---

## A. Intake

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| A1 | Process Owner (Mexico) | Valuation → New Request; applicant, owner, *New*, *Civil*; create | Case number `PV-<year>-NNNNNN` assigned; branch, department and status set by the system | |
| A2 | Process Owner | Choose *Re-Estimation* | An "earlier case number" field appears and is required | |
| A3 | Process Owner | Upload a PDF under *Land Holding Certificate* and *Request letter* | Files listed; the "still required" banner shrinks | |
| A4 | Process Owner | Rename any `.exe` to `.pdf` and upload it | Refused: the content is checked, not the name | |
| A5 | Process Owner | Upload a `.zip` | Refused | |
| A6 | Process Owner | Submit before all required documents are attached | Refused, naming what is missing | |
| A7 | Process Owner | Submit with all documents | Status **Requested**; SLA due date shown; the Maker Manager receives a notification | |
| A8 | Maker Manager | Return the request to the requester with a reason | Status **Awaiting requester**; SLA shows **Paused**; reason visible in the timeline | |
| A9 | Maker Manager | Return without a reason | Refused | |

## B. Valuation

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| B1 | Maker Manager | My Tasks → Assign a valuator | Only valuators of the case's discipline are offered, and **not yourself** | |
| B2 | Maker Manager | Assign after an A8 return | Allowed; the SLA clock resumes and the due date moves out by the paused working days | |
| B3 | Maker | My Tasks → the case → Start valuation | Status **On progress**; only *Submit for checking*, *Mark not visited*, *Mark pending* offered | |
| B4 | Maker | Mark pending with a two-word remark | Refused: remark too short | |
| B5 | Maker | Mark pending with a proper remark, then Resume | Pending → On progress; both in the timeline | |
| B6 | Maker | Submit for checking before any calculation | Refused: "valuation calculation is not complete" | |
| B7 | Maker | Valuation workspace: register the property (plot area, holding right) and a building | Saved; the worksheet becomes available | |
| B8 | Maker | Enter the land rate and building figures; Calculate | Full breakdown: land, building, depreciation, market value, forced-sale value; the valuation card shows the figure | |
| B9 | Maker | Change the plot area after calculating | Figures cleared; submission refused until recalculated | |
| B10 | Maker | Recalculate and submit for checking | Status **Submitted for checking**; the Checker Manager is notified | |
| B11 | Maker (mechanical case) | Register two vehicles; calculate | Per-item values, summed | |

## C. Checking

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| C1 | Checker Manager | Assign a checker | The case's own valuator is not offered as checker | |
| C2 | Checker | Raise a comment on *Land* | Status **Commented**; the Maker is notified | |
| C3 | Checker | Complete checking while the comment is open | Refused | |
| C4 | Checker | Return for correction without a comment | Refused | |
| C5 | Checker | Return for correction with a comment | Status **Returned for correction**; flagged sections recorded | |
| C6 | Maker | Reply in the comment thread; recalculate; resubmit without a note | Refused: a note of what was corrected is required | |
| C7 | Maker | Resubmit with a note | Back to **Checking**, with the **same checker**; the correction cycle and rework time are shown | |
| C8 | Checker | Resolve the comment; complete checking | Status **Checked** | |
| C9 | Maker | Try to resolve the checker's comment | Not offered: only the checker resolves | |

## D. Approval (one case per band)

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| D1 | Maker | Value a case at about ETB 3,000,000; after C8, submit for approval | Straight to **Approved** (checker band) | |
| D2 | Maker → Maker Manager | Value about ETB 20,000,000; submit for approval; manager approves | Pending manager approval → **Approved** | |
| D3 | Maker → Manager → Director | Value about ETB 120,000,000; manager approves, then director | Manager approval → Pending director approval → **Approved** | |
| D4 | Maker Manager | Reject a D2 case with a reason | **Returned for correction**; earlier approvals no longer count on resubmission | |
| D5 | Maker | Open your own case while it is *Pending manager approval* | No approval action is offered: a valuator cannot approve their own work | |
| D6 | Administrator | Value a case as the administrator, then try to approve it | Refused ("You performed the valuation or the check on this case…"): segregation of duties survives admin authority | |
| D7 | Any | After approval, try to change the property | Refused: the approved valuation is frozen | |

## E. Signing, documents and delivery

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| E1 | Maker Manager / Director | Sign an approved case with a wrong password | Refused; the attempt appears in the audit log | |
| E2 | Maker Manager / Director | Sign with the right password | Status **Signed**; approval record shows "signature valid" | |
| E3 | Any department role | Case → Documents | Cover page (from submission for approval) and valuation report listed with version and fingerprint | |
| E4 | Maker Manager | Deliver before issuing the final letter | Refused | |
| E5 | Maker Manager (D2 case) | Issue the final letter | Issued; a second issue is refused | |
| E6 | Maker Manager (D3 case, ≥100M) | Try to issue the final letter | Refused: the director issues it | |
| E7 | Director (D3 case) | Issue the final letter; deliver | Status **Completed**; the requester is notified | |
| E8 | Process Owner | Open the completed case | Sees the valuation report and final letter, **not** the cover page | |
| E9 | Process Owner | Open the report → Print → Save as PDF | A clean A4 document with the NIB letterhead | |

## F. Cancellation and archive

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| F1 | Process Owner | Cancel an unapproved own case with a reason | **Cancelled**; SLA closed | |
| F2 | Process Owner | Cancel an approved case | Not offered / refused | |
| F3 | Maker Manager | Archive a case completed today | Refused until the retention period (30 days) has passed | |

## G. Notifications and SLA

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| G1 | Maker | After B1, open the bell icon | "Case … assigned to you", linking to the case | |
| G2 | Maker Manager | Monitoring → SLA Tracking | Counts by state; filter by *Paused* shows the A8 case | |
| G3 | Administrator | Administration → SLA & Calendar: add a holiday falling inside an open case's allowance | That case's due date moves one working day later | |
| G4 | Administrator | Change the warning point to 60% | Open cases re-evaluated at once; the change is in the audit log | |

## H. Access boundaries

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| H1 | Process Owner (Bole) | Paste the URL of a Mexico case, and of one of its documents | **Not found** (not "forbidden"): another branch cannot learn the case exists | |
| H2 | Process Owner (Bole) | Valuation → Civil / Mechanical registers; search a Mexico LHC or plate | Only Bole's collateral; the Mexico one is not found | |
| H3 | Maker | Open `/admin/users` | A plain "no access" page naming the permission | |
| H4 | Any | Open one case in two tabs; act in both | The second is refused: "this case has changed since you opened it" | |
| H5 | Any | Five wrong passwords | Account locked; the message never reveals whether the account exists | |
| H6 | Any | Leave the browser idle 30 minutes, then click | Signed out | |
| H7 | Any | Paste `/requests/abc` | Not found (not an error page) | |

## I. Administration

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| I1 | Administrator | Users: deactivate a user who is signed in elsewhere | Their next click signs them out | |
| I2 | Administrator | Approval Thresholds: change a band's chain | Applies to new routing; old and new values in the audit log | |
| I3 | Administrator | Categories & Types: disable a category | Hidden from new cases only; existing cases keep it | |
| I4 | Administrator | Audit Log: filter by action and by user | Results match; every test above has left its entries | |

## J. Reports

| ID | Role | Steps | Expected | Result |
|---|---|---|---|---|
| J1 | Director | Reports: filter by branch and date | Totals and breakdowns agree with the rows | |
| J2 | Director | Export CSV; open in Excel | Same rows as on screen; Amharic names display correctly | |
| J3 | Process Owner | Reports | Only own branch's figures (or no access, per role) | |

---

## Coverage by role

| Role | Tests |
|---|---|
| Process Owner | A1–A7, E8–E9, F1–F2, H1–H2, H5–H7, J3 |
| Maker Manager | A8–A9, B1–B2, D2, D4, E1–E6, F3, G2 |
| Maker | B3–B11, C6–C7, C9, D1, D5, G1, H3 |
| Checker Manager | C1 |
| Checker | C2–C5, C8 |
| Director | D3, E7, J1–J2 |
| Dual Manager | D2 (as manager), C1 (as checker manager) |
| Administrator | D6, G3–G4, I1–I4 |

## Sign-off

| Area | Tester | Date | Result | Open defects |
|---|---|---|---|---|
| A. Intake | | | | |
| B. Valuation | | | | |
| C. Checking | | | | |
| D. Approval | | | | |
| E. Signing and delivery | | | | |
| F. Cancellation and archive | | | | |
| G. Notifications and SLA | | | | |
| H. Access boundaries | | | | |
| I. Administration | | | | |
| J. Reports | | | | |

UAT is complete when every row is **Pass**, or a failure has an agreed decision recorded against it.
