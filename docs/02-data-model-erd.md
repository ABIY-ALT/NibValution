# Data Model & ERD

PostgreSQL 18, normalised, all monetary columns `NUMERIC(20,2)` (§28). Prisma is the only writer.

## 1. Domain map

```
IDENTITY & ORG                    CASE & PROPERTY                    VALUATION
──────────────                    ───────────────                    ─────────
Organization ─┐                   ValuationCase ─┬─ CivilProperty ──── CivilBuilding (≤40)
              ├─< User >──┬─ UserRole >── Role   │                          │
Department ───┘           │                │     │                          └─< BuildingElement
                          │           RolePermission                  │
                     Session          │                               ├─ MechanicalProperty ─┬─< Vehicle
                     Credential  Permission                           │      (≤300 items)    └─< Machinery
                                                  │                   │
                                                  ├─ RequestType      └── Valuation (versioned)
                                                  ├─ PropertyCategory        │
                                                  ├─< PropertyDocument       ├─ CivilValuation
                                                  ├─< SiteVisit              │    ├─ CostApproach ─< CostLineItem
                                                  ├─< Comment                │    │      └─< Depreciation
                                                  ├─< WorkflowHistory        │    ├─ SalesApproach ─< ComparableProperty
                                                  ├─< WorkflowTask           │    ├─ Reconciliation
                                                  ├─< CorrectionCycle        │    └─ ForcedSaleValuation
                                                  ├─< Approval               │
                                                  ├─< DigitalSignature       └─ MechanicalValuation
                                                  ├─< Report                      ├─ MechMarketApproach ─< ComparableEquipment
                                                  ├─< Notification               └─ MechCostApproach
                                                  └─  SlaRecord ─< SlaPause

CONFIGURATION                                     AUDIT
─────────────                                     ─────
ApprovalThreshold · ValuationParameter            AuditLog (append-only)
ValuationParameterSet · SystemConfiguration       CalculationRun (reproducibility)
PropertyCategory · RequestType · SlaPolicy
ReportTemplate · NotificationRule · Holiday
```

## 2. Identity & organisation

| Entity | Key columns | Notes |
|--------|-------------|-------|
| `Organization` | `id`, `code` U, `name`, `type` (BRANCH/DISTRICT/HEAD_OFFICE_UNIT), `parent_id` → self | Self-referencing hierarchy; district roll-up walks `parent_id` |
| `Department` | `id`, `code` U, `name` | Owning PVD department for a case |
| `User` | `id`, `employee_id` U, `email` U, `full_name`, `organization_id`, `department_id`, `discipline` (CIVIL/MECHANICAL/BOTH/NONE), `is_active`, `mfa_secret`, `locked_until`, `failed_attempts` | Never deleted, only deactivated |
| `Credential` | `user_id` U, `password_hash` (Argon2id), `algorithm`, `params`, `must_change`, `expires_at` | Split from `User` so a user read never loads a hash |
| `PasswordHistory` | `user_id`, `password_hash`, `created_at` | Enforces no-reuse policy |
| `Session` | `id`, `user_id`, `token_hash` U, `ip`, `user_agent`, `expires_at`, `absolute_expires_at`, `revoked_at` | Server-side, centrally revocable |
| `Role` / `Permission` / `RolePermission` / `UserRole` | | Permissions as data (§37), not code enums |

## 3. Case & property

### `ValuationCase` — the aggregate root

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | |
| `case_number` | text U | `PV-YYYY-NNNNNN`, allocated from `CaseNumberSequence` in-transaction |
| `request_type_id` | fk | Configurable (§4) |
| `discipline` | enum | `CIVIL` / `MECHANICAL` |
| `status` | enum | §20 set; transitions only via `WorkflowService` |
| `version` | int | Optimistic lock (Rule 14) |
| `requesting_org_id` | fk | Branch / district / HO unit |
| `department_id` | fk | Owning PVD department |
| `requested_by_id` | fk `User` | Process Owner |
| `maker_id`, `checker_id` | fk `User` null | **CHECK `checker_id <> maker_id`** |
| `maker_manager_id`, `checker_manager_id` | fk `User` null | |
| `applicant_name`, `applicant_phone`, `applicant_tin` | text | |
| `owner_name`, `owner_phone`, `owner_id_number` | text | |
| `prior_case_id` | fk self null | Required for RE_ESTIMATION / APPEAL / PROGRESS |
| `final_value`, `forced_sale_value` | numeric(20,2) null | Case-level totals, written only by the server |
| `currency` | char(3) | Default `ETB` |
| `approval_level` | enum null | Resolved from `ApprovalThreshold` |
| `requested_at`, `assigned_at`, `submitted_at`, `checked_at`, `approved_at`, `signed_at`, `completed_at`, `archived_at` | timestamptz null | Milestones for SLA and reporting |

Indexes: `case_number` U, `(status, department_id)`, `(maker_id, status)`, `(checker_id, status)`, `(requesting_org_id, requested_at)`, `(request_type_id, requested_at)`, `final_value`, plus GIN trigram on `owner_name` / `applicant_name` for §24 search.

### Civil

- **`CivilProperty`** — one per case: `lhc_number`, `sub_city`, `woreda`, `house_number`, `latitude`, `longitude`, `land_holding_right` (FREEHOLD / LEASE / BOTH), `plot_area`, `lease_remaining_years`, `lease_unpaid_balance`, `geographic_location`. Coordinates carry a check constraint on valid ranges.
- **`CivilBuilding`** — up to 40 per property (enforced by a server guard plus a `building_number` unique-per-property index): `building_number`, `building_type_id`, `floor_count`, `gross_area`, `construction_status`, `construction_year`, `condition`, `structure_json`, `finishing_json`, `remarks`.
- **`BuildingElement`** — per-element completion weights for under-construction valuation (§9, assumption 3.6).

### Mechanical

- **`MechanicalProperty`** — one per case, holding installation site and plant-level attributes.
- **`Vehicle`** — `plate_number`, `chassis_number`, `engine_number`, `model`, `capacity`, `horse_power`, `cylinders`, `axle_number`, `libre_reference`. Indexed on `plate_number` and `chassis_number` (§24).
- **`Machinery`** — `equipment_name`, `manufacturer`, `model`, `serial_number`, `year`, `capacity`, `country_of_origin`, `installation_location`, `condition`, `purchase_price`, `insurance_value`, `cif_value`.

Combined `Vehicle` + `Machinery` count per case is capped at 300 (§7).

### `PropertyDocument`

`id`, `case_id`, `category_id`, `original_filename`, `storage_key` (random, opaque — **never returned to a client**), `mime_type`, `size_bytes`, `sha256`, `version`, `supersedes_id`, `scan_status` (PENDING/CLEAN/INFECTED/QUARANTINED), `uploaded_by_id`, `uploaded_at`, `deleted_at`, `deleted_reason`.

## 4. Valuation

`Valuation` is **versioned per case** (§29): `case_id`, `version`, `status`, `is_current`, `prepared_by_id`, `checked_by_id`, `market_value`, `forced_sale_value`, `formula_version`, `parameter_set_id`, `frozen_at`. A partial unique index guarantees one current version per case; a trigger rejects `UPDATE` on a frozen version.

- **`CostApproach`** → `CostLineItem` (input, rate, quantity, formula, computed amount, adjustment) → `Depreciation` (method, effective age, economic life, rate, amount). Every line stores its own formula string and computed amount so a report can display input → formula → rate → quantity → amount → adjustment → depreciation → final value exactly as §9 requires.
- **`SalesApproach`** → `ComparableProperty` (location, characteristics, sale price, area, unit price, adjustments JSON, adjusted value).
- **`Reconciliation`** — `cost_weight`, `sales_weight`, `reconciled_value`, with **CHECK `cost_weight + sales_weight = 100`**.
- **`ForcedSaleValuation`** — `market_value`, `forced_sale_percent`, `forced_sale_value`, `assumptions`, `remarks`.
- **`MechMarketApproach`** → `ComparableEquipment`; **`MechCostApproach`** — original cost, current replacement cost, depreciation, condition adjustment, remaining useful life.

### `CalculationRun` — the reproducibility record (§28)

`id`, `valuation_id`, `engine`, `formula_version`, `parameter_snapshot` (jsonb), `input_snapshot` (jsonb), `output_snapshot` (jsonb), `input_hash`, `performed_by_id`, `performed_at`. Append-only. This single table is what allows an auditor to re-run a two-year-old valuation and obtain the identical figure.

## 5. Workflow, approval & audit

| Entity | Purpose |
|--------|---------|
| `WorkflowTask` | The open action for a case: `assignee_id`, `role`, `task_type`, `due_at`, `completed_at`. Drives "My tasks" and workload counts |
| `WorkflowHistory` | Every transition: `from_status`, `to_status`, `actor_id`, `actor_role`, `action`, `comment`, `occurred_at`, `duration_seconds` — the case timeline (§32) |
| `CorrectionCycle` | `sequence`, `returned_by_id`, `returned_at`, `previous_status`, `reason_code`, `comment`, `flagged_sections`, `resolved_at`, `resolution_note` (§33) |
| `Comment` | Threaded, scoped to a case section, `is_resolved` |
| `Approval` | `case_id`, `level`, `chain_position`, `approver_id`, `decision`, `comment`, `decided_at`, `value_at_decision` — the value is stored so a later revaluation cannot retroactively alter what was approved |
| `DigitalSignature` | `case_id`, `report_id`, `signer_id`, `signed_at`, `document_sha256`, `signature`, `provider`, `certificate_ref`, `status` (§19) |
| `Report` | `case_id`, `version`, `type` (VALUATION/COVER_PAGE/FINAL_LETTER), `template_id`, `template_version`, `data_snapshot` (jsonb), `storage_key`, `sha256`, `generated_by_id`, `is_immutable` |
| `SlaRecord` / `SlaPause` | Policy, due date, elapsed/net working days, status, breach timestamp, paused intervals |
| `Notification` | Recipient, event type, channel, payload, `read_at`, delivery status and attempts |
| `AuditLog` | `actor_id`, `actor_role`, `action`, `entity`, `entity_id`, `before` (jsonb), `after` (jsonb), `ip`, `user_agent`, `correlation_id`, `occurred_at`. **Append-only, enforced by trigger** |

## 6. Configuration (§37)

| Entity | Contents |
|--------|----------|
| `ApprovalThreshold` | `min_amount` incl., `max_amount` excl. (null = unbounded), ordered `approval_chain` (jsonb array of roles), `effective_from`, `effective_to` — **temporal**, so a case is always evaluated against the rules in force on its request date |
| `FinalLetterAuthority` | Amount band → issuing role, also temporal (§18) |
| `ValuationParameterSet` / `ValuationParameter` | Named, versioned parameter snapshots (rates, factors, depreciation tables, MCF, forced-sale %, reconciliation weights). A valuation references the **set version** it used |
| `PropertyCategory` | Hierarchical, `discipline`, `is_active` — seeds all §5 categories |
| `RequestType` | Code, name, `requires_prior_case`, `is_active` |
| `SlaPolicy` / `Holiday` | Working-day calendar and per-stage budgets |
| `ReportTemplate` | Versioned templates; a `Report` pins the version it rendered |
| `NotificationRule` | Event → roles → channels → template |
| `SystemConfiguration` | Typed key/value with change history |

Temporal validity on thresholds and parameters is the design decision that makes historical reproducibility possible: raising a threshold next year must not retroactively make last year's approvals look non-compliant.

## 7. Integrity rules enforced in the database

- Unique: `case_number`, `(case_id, version)` on `Valuation` and `Report`, `(property_id, building_number)`, `plate_number`, `chassis_number`, `serial_number` where present.
- Check: `checker_id <> maker_id`; `cost_weight + sales_weight = 100`; all monetary values `>= 0`; `forced_sale_percent` between 0 and 100; latitude/longitude in range; `min_amount < max_amount`.
- Partial unique: one `is_current` valuation per case; one open `WorkflowTask` per case per task type.
- Triggers: append-only `AuditLog` and `CalculationRun`; immutability of frozen `Valuation`, approved `Report` and `DigitalSignature` rows (Rule 9).
- Foreign keys: `RESTRICT` on everything a case depends on — no cascade may silently remove valuation evidence.
