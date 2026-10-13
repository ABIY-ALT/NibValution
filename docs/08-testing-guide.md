# How to Check the Functionality

Two ways to exercise this system: run the automated checks, or walk it by hand. Both are described below. The full UAT script, with every workflow path and role, is `docs/11-uat-script.md`.

---

## 1. Automated checks

```bash
npm run verify          # typecheck + lint + all tests — run this before committing
npm test                # all 352 tests
npm run test:unit       # calculations, thresholds, workflow table, money
npm run test:integration # real workflow against the real database
npm run test:security   # authorisation, IDOR, upload validation, admin authority
npm run build           # production build
```

The integration and security suites are the interesting ones. They test what a click-through cannot: what happens when a *different* branch's user opens a case, when a version is stale, when an executable is renamed to `.pdf`. Those combinations are the ones a manual test plan reliably misses.

If `DATABASE_URL` is unset the integration suites skip themselves rather than failing, so the unit and security suites still run anywhere.

---

## 2. Running the application

```bash
npm run dev             # development, http://localhost:3008
# or
npm run build && npm start
```

If the database is empty or you want a clean slate:

```bash
npm run db:migrate      # apply the schema
npm run db:seed         # reference data + development accounts
```

### Signing in

Sign in with an **institutional email**. Every seeded account uses the password in your `.env` under `SEED_DEFAULT_PASSWORD`, and every one is flagged must-change — so the **first sign-in forces a new password**. That is deliberate, and it is the first thing worth confirming works.

| Email | Role | Unit |
|---|---|---|
| `admin@nibbank.example` | System Administrator | Head Office |
| `mexico.po@nibbank.example` | Process Owner | Mexico Branch |
| `bole.po@nibbank.example` | Process Owner | Bole Branch |
| `bahirdar.po@nibbank.example` | Process Owner | Bahir Dar Branch |
| `maker.manager@nibbank.example` | Maker Manager | Head Office |
| `civil.maker@nibbank.example` | Maker (Civil) | Head Office |
| `civil.maker2@nibbank.example` | Maker (Civil) | Head Office |
| `mech.maker@nibbank.example` | Maker (Mechanical) | Head Office |
| `checker.manager@nibbank.example` | Checker Manager | Head Office |
| `civil.checker@nibbank.example` | Checker (Civil) | Head Office |
| `mech.checker@nibbank.example` | Checker (Mechanical) | Head Office |
| `director@nibbank.example` | Director | Head Office |
| `dual.manager@nibbank.example` | Maker Manager + Checker Manager | Head Office |

Use a different browser profile (or a private window) per role — it is much easier than signing in and out repeatedly.

---

## 3. The end-to-end walkthrough

This is the path that proves the system works. Each step names what to look for.

### Step 1 — Raise a request (`mexico.po@nibbank.example`)

**Valuation → New Request.** Fill in applicant and owner, choose *New* and *Civil*, create.

*Look for:* the case gets a number like `PV-2026-000001` automatically. You never chose a branch, a department or a status — those are set server-side. Try selecting *Re-Estimation*: an "earlier case number" field appears and is required.

### Step 2 — Attach documents (same user)

On the case page, drag a PDF into **Supporting documents** under *Land Holding Certificate*, then another under *Request letter*.

*Look for:* the amber banner listing what is still required disappears as you satisfy it. Now try renaming any `.exe` to `.pdf` and uploading it — it is refused with *"does not contain valid PDF document data. Renaming a file does not change its type."* The check is the file's own bytes, not its name.

### Step 3 — Submit (same user)

Press **Submit to department**.

*Look for:* status becomes `REQUESTED`, the timeline gains its first entry, and an SLA due date appears. If you had skipped a mandatory document, submission would have been refused.

### Step 4 — Assign a valuator (`maker.manager@nibbank.example`)

**My Tasks** shows *Assign a valuator*. Open the case and press **Assign valuator**.

*Look for:* the dropdown offers only civil valuators, and **not yourself** — assignment and valuation are separate duties. Assign to *Abel Tesfaye*.

### Step 5 — Work the case (`civil.maker@nibbank.example`)

**My Tasks** now shows *Perform the valuation*. Open it, press **Start valuation**.

*Look for:* you get **Submit for checking**, **Mark not visited**, **Mark pending** — and nothing else. Try *Mark pending* with a two-word remark: refused, because a remark too short to act on is worthless to whoever reads it next.

### Step 6 — Confirm the boundaries

Sign in as `bole.po@nibbank.example` and paste the Mexico case URL.

*Look for:* **404, not 403.** A different branch cannot even learn the case exists. Same for its documents.

---

## 4. Negative checks worth doing

These are quick, and each one is a control the bank is relying on.

| Try this | Expected |
|---|---|
| Open two browser tabs on one case, act in both | The second is refused: *"This case has changed since you opened it."* |
| Sign in with a wrong password 5 times | The account locks, and the message never changes — it never confirms the account exists |
| Sign in as `civil.maker` and open `/admin/users` | A plain "you do not have access" page naming the permission required, not a crash |
| Upload a `.zip` or `.docm` | Refused outright — archives hide their contents from the scanner |
| As an administrator, open **Audit Log** | Every login, upload, download and transition, with before/after values |
| Ask an administrator to approve a case they valued themselves | Refused — the segregation-of-duties veto survives even full admin authority |

---

## 5. Resetting

```bash
npm run db:seed         # re-applies reference data and resets development passwords
npm run db:reset        # drops and rebuilds everything (destroys all case data)
```

If an account locks itself during testing, `npm run db:seed` clears the lock along with the password.

---

## 6. What cannot be checked yet

Being explicit, so nothing looks broken when it is merely absent:

- **Civil and Mechanical property registration** — the detailed property, building, vehicle and machinery forms are not built. The case exists and moves through the workflow, but there is nowhere yet to record the property itself.
- **Valuation calculation** — the depreciation engine is written and unit-tested, but there is no calculation screen, so `Submit for checking` will refuse with *"the valuation calculation is not complete"*. That guard is working correctly; the screen it depends on arrives in Phase 3.
- **Checking, approval, signing, reports, notifications** — Phases 4 to 7.

The workflow engine already understands all of these stages; what is missing is the screens that feed it.
