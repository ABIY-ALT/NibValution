# Folder Structure

```
nib-valuation/
├── docs/                              # architecture, ERD, workflow, RBAC, API, roadmap, UAT
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/                          # roles, permissions, request types, categories,
│                                      # thresholds, parameters, dev users (never real creds)
├── src/
│   ├── app/
│   │   ├── (auth)/                    # login, forgot-password, change-password
│   │   ├── (app)/
│   │   │   ├── dashboard/             # role-routed
│   │   │   ├── requests/              # list, new, [id], [id]/timeline
│   │   │   ├── civil/[caseId]/        # property, buildings, documents, site-visit,
│   │   │   │                          # cost-approach, sales-approach, reconciliation, report
│   │   │   ├── mechanical/[caseId]/   # equipment, documents, market-approach, cost-approach, report
│   │   │   ├── tasks/                 # my tasks, assignment, checking, approval
│   │   │   ├── reports/               # valuation, performance, SLA, workload
│   │   │   ├── archive/               # search, historical cases, document repository
│   │   │   └── admin/                 # users, roles, permissions, categories, request types,
│   │   │                              # thresholds, parameters, templates, notifications, audit
│   │   └── api/                       # route handlers mirroring docs/05
│   ├── components/
│   │   ├── ui/                        # shadcn primitives
│   │   ├── forms/                     # RHF + Zod field components
│   │   ├── data-table/                # sortable, filterable, paginated table
│   │   ├── workflow/                  # timeline, status badge, transition buttons, return dialog
│   │   └── valuation/                 # calculation breakdown, comparables grid, reconciliation
│   ├── server/
│   │   ├── actions/                   # server actions -> application services
│   │   ├── application/               # use-cases: auth, cases, valuation, documents,
│   │   │                              # approval, reports, admin  (the ONLY layer both
│   │   │                              # actions and route handlers call)
│   │   ├── domain/                    # ← no framework imports, fully unit-testable
│   │   │   ├── workflow/              # state machine, guards, WorkflowService
│   │   │   ├── valuation/             # cost, sales, reconciliation, depreciation,
│   │   │   │                          # forced-sale, mechanical engines, Money
│   │   │   ├── approval/              # threshold routing, letter authority
│   │   │   ├── sla/                   # working-day calendar, SLA computation
│   │   │   ├── rbac/                  # permissions, scope predicates, authorize()
│   │   │   ├── signature/             # SignatureProvider interface + orchestration
│   │   │   └── ports/                 # repository & service interfaces
│   │   └── infrastructure/
│   │       ├── db/                    # Prisma client, repositories, transaction helper
│   │       ├── storage/               # local + S3 drivers behind StorageProvider
│   │       ├── mail/  sms/            # NotificationChannel implementations
│   │       ├── scanner/               # ClamAV/ICAP + no-op (dev) MalwareScanner
│   │       ├── pdf/                   # renderer + versioned templates
│   │       ├── signature/             # local ECDSA + external PKI adapters
│   │       ├── jobs/                  # queue, workers (pdf, email, sla sweep, av)
│   │       └── audit/                 # AuditService
│   ├── lib/                           # money, dates, result type, errors, logger, config
│   └── types/
├── tests/
│   ├── unit/                          # valuation, depreciation, reconciliation, thresholds,
│   │                                  # SLA, permissions  (§38)
│   ├── integration/                   # full workflow paths against a real database
│   ├── security/                      # authz, IDOR, escalation, upload, file access
│   └── e2e/                           # Playwright, one journey per role
├── scripts/                           # migrate, seed, backup, key rotation
└── docker-compose.yml                 # postgres, mailhog, clamav, minio for local dev
```

## Rules the structure enforces

1. **`src/server/domain/**` imports nothing from `next`, `react`, `@prisma/client` or any I/O library.** It depends only on interfaces in `domain/ports`. This is enforced by an ESLint `no-restricted-imports` boundary rule, and it is what allows the valuation engine to be tested exhaustively without a database.
2. **UI never calls Prisma.** Components call server actions; server actions call application services; application services call domain services and repositories.
3. **Both API surfaces share one implementation.** A route handler and a server action for the same operation are two thin adapters over one application service — so an authorisation rule cannot be present in one and missing from the other.
4. **Business rules live in `domain/` or in configuration tables — never in `components/`** (§37).
