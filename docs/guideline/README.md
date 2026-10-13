# Civil valuation without the Excel template

The system calculates civil valuations the way the bank's estimation template
(`Version_4.2_Estimation_template`) does. The template's rates, factors and lists
are held in the system as the `guideline.*` valuation parameters, and the engine
reproduces the template's formulas. Valuators enter the same inputs in the
valuation workspace instead of the workbook.

## How it was proved

- **Every reference table.** The template's hidden sheets were read directly and
  are identical to the guideline tables the system holds.
- **A real estimation.** The Golla Bee Production PLC valuation is reproduced
  figure for figure: 113 figures, from each component rate to the final value of
  ETB 37,588,956.55 (`tests/unit/civil-workbook.test.ts`).
- **Every path, recalculated by Excel itself.** 59 scenarios were typed into a
  fresh copy of the template by Microsoft Excel through automation, recalculated,
  and compared with the engine cell by cell. All 2,950 figures agree. The scenarios
  cover:
  - the sale approach, prime zones, condominiums and apartments
  - every lease rule, land held both ways, and foreclosure
  - defects, new components and supplementary works
  - plot civil works, swimming pools, fuel stations and coffee sites
  - every city class, the Addis Ababa tier formulas, institutional and small
    industrial plots
  - properties under construction

  Excel's figures are kept in `v4.2/excel_scenarios.json` and checked on every
  test run (`tests/unit/civil-excel-scenarios.test.ts`).

## Where each workbook input goes

| In the workbook | In the system |
|---|---|
| HOME: owner, applicant, requesting organ, valuation type | The case (request form) |
| HOME: LHC number, land holding right, plot area, sub-city, woreda, house number | Valuation workspace, step 1: *Land and property* |
| HOME: latitude and longitude (E27, F27) | Step 1 *Land and property*, or a GPS check-in on the site visit |
| HOME: buildings (name, built-up area, total floor area) | Step 1: one *building* each |
| HOME: city/town, permitted land purpose, property type, floor level | Worksheet: *Property and location* |
| HOME: building type (Villa, MPH above 4m …), number of identical buildings, height | Worksheet: *Buildings*, for each building |
| COST APPROACH: component shares (column C, rows 10-200) | Worksheet: each building's components, as percentages (0.3 → 30) |
| COST APPROACH: condition defects (rows 237-269) | Worksheet: each building's *Condition defects* |
| COST APPROACH: new building components (rows 273-312) | Worksheet: each building's *Components not in the guideline list* |
| COST APPROACH: supplementary works (rows 315-330) | Worksheet: each building's *Supplementary works* |
| COST APPROACH: plot civil works, swimming pools (rows 333-348) | Worksheet: *Site works*; a pool takes its length, width and depth |
| COST APPROACH: gas station and coffee site items | Worksheet: *Site works* |
| COST APPROACH: location ratings (E404-E409) | Worksheet: *Property and location* |
| COST APPROACH: lease terms (D416-D420) | Remaining years in step 1; total period, total and paid-up amounts (and the free-hold part) in the worksheet's *Land* |
| REMARK sheet | Worksheet: *Valuator's remarks*, with the standard remarks to pick from |
| COST APPROACH FOR PROGRESS | Automatic for a building registered as under construction; the worksheet asks how far each component is built |

Everything the workbook computes, the system computes, and the breakdown and the
signed report show each step. That covers the MCF, the location zone, the
plot-size tiers, the location factors, the lease rule, the staged location value,
the sale approach, the reconciliation weights, the forced-sale percentage, and the
land holding rate range.

## Checking a past estimation

To show the system gives the answer a workbook gave:

```bash
npx tsx scripts/guideline/check-workbook.mts "<estimation>.xlsm"
```

It reads what was typed into the workbook, runs the system's engine on it with the
published guideline tables, and lists every figure beside the one Excel saved,
marking any that differ. Completed estimations only.

## Re-running the Excel scenarios

This needs Windows and Microsoft Excel. Excel types the scenarios into a copy of
the template; the template itself is never saved.

```bash
npx tsx scripts/guideline/excel/scenarios.mts build "<template>.xlsm" scenarios.json
powershell -File scripts/guideline/excel/run-scenarios.ps1 -Workbook "<template>.xlsm" -Scenarios scenarios.json -Out results.json
npx tsx scripts/guideline/excel/scenarios.mts compare scenarios.json results.json --record docs/guideline/v4.2/excel_scenarios.json
```

## A new template release

When the valuation unit issues a new template, take the tables from it directly:

```bash
# Does the new template still hold the published tables?
node scripts/guideline/build-tables.mjs v4.2 --from-workbook "<template>.xlsm" --check

# Publish a new version (review CALCULATION_SPEC first if any formula changed)
node scripts/guideline/build-tables.mjs v4.3 --from-workbook "<template>.xlsm" \
  --sql prisma/migrations/<timestamp>_civil_guideline_v4_3/migration.sql
```

A changed table needs a new parameter set version or migration. A changed
formula needs the engine changed, its formula version raised, and the Excel
scenarios re-run on the new template.

## Known issues in the workbook

The engine reproduces the workbook's figures exactly, its slips included.
Each slip can be corrected by a switch in the *Workbook corrections* parameter
(`excel_fixes.switches`), off until the valuation unit approves it. The issues are
listed in `v4.2/CALCULATION_SPEC.md` section 11. These were found while checking
the formulas and recalculating in Excel:

- **Neighbourhood factor (issue 1, confirmed in Excel).** The class lookup lands
  on the right row for Addis Ababa and G1 and G2 towns. Sheger towns take the
  G3-G5 row, and G3-G5 towns take the Addis Ababa row. Switch:
  `neighbourhoodExactMatch`.
- **Addis Ababa land tiers.** The industrial formula prices the fifth and sixth
  plot-size tiers (2,000-3,000 m²) at the fourth tier's factor. The residential and
  commercial formulas go wrong above 25,000 m². Switch: `addisTierFormula`.
- **Swimming pools.** Every pool is priced with the wall and floor finishes named
  on the first row of plot civil works. If that row is not a pool, every pool's
  finishes are priced at nil. Seven pool items also name a finish the pool sheet
  does not list ("((L/W/D)" and "Clinker" / "Clicker"), which Excel prices at nil.
  Switch: `poolOwnFinishes`.
- **Progress sheet defects.** The progress sheet has its own, shorter defect list.
  It cannot record the three floor-finish defects, so a building under
  construction is not depreciated for them. Its "Reinforcement bars visible" entry
  is mislabelled and makes Excel's progress value fail (#N/A). Switch:
  `progressFloorDefects`.
- **Progress sheet supplementary works.** The progress sheet copies supplementary
  work quantities for building 1 only. For buildings 2 onwards Excel counts them
  only if the valuator types them again on that sheet. The system counts them
  without retyping.
- **Town names.** The town lists in the maximum-rate formula spell "Alemegena",
  "Koye Fechie" and "Hossaena", where the city list has "Alemgena", "Koye Feche"
  and "Hossana". Those three towns miss their multiplier. Correcting it takes a
  guideline release with the spelling fixed in `guideline.land_max_rate`.
- **The template expires.** A macro quits Excel without saving, a minute after
  the workbook is opened, on any date after 14 February 2027.
