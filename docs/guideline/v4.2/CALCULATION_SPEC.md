# NIB Property Valuation — Calculation Specification

Source: `Version_4.2_Estimation_template` (PV Guideline approved 23 Apr 2025, template updated Aug 2026).
Everything below was extracted from the workbook's formulas and VBA, and the two core parts
(building cost and location value) were re-implemented in `reference_engine/` and reproduce the
Golla Bee Production PLC case **to the cent** (final value 37,588,956.55 Birr).

Notation: sheet!cell references are given so a developer can check any rule against the Excel.

---

## 0. Big picture

```
FINAL VALUE = w_cost × COST_APPROACH_VALUE + w_sale × SALE_VALUE

COST_APPROACH_VALUE = (Σ buildings DRC + plot civil works [+ gas station / coffee items]) × MCF
                      + STAGED LOCATION VALUE × Addis-prime multiplier

FORCED-SALE VALUE   = FINAL VALUE × foreclosure %      (only on foreclosure reports)
```

| Step | What | Excel location |
|---|---|---|
| 1 | Inputs | HOME, plus input cells inside the cost sheets (see §1) |
| 2 | Replacement cost per building | COST APPROACH FOR COMPLETED rows 10–233 |
| 3 | Plot civil works, gas station, coffee site | rows 333–393 |
| 4 | Market condition factor (MCF) | F395–F396 |
| 5 | Location value (land) | LHR sheets, Location Parameters, H413–H419 |
| 6 | Report-level adjustments, sale approach, reconciliation | REPORT-COMPLETED K79–K141, SALE APPROACH |
| 7 | Work in progress variant | COST APPROACH FOR PROGRESS, REPORT-PROGRESS |

---

## 1. Inputs (what the new system's forms must capture)

### 1.1 General (HOME)
| Field | Cell | Allowed values / notes |
|---|---|---|
| Valuator name | E4 | |
| Valuation date | E6 | date |
| Requesting organ / branch | E8 | |
| Property owner | E10 | |
| Applicant | E12 | |
| LHC (title deed) number | E14 | |
| Land holding right type | E16 | `FREE/OLD(ነባር)`, `LEASE(ሊዝ)`, `BOTH FREE/OLD(ነባር) & LEASE(ሊዝ)` |
| Plot area m² | E18 | number > 0 |
| Permitted land purpose | E20 | RESIDENTIAL, COMMERCIAL, MIXED USE, SHOP, HOTEL, RESORT, INDUSTRIAL, SCHOOL, HOSPITAL, COFFEE SITE, GAS STATION (columns of MCF table) |
| Property/building type | E22 | e.g. Residential Building, Condominium, Apartment, Multipurpose halls & Warehouses, Commercial Building … |
| Floor level | E23 | only when E22 = Condominium or Apartment |
| City/Town | E26 | must exist in `Location Parameters` col L (≈330 towns) |
| Latitude, Longitude | E27, F27 | decimal degrees (lat ≈ 3–15, lon ≈ 33–48) |
| Sub-city, Wereda/Kebele, House no., Landmark | E28–E31 | text |
| Estimation type | REPORT E65 | New / RE-ESTIMATION / FORECLOSURE (+ previous estimation date I65) |

### 1.2 Buildings (HOME H6:P45, up to 40 rows)
| Field | Column | Notes |
|---|---|---|
| Building no. | H | "Building 1" … "Building 40" (key used everywhere) |
| Building name | I | free text |
| Building type | J | Villa, MPH above 4m, MPH below 4m, Factory, Apartment, Condominium, 2-5 Storey, 6-10 Storey, 11 storey & above |
| No. of identical buildings (K) | K | |
| Built-up area for one bldg (L) | L | m² |
| Total floor area for one bldg (M) | M | m² |
| Built-up area all bldgs | N = K×L | calculated |
| Total floor area all bldgs | O = K×M | calculated |
| Height (P) | P | m; required for MPH above 4m and Factory |

### 1.3 Per-building inputs typed in the cost sheet (must become form fields)
* **Component shares** (`C10:C200` per building column block; block for building k starts at column B+3(k-1)).
  For each building-component row, the valuator types a share 0–1 (e.g. HCB walls 0.3 + EGA sheet 0.7).
  In the PROGRESS sheet the same column means **% completed**.
* **Condition / defect percentages** (`C237:C269`) → depreciation.
* **New building component items** (rows 273–312: item, description, building no., unit price) — extra rate per m² added to that building.
* **Supplementary works on a building** (rows 315–330: item, building no.; quantity typed in rows 213–222 of that building's block).

### 1.4 Site inputs typed in the cost sheet
* **Plot civil works** rows 333–348: item (from `Internal or Plot Civil Works` list), description, quantity.
* **Gas station items** rows 354–369; **Coffee site items** rows 375–390: item + quantity.
* **Location ratings** E404–E409 (dropdown text, see §5.4).
* **Lease data** D416 (free-hold part of plot, for BOTH), D417 paid-up lease amount, D418 total lease amount, D419 total lease period (yrs), D420 remaining lease period (yrs).
  ⚠ In the sample file D417/D418 are typed as arithmetic (`=210000*0.1+5*4725+…`). The system should store the final numbers (optionally with a breakdown note).

---

## 2. Building replacement cost (per building)

All references are for building 1 (columns B/C/D); other buildings repeat 3 columns to the right.

### 2.1 Unit rate curve (`cost summery` rows 1–5)
`cost summery` row 5 holds the building-type headers; each type has a 4-column block
`[label, a, b, c]`. Rows 1–4 are the grade rows:

| Row | Grade |
|---|---|
| 1 | minimum (anything not listed below, e.g. "Poor") |
| 2 | Good |
| 3 | Excellent |
| 4 | Luxury |

```
rate(grade, A) = a·A² + b·A + c          (a, b, c from the grade row of that building type)
A = M × P   if type = "MPH above 4m"     (volume)
A = M       otherwise                     (total floor area of ONE building)
```

### 2.2 Component cost per m² (D10:D200)
Cost-sheet row r ↔ `cost summery` row r−4 (same type block).
For each component the table gives: name (col +0), grade (col +1), weight % (col +3).
```
component_cost = rate(component_grade, A) × weight × share
```

### 2.3 New-component items (rows 202–211, from rows 273–312)
`unit_price × C` for items assigned to that building; added to the same sum as 2.2.

### 2.4 Area/volume rate and depreciation
```
area_rate      = Σ component_cost (rows 10..211) × (1.2 if city ≠ "Addis Ababa" else 1.0)     D223
depreciation   = Σ defect_rate × defect_percentage                                             D224 (=D270)
dep_rate       = area_rate × (1 − depreciation)                                                D225
```
Defect rates: `cost summery` AQ6:AT39, column chosen by category:
"Multi-Story Building" if type in {G+1 & 2, G+3 & 4, G+5 & 6, G+7 & 8, G+9 & 10, G+11 & Above},
"MPH" if type in {MPH below 4m, MPH above 4m}, otherwise "Villa". (See issue #3.)

### 2.5 Depreciated replacement cost (DRC)
```
big = type in {"MPH above 4m", "Factory"}
area_one = M × 4 if big else M                                  D226
area_all = O × 4 if big else O          (O = K × M)             D227
height_adj(x) = x + (P − 4) × 0.2 × x   if big else x
DRC_one = height_adj(dep_rate × area_one)                       D228
DRC_all = height_adj(dep_rate × area_all)                       D230
supplementary = Σ supplementary_rate × qty   (rate = 'Supplementary Works' col D)   D213:D222
DRC_building = DRC_all + supplementary                           D231
DRC_all_buildings = Σ DRC_building                               D233
```
Golden check (Factory Building, MPH above 4m, 867.2 m² × 6 m): area_rate 4,762.48 → DRC 23,353,646.04 ✔.

---

## 3. Site works

### 3.1 Plot civil works (F333:F348)
```
amount = rate × qty                        rate = VLOOKUP(item, 'Internal or Plot Civil Works' A:B)
amount = rate (lump sum, qty ignored)      if item is in 'Internal or Plot Civil Works' A148:A151 or A206:A208
amount = 'Swimming pool'!<col>27           if item is in 'Swimming pool' A43:A72 (pool BOQ sub-sheet, one column per row slot)
civil_total = Σ amount                                         F349
DRC_plus_civil = DRC_all_buildings + civil_total               F351
```

### 3.2 Gas station / coffee site
```
gas_amount    = rate('Fuel Stations and Coffee Wash' A2:B15)  × qty      F354:F369
coffee_amount = rate('Fuel Stations and Coffee Wash' A16:B51) × qty      F375:F390
gas_total_base    = Σ gas_amount    + F351                               F372 (only if any item)
coffee_total_base = Σ coffee_amount + F351                               F393 (only if any item)
```

---

## 4. Market condition factor (MCF)
```
MCF = 'MCF & Location Coefficents'[row = city, column = land purpose]       F395
DRC_after_MCF = MCF × coffee_total_base   if purpose = "Coffee Site"
              = MCF × gas_total_base      if purpose = "Gas Station"
              = MCF × DRC_plus_civil      otherwise                          F396
```

---

## 5. Location value (land)

### 5.1 Maximum location rate — with coordinates (`LHR with coordinate`)
1. Property class: RESIDENTIAL → Residential; COMMERCIAL/SHOP/HOTEL → Commercial; anything else → Industrial.
2. Polygon list: Addis Ababa → `ADDIS ABABA COORDINATE LIST`; other towns → `OUTLINE COORDINATE LIST`
   (exported as `reference_tables/location_polygons.json`: city, grade, class, max rate, polygon).
3. First polygon where city matches, class matches and **point-in-polygon** is true
   (VBA `PtInPoly`, ray casting with x = latitude, y = longitude; polygon must be closed).
4. `max_rate = polygon.max_location_rate`
   × 1.5 if purpose ∈ {SCHOOL, HOSPITAL, RESORT}
   × commercial-grade factor: COMMERCIAL-Prime 1-B 1.21, Prime 2-A 1.28, Prime 2-B 1.35, Prime 2-C 1.35,
     Middle-A 1.19, Middle-B 1.17, Middle-C 1.305, else 1.                         (B11)

### 5.2 Maximum location rate — without coordinates (`LHR without coordinate` B10)
Used only when no polygon matched (with-coordinate rate = 0):
`base = city table (F:H, rows per city for R / C / I) × multiplier` where multiplier is
* Coffee site: 1.25 for Addis & surrounding towns*, else 1.5625
* Gas station: 1.5
* School/Hospital/Resort: 1.5 (Addis & surrounding*), 1.875 (22 regional cities**), else 1.725
* Addis Ababa + COMMERCIAL: 1.305
* Addis & surrounding*: 1; regional cities**: 1.25
* Industrial elsewhere: 1.64 if plot < 1,000 m² (non-Addis) else 1.25; anything else 1.15

\* Addis Ababa, Legetafo, Alemegena, Sebeta, Gelan, Burayu, Anfo, Ashewa Meda, Furi, Keta (Sansussi), Tatek, Weletie, Woybila Mariam, Dukem, Bishoftu, Koye Fechie, Tulu Dimtu
\** Mekelle, Gonder, Bahir Dar, Adama, Hawassa, Jimma, Hossaena, Debre Birhan, Dire Dawa, Dessie, Wolkite, Shashemene, Harar, Jigjiga, Arba Minch, Wollayta Sodo, Kombolcha, Adigrat, Shire Endasilassie, Debre Markos, Nekemte, Woldiya

### 5.3 Plot-size tiers → average rate (`LHR without coordinate` B11, C12:C18)
The max rate is reduced progressively for bigger plots (like tax brackets):
```
tier 1: [0, t1]            × 1.00
tier i: (t(i-1), t(i)]     × f(i)
above last threshold       × f(last)
average_rate = Σ(tier_area × max_rate × factor) / plot_area
```
Tables (row = class R/C/I): non-Addis thresholds rows 1–3 cols J–R, factors rows 4–6 cols K–S;
Addis thresholds rows 8–10 cols J–AD, factors rows 11–13 cols K–AE.
Golden: Furi industrial 2,201.6 m², max 9,000 → (500×9000 + 500×9000×0.58 + 1,201.6×9000×0.5)/2,201.6 = **5,685.50** ✔.

### 5.4 Location parameter factors (G404–G411)
City → class via `Location Parameters` L:O
(col N: Addis Ababa / Sheger City / Outline Cities; col O: Addis Ababa / Sheger City / Outline City (G1) / Outline City (G2) / Outline Cities (G3,G4,G5)).

| Factor | Choices | Table (Location Parameters) | Class column used |
|---|---|---|---|
| Utility | Excellent (Available) / Very Good (Partially) / Good (On progress) / No Utility | Res rows 61–65, Com 68–72, Ind 75–79 | O |
| Neighborhood | Excellent / Very Good / Good / Normal | Res 82–86, Com 89–93, Ind 96–100 | O (⚠ issue #1) |
| Road quality | Stable Asphalt … Dry Weather Road | rows 2–4 | N |
| Road width | ≥15m / 10–14m / 6–9m / ≤5m | rows 8–10 | N |
| Proximity to centre | Excellent … Outside the city | Res 40–44, Com 47–51, Ind 54–58 | O |
| Accessibility | Within 100m … Beyond 500m | rows 14–16 | N |
| Built-up area ratio BAR = Σ built-up area / plot | thresholds C18:F18 (0.12/0.24/0.42/0.60) | Res & Com-villa rows 18–23, Com 25–30, Ind 32–37 | O (⚠ issue #2) |
| Floor level (condo/apartment only) | FL ≤ 6 → 1 − 0.025×FL, else 0.85; others 1 | formula | — |

```
L = average_rate × utility × neighborhood × road_quality × road_width × proximity × accessibility × BAR × floor
```
Golden: 0.9 × 0.8175 × 0.96 × 1 × 0.9626 × 0.8 × 0.95 × 1 = 0.51673; L = 2,937.85 Birr/m².

### 5.5 Freehold / lease (H413, H416)
P = plot area, T = total lease period, R = remaining period, A = total lease amount, Pd = paid-up amount.
```
if right_type = FREE/OLD  or  R ≥ 20:     LV = P × L
elif right_type = LEASE:
    invalid if T < R or Pd > A
    X = P×L − (A − Pd)
    part1 = (X×R/T if X×R/T ≥ A else Pd×R/T) × (1 − R/T)
    Y = P×L − (A − Pd) / 1.07^R             (7% discount rate, hard-coded)
    part2 = (Pd if Y ≤ Pd else Y) × R/T
    LV = part1 + part2
elif BOTH:
    LV_free  = free_area × L                                         (H413)
    LV_lease = same lease formula with P := P − free_area, only if R < 25   (H416)
```
Golden: LEASE, R = 22 ≥ 20 → LV = 2,201.6 × 2,937.85 = **6,467,972.20** ✔.

### 5.6 Staged location value (REPORT-COMPLETED K124)
V = Σ building DRC (report K79:K118) + civil works (K120); LV = H413 + H416.
```
if 3V ≤ 0.3·LV:   LVs = 0.5·LV
elif 3V < 0.8·LV: LVs = 0.5·LV + (3V/LV − 0.3)·LV
else:             LVs = LV
LVs × Addis-prime multiplier (Addis Ababa, not Apartment/Condominium):
   COMMERCIAL-Prime 1-A 1.509, RESIDENTIAL-Prime 1-A 1.53, COMMERCIAL-Prime 1-B 1.26,
   RESIDENTIAL-Prime 2-A 1.54, COMMERCIAL-Prime 2-A 1.25, RESIDENTIAL-Prime 2-B 1.55,
   COMMERCIAL-Prime 2-B 1.24, RESIDENTIAL-Prime 2-C 1.57, COMMERCIAL-Prime 2-C 1.24, else 1
```
The same multiplier is shown on the land-rate line E46 (and 90/80/70/60 % columns F46:I46).

---

## 6. Sale approach (`SALE APPROACH`)
Applies only if city = Addis Ababa, purpose = RESIDENTIAL, E22 ∈ {Residential Building, Condominium, Apartment}
and **no** building is 6-10 Storey, 11 storey & above, MPH (either), or Factory. Otherwise sale value = 0.

Variables: PA = plot area, TFA = Σ total floor area, CR = DRC_plus_civil / TFA,
LVR = (H419 − F396) / PA, TBA = Σ built-up area (or FL = floor level for condo/apartment).
```
Residential Building: SV = −23,468,801.76 + 37,621.33·PA + 58,264.56·TBA + 66,697.66·TFA + 407.90·CR + 254.21·LVR
Condominium:          SV = −6,099,230.121394 + 92,282.265873·TFA + 45.019568·CR + 115.325464·LVR − 32,756.23454·FL
                      if TFA < 25 and SV < 3,000,000:  SV = TFA × (CR + LVR) × 1.75
Apartment:            (condominium formula, same small-unit rule) × 1.25
```
(Condominium/Apartment only when HOME!J6 equals E22.)

## 7. Reconciliation (REPORT-COMPLETED H137:K139)
```
CV = cost approach value (K125) = (Σ DRC + civil) × MCF + LVs
SV = sale value (K134)
if SV = 0:          w_cost = 1,   w_sale = 0
elif SV < CV:       w_cost = 0,   w_sale = 1        (as written in Excel)
elif condo/apartment: 0.75 / 0.25
elif location grade is Prime 1-A/1-B/2-A/2-B/2-C: 0.60 / 0.40
else:               0.75 / 0.25
FINAL = w_cost × CV + w_sale × SV                 (K139)
```

## 8. Forced-sale (foreclosure) value (REPORT H141)
Shown when the report is a foreclosure estimation:
`forced = FINAL × pct`, pct = FORECLOSURE table by city (0.80 Addis & surrounding, 0.75 regional)
only for RESIDENTIAL/COMMERCIAL/SHOP; otherwise (and for unlisted cities) 0.70.

## 9. Work-in-progress (COST APPROACH FOR PROGRESS / REPORT-PROGRESS)
Same structure as completed, with these differences:
* Column C = % completed per component (instead of share).
* Civil works amount = completed amount × % completed (F311); gas/coffee amounts × % completed.
* Report: per building F = value at completion (from COMPLETED sheet), H = value at current stage, % = H/F;
  K122 = overall completion %.
* Location value (K125): Apartment → LV × (0.9 if completion < 80% else 1);
  others: H122 ≤ 0.3·LV → 0.5·LV; H122 < 0.8·LV → H122 + 0.2·LV; else LV; then × (0.9 if completion < 80%) × Addis-prime multiplier.
  (⚠ differs from the completed-report rule, issue #8.)
* Value at current stage K130 = H122 × MCF + location value; value at completion = REPORT-COMPLETED K139.
* Sale value at current stage = sale value × completion %; weights 0.75/0.25 for Apartment/Residential Building.
* Forced value = pct × value at current stage.

---

## 10. Golden test case — Golla Bee Production PLC (`golden_case_golla_bee.json`)
| Quantity | Excel value |
|---|---|
| Location polygon | Furi / Industrial / Prime, max rate 9,000 |
| Average land rate after tiers | 5,685.501453488372 |
| DRC all buildings | 30,947,060.033075884 |
| Plot civil works | 3,631,811.4625 |
| DRC + civil works | 34,578,871.49557588 |
| MCF (Furi, INDUSTRIAL) | 0.9 |
| After MCF | 31,120,984.346018296 |
| Location value | 6,467,972.204277504 |
| **Final value (K139)** | **37,588,956.55029579** |

`reference_engine/building_cost.py` and `reference_engine/location_value.py` reproduce these numbers exactly.

---

## 11. Issues found in the Excel (decide before go-live)
Parity first: the new engine should reproduce Excel by default, with each fix behind a switch
until the valuation unit approves it.

1. **Neighborhood factor lookup bug** (G405): `MATCH(…, A89:A93)` has no `0` (approximate match) and uses the
   commercial label range for every class. Golla Bee got 0.8175 (Outline G3–5 row) instead of 0.9195 (Sheger City row);
   correct value would raise the land value by ≈ 807,000 Birr.
2. **Industrial BAR thresholds**: industrial rows are labelled <7%, <14%, <25%, ≤35%, but the formula uses the
   residential thresholds 12/24/42/60%. Golla Bee BAR 47.8% → factor 0.95; with industrial thresholds it would be 1.0.
3. **Depreciation category**: mapping checks names "G+1 & 2"…"G+11 & Above", which are not building types any more
   (types are 2-5 Storey, 6-10 Storey…), so multi-storey buildings use the *Villa* defect rates.
4. **BOTH free & lease**: when remaining period is 20–24 years, H413 values the whole plot as free-hold *and* H416 adds
   the lease part again → double counting.
5. **Addis tier formula > 30,000 m²**: last branch adds the final tier twice; one branch repeats the S8 test.
6. **Condominium small-unit rule**: note on sheet says "< 40 m² and < 2,500,000 → max(calc, TFA × 85,000)", formula does
   "< 25 m² and < 3,000,000 → TFA × (CR+LVR) × 1.75".
7. **Sale-approach exclusion text** in H11 contains a broken string ("11A⏎Storey & Above").
8. **Staged location value** differs between completed report (3×V rule) and progress report (V + 0.2·LV rule).
9. **Reconciliation**: when sale value < cost value the cost approach gets weight 0 (sale only) — confirm intent.
10. **Commercial prime factors** may apply twice (LHR B11 ×1.21… and report K124 ×1.26…) for Addis commercial primes.
11. **City spelling**: "Alemegena" (LHR list) vs "Alemgena" (MCF/FORECLOSURE) — use one city master table with IDs.
12. MPH above 4m / Factory: area ×4 then +20% per metre above 4 m — confirm intended formula with the guideline.
13. Broken named ranges (#REF!) and hundreds of junk names; password stored in a hidden sheet.
14. Five polygons in the coordinate lists are not closed (`closed: false` in `location_polygons.json`) — they can never match.
