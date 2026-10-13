# Migrations

## Before you accept a generated migration, read it

`prisma migrate dev` writes a proposal, not a finished migration. This schema
contains objects Prisma cannot express, so **every generation will propose
destroying some of them**. Accepting the proposal unread degrades the system
quietly — nothing fails, the guarantees just stop being enforced.

### 1. GIN trigram indexes will be proposed for deletion, every time

Seven indexes support the partial-match search that spec §24 requires:

```
valuation_cases_owner_name_trgm       valuation_cases_applicant_name_trgm
valuation_cases_case_number_trgm      civil_properties_lhc_trgm
vehicles_plate_trgm                   vehicles_chassis_trgm
machinery_serial_trgm
```

Prisma has no syntax for `USING gin (... gin_trgm_ops)`, so it cannot see them
in `schema.prisma` and reports them as drift. **Delete the `DropIndex` lines
from the generated SQL.** A b-tree cannot answer "show me anything with Tesfaye
in the owner name"; without these, that search becomes a sequential scan.

### 2. Triggers and check constraints live only in the initial migration

The append-only audit trail, the immutability of frozen valuations and approved
reports, the maker ≠ checker rule, and the reconciliation weights totalling 100
are enforced by triggers and `CHECK` constraints created in
`20260905164429_init`. Prisma does not model any of them, so it will never
propose recreating them — but it will also never warn you if a future change
drops the table they hang from.

If you rebuild a table, re-create its guards in the same migration.

### 3. Partial unique indexes are also invisible

`valuations_one_current_per_case`, `workflow_tasks_one_open_per_case_type`,
`correction_cycles_one_open_per_case` and
`property_documents_unique_live_name` use `WHERE` clauses Prisma cannot
express. Same rule: they are not drift.

---

## The check that catches enum drift

Domain enums in `src/server/domain/shared/enums.ts` deliberately duplicate the
Prisma enums, so the domain layer stays free of `@prisma/client`.
`src/server/infrastructure/db/enum-parity.ts` asserts at compile time that the
two sets match exactly — adding a value to one and not the other fails
`npm run typecheck`.

If you add an enum value, expect to touch three places: `schema.prisma`, the
domain enum, and a migration. The typecheck will tell you if you missed one.

---

## Verifying a migration applied correctly

```bash
npm run db:migrate
npm run test:integration   # exercises the constraints and triggers directly
```

The integration suite writes straight to the database, bypassing the
application, precisely so that a weakened constraint shows up as a failing test
rather than as a corrupted valuation months later.
