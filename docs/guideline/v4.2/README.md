# NIB Valuation System: developer package

Extracted from `Version_4.2_Estimation_template_Golla_Bee_Production_PLC.xlsm`. You can use it instead of the Excel file.

| File | What it is |
|---|---|
| DEVELOPER_PROMPT.md | Prompt to paste into the AI coding tool. Upload this whole folder (or the zip) with it. |
| CALCULATION_SPEC.md | Every calculation rule in plain formulas, with Excel cell references, plus 14 issues found in the Excel. |
| golden_case_golla_bee.json | One real case: all inputs plus the Excel's intermediate and final values (test case #1). |
| reference_tables/*.csv | All rate and lookup tables, at full precision. |
| reference_tables/location_polygons.json | 306 location zones (city, grade, class, max rate, polygon). |
| reference_engine/*.py | Python scripts that reproduce the golden case exactly. |
| excel_formulas/*.txt | Raw formula dumps for each sheet. Repeated formulas appear once. |

Check the reference engine (Python 3, no libraries needed):
    cd reference_engine
    python building_cost.py ../golden_case_golla_bee.json ../reference_tables/cost_summery.csv
    python location_value.py ../golden_case_golla_bee.json ../reference_tables
Both scripts should print "PARITY OK".

Notes
* Rows 1-2 of the coordinate-list CSVs contain status text that the Excel computed for the Golla Bee case. Use location_polygons.json for the polygons.
* The swimming pool BOQ (Swimming_pool.csv) gives one pool total per column in row 27, and plot civil works pick it up.
* Before the system goes live, have a senior valuator review the issues listed in CALCULATION_SPEC.md §11.
