# Assumptions & Open Questions

> Status legend: **[A]** = assumption applied in the build (configurable at runtime), **[Q]** = question requiring confirmation from the Property Valuation Department (PVD).
>
> Per §37 and Development Rule 41, **no business rule below is hard-coded**. Every value listed here lives in a configuration table (`ApprovalThreshold`, `ValuationParameter`, `SystemConfiguration`, `PropertyCategory`, `RequestType`, `SlaPolicy`) and is editable by an administrator without a code change or redeploy.

---

## 1. Approval routing & thresholds

| # | Item | Resolution |
|---|------|------------|
| 1.1 | §17 defines approval bands at ETB 5M / 80M; §18 defines final-letter authority at ETB 100M. These are **two different ladders**. | **[A]** Modelled as two independent, separately configurable rule sets: `ApprovalThreshold` (routing/sign-off) and `FinalLetterAuthority` (letter issuer). Neither is derived from the other. |
| 1.2 | For cases **≤ ETB 5M**, §17 says "Maker → Checker" only. Does the Maker Manager still sign off, or does Checker completion finalise it? | **[A]** Checker completion finalises the valuation for ≤5M; the Maker Manager still issues the **final letter** (§18, <100M) and closes the case. **[Q]** Confirm whether ≤5M cases need any managerial sign-off at all. |
| 1.3 | Which monetary figure drives routing — reconciled market value, forced-sale value, or the total across all properties in the case? | **[A]** The **case-level final estimated (reconciled market) value**, summed across all properties in the case. A forced-sale value never lowers the approval level. The selector is configurable (`SystemConfiguration.approval_basis`). **[Q]** Confirm. |
| 1.4 | Band boundaries: "above 5M and below 80M", "80M and above" — inclusive or exclusive? | **[A]** Bands stored as `[min_inclusive, max_exclusive)` so neither a gap nor an overlap is representable; a check constraint plus a service-level validator enforces full coverage from 0 to unbounded. |
| 1.5 | Do higher bands still require the lower approvers (does a ≥80M case also need Manager approval)? | **[A]** Yes — §17 shows a cumulative chain Maker → Checker → Manager → Director. Modelled as an **ordered approval chain per band**, not a single approver. |
| 1.6 | Currency | **[A]** ETB only. All monetary columns are `NUMERIC(20,2)` with a currency code column defaulting to `ETB`, so a second currency would be additive rather than a migration of every value. |

## 2. Roles & organisation

| # | Item | Resolution |
|---|------|------------|
| 2.1 | "Manager / Maker Manager" and "Checker Manager" — one role or two? | **[A]** Two distinct roles (`MAKER_MANAGER`, `CHECKER_MANAGER`). One user **may hold both** via `UserRole`; the workflow engine still enforces segregation of duties per case (2.2). |
| 2.2 | May the same person be Maker and Checker on one case? | **[A]** **No.** Enforced server-side and by database constraint (`checker_id <> maker_id`), and an approver may not approve a case they made or checked. **[Q]** Confirm whether a documented override is needed for thinly-staffed districts. |
| 2.3 | May a Manager assign a case to themselves as Maker? | **[A]** Not permitted — same segregation-of-duties rule. |
| 2.4 | Visibility scope of a Process Owner | **[A]** Their own organisation unit and their own submitted requests, with an admin-grantable "district roll-up" permission for district offices. **[Q]** Confirm whether a branch user may see sister-branch cases. |
| 2.5 | Are valuators specialised by discipline (Civil vs Mechanical)? | **[A]** Yes — each valuator carries a `discipline` (`CIVIL`, `MECHANICAL`, `BOTH`); the assignment UI filters by case discipline and the server rejects a mismatched assignment. **[Q]** Confirm this matches PVD practice. |
| 2.6 | Director assignment | **[A]** Multiple Directors supported; any Director of the owning department may approve. **[Q]** Confirm whether a specific Director must be named per case. |

## 3. Valuation methodology

| # | Item | Resolution |
|---|------|------------|
| 3.1 | **"MCF"** (§9) is not defined anywhere in the source. | **[Q — highest impact]** Implemented as a named, versioned `ValuationParameter` of type `FACTOR`, applied as a multiplier at a configurable point in the cost-approach pipeline, with its position captured in the stored `formula_version`. PVD must confirm the expansion (Market Correction Factor? Multiplication/Cost Factor?), its values, and where it applies. **Calculation output cannot be certified until this is answered.** |
| 3.2 | Default reconciliation weights (Cost % / Sales %) | **[A]** Default 60 / 40, configurable **per property category and per request type**. The UI requires the pair to sum to exactly 100 and the server re-validates independently. **[Q]** Confirm the approved defaults. |
| 3.3 | Depreciation method | **[A]** Straight-line on effective age vs. total economic life, floored at a configurable residual percentage. Alternative methods (age-life with condition modifier, declining balance) are selectable per property category. **[Q]** Confirm PVD's approved method and the economic-life table per building/equipment type. |
| 3.4 | Forced-sale percentage (§12) | **[A]** Configurable, default 75% of market value, overridable per case **with a mandatory justification remark**. **[Q]** Confirm the approved percentage and whether it varies by property category. |
| 3.5 | Land valuation under **Lease** vs **Freehold** vs **Both** | **[A]** Lease-held land valued on remaining lease term and unpaid lease balance; freehold on comparable land rate. All parameters configurable. **[Q]** Confirm the bank's treatment of lease land — some banks value it at nil for collateral purposes, which would materially change reported values. |
| 3.6 | Properties under construction (§9) | **[A]** `completed_replacement_cost × progress_percentage`, where progress is derived from per-element completion weights (substructure, superstructure, finishing, services) held as a configurable weight set. **[Q]** Confirm the element weight table. |
| 3.7 | Mechanical CIF-based valuation | **[A]** Current replacement cost may be derived from CIF value plus configurable duty / freight / installation loadings, or from a direct market quote. The Maker selects the basis and the choice is stored with the calculation. **[Q]** Confirm the loading percentages. |
| 3.8 | Rounding | **[A]** All intermediate arithmetic in arbitrary-precision decimal (never IEEE floats — Rule 28). Stored values rounded half-up to 2 decimals; any presentation rounding (e.g. nearest 100 ETB) is applied at report render only, never to stored values. |

## 4. SLA / TAT

| # | Item | Resolution |
|---|------|------------|
| 4.1 | 5-day TAT — calendar or working days? | **[A]** **Working days**, against a configurable working calendar (working days of week plus an admin-maintained Ethiopian public-holiday table). **[Q]** Confirm. |
| 4.2 | Clock start and stop events | **[A]** Starts at `REQUESTED`, stops at `COMPLETED` (report delivered). **[Q]** Confirm whether the stop event should instead be `APPROVED` or `SIGNED`. |
| 4.3 | Is the clock paused while waiting on the requester (e.g. missing documents)? | **[A]** Yes — an explicit `AWAITING_REQUESTER` pause is recorded in `SlaRecord` with paused-duration accounting, so both gross and net TAT are reportable. **[Q]** Confirm pauses are acceptable for KPI purposes. |
| 4.4 | Does a return-for-correction reset the SLA? | **[A]** No. The case clock runs continuously; per-stage clocks restart and correction cycles are reported separately so rework stays visible. **[Q]** Confirm. |
| 4.5 | "Approaching SLA" (amber) threshold | **[A]** Configurable, default at 80% of the allowed duration elapsed. |
| 4.6 | Per-stage SLA budgets | **[A]** The 5-day figure is treated as **end-to-end**; per-stage budgets (assignment, valuation, checking, approval) are configurable and default to a proportional split. **[Q]** Confirm per-stage budgets. |

## 5. Security, identity & signatures

| # | Item | Resolution |
|---|------|------------|
| 5.1 | Is there a corporate directory (Active Directory / LDAP) to authenticate against? | **[A]** Local credentials (Argon2id) behind an `IdentityProvider` interface, with an LDAP/AD adapter ready to enable. **[Q]** Confirm whether AD SSO is required at go-live — it affects UAT scripting and user provisioning. |
| 5.2 | Is there enterprise PKI / an HSM / a national digital-signature service? | **[A]** Per §19 a `SignatureProvider` interface is defined. Default implementation: detached signature (ECDSA P-256) over a canonical SHA-256 document hash, private key held in a KMS/secret store — deliberately **not** a hand-rolled cryptographic scheme. An external PKI/HSM adapter plugs in without touching workflow code. **[Q]** Confirm which infrastructure NIB will provide; this determines legal admissibility. |
| 5.3 | MFA | **[A]** TOTP implemented but **off by default**; enabling is a configuration flag and can be enforced per role (recommended for `DIRECTOR` and `ADMIN`). |
| 5.4 | Malware scanning of uploads (§8, §26) | **[A]** `MalwareScanner` interface with a ClamAV/ICAP adapter. Development uses a no-op scanner; **production fails closed** — with no scanner configured, uploads are quarantined rather than released. **[Q]** Confirm the bank's AV/ICAP endpoint. |
| 5.5 | Session timeout | **[A]** 30 min idle / 8 h absolute, configurable. |
| 5.6 | Password policy | **[A]** 12+ characters with complexity, history of 5, 90-day expiry, 5-attempt lockout with 15-minute cooloff — all configurable. **[Q]** Confirm against NIB IT security policy. |

## 6. Documents, delivery & retention

| # | Item | Resolution |
|---|------|------------|
| 6.1 | Production file storage target | **[A]** `StorageProvider` abstraction with local-filesystem (dev) and S3-compatible object storage (prod) drivers; an SMB/enterprise-file-server driver can be added without touching callers. **[Q]** Confirm the production target. |
| 6.2 | How is a completed report "delivered to the requesting organisation" (§42)? | **[A]** In-app authenticated download by the Process Owner plus an email notification carrying a link — never the PDF as an attachment, to keep distribution controlled and auditable. **[Q]** Confirm whether integration with core banking or an existing document system is expected. |
| 6.3 | Maximum upload size and accepted types | **[A]** 25 MB per file, 500 MB per case; allow-list of PDF, JPEG, PNG, TIFF, DOCX, XLSX, DWG. Executables and archives rejected. Configurable. **[Q]** Confirm, especially drawing formats and whether archives are needed. |
| 6.4 | Archive retention & deletion | **[A]** Archived cases retained indefinitely and remain searchable. **No hard delete** of approved records (Rule 7) — only an authorised, audited soft-delete carrying a reason. **[Q]** Confirm the statutory retention period. |
| 6.5 | Report language | **[A]** English. **[Q]** Confirm whether Amharic or bilingual output is required — it affects PDF font embedding and layout, and should be settled before report templates are finalised. |

## 7. Scope items with limited source definition

| # | Item | Resolution |
|---|------|------------|
| 7.1 | **`PROGRESS`** request type is named in the Scope of Work but never defined. | **[A]** Implemented as a configurable request type meaning *periodic valuation of a construction-in-progress property supporting staged disbursement*; it reuses the under-construction cost approach (3.6) and requires a prior-case reference. **[Q]** Confirm the definition and the link-to-original rule. |
| 7.2 | **`APPEAL`** | **[A]** Requires a mandatory prior-case reference and an appeal reason; by default routed to a **different Maker** than the original case. **[Q]** Confirm the re-assignment rule. |
| 7.3 | **`RE_ESTIMATION`** | **[A]** Requires a prior-case reference and pre-fills property data from that case as a new, independent case (never an edit of the approved one — Rule 9). |
| 7.4 | SMS gateway | **[A]** `NotificationChannel` interface with an SMS adapter stub. **[Q]** Confirm the provider and whether SMS is in scope for go-live. |
| 7.5 | "40 buildings per civil case" / "300 mechanical items" | **[A]** Treated as **enforced, configurable upper limits** validated server-side, not merely capacity guidance. Data entry is paginated; reports render items as appendix tables. |
| 7.6 | 40 concurrent users | **[A]** Sizing target for connection pooling, PDF worker concurrency and pagination defaults — not a licence limit. |

## 8. Explicitly out of scope until confirmed

- Core banking / CBS integration
- Native mobile app (the web UI is responsive; field capture is desktop/tablet browser)
- Offline site-inspection capture
- GIS map-tile subscription (coordinates are captured and validated; rendering uses a configurable tile source, which needs a licence decision)
- Automated market-data feeds for comparables (comparables are entered manually, then stored and reusable)

---

**Action required from PVD.** The **[Q]** items should be closed before UAT sign-off. The three highest-impact are **3.1 (MCF definition)** and **3.5 (lease land treatment)** — both change reported valuation figures — and **5.2 (signature infrastructure)**, which determines whether the digital signatures are legally admissible.
