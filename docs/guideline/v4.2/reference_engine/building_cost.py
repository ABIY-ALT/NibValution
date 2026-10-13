"""
Reference implementation of the BUILDING COST part of the NIB valuation template
(sheet 'COST APPROACH FOR COMPLETED', rows 10-233), reproduced from the Excel formulas.
Purpose: show developers exactly how the Excel calculates, and prove it with the golden case.
Run:  python building_cost.py ../golden_case_golla_bee.json ../reference_tables/cost_summery.csv
"""
import csv, json, sys

GRADE_ROW = {"Luxury": 4, "Excellent": 3, "Good": 2}          # anything else -> row 1 ("minimum")

def load_cost_summary(path):
    rows = list(csv.reader(open(path, encoding="utf-8-sig")))
    cell = lambda r, c: (rows[r-1][c-1] if r-1 < len(rows) and c-1 < len(rows[r-1]) else "")
    return rows, cell

def type_column(cell, building_type):
    """Column (1-based) in row 5 of 'cost summery' whose header equals the building type."""
    for c in range(1, 37):                                   # A..AJ
        if str(cell(5, c)).strip().lower() == building_type.strip().lower():
            return c
    raise KeyError(building_type)

def unit_rate(cell, tcol, grade, area_or_volume):
    """Quadratic rate curve: a*A^2 + b*A + c, coefficients picked by the component grade."""
    g = GRADE_ROW.get(grade, 1)
    a, b, c = (float(cell(g, tcol + k) or 0) for k in (1, 2, 3))
    return a * area_or_volume ** 2 + b * area_or_volume + c

def building_drc(b, cell, city, supplementary_amounts=0.0, depreciation=0.0):
    t = b["type"]; tcol = type_column(cell, t)
    M = float(b["total_floor_area_one"]); P = float(b.get("height_m") or 0); n = float(b["count"])
    A = M * P if t == "MPH above 4m" else M                   # rate driver: volume for MPH above 4m
    rate_sum = 0.0
    for comp in b["components"]:
        cs_row = comp["row"] - 4                               # cost-sheet row r  <->  cost summery row r-4
        grade = cell(cs_row, tcol + 1)
        weight = float(cell(cs_row, tcol + 3) or 0)
        rate_sum += unit_rate(cell, tcol, grade, A) * weight * float(comp["share"])
    area_rate = rate_sum * (1.2 if city.strip().lower() != "addis ababa" else 1.0)   # D223
    dep_rate = area_rate - depreciation * area_rate                                    # D225
    big = t in ("MPH above 4m", "Factory")
    area_one = M * 4 if big else M                                                     # D226
    area_all = M * n * 4 if big else M * n                                             # D227 (O = K*M)
    def with_height(x): return x + (P - 4) * 0.2 * x if big else x                     # D228 / D230
    drc_one = with_height(dep_rate * area_one)
    drc_all = with_height(dep_rate * area_all)
    return {"area_volume_rate": area_rate, "drc_one": drc_one, "drc_all": drc_all,
            "drc_all_with_supp": drc_all + supplementary_amounts}

if __name__ == "__main__":
    case = json.load(open(sys.argv[1])); _, cell = load_cost_summary(sys.argv[2])
    city = case["general"]["city"]; total = 0.0; ok = True
    for b in case["buildings"]:
        supp = sum(float(s["excel_amount"] or 0) for s in b.get("supplementary_quantities", []))
        dep = sum(float(d["excel_depreciation"] or 0) for d in b.get("condition_defects", []))
        r = building_drc(b, cell, city, supp, dep); total += r["drc_all_with_supp"]
        exp = b["excel"]["drc_all_with_supp"]; diff = r["drc_all_with_supp"] - exp
        ok &= abs(diff) < 0.01
        print(f'{b["name"]:<22} {b["type"]:<14} engine={r["drc_all_with_supp"]:>16,.2f}  excel={exp:>16,.2f}  diff={diff:.6f}')
    civil = sum(float(x["excel_amount"] or 0) for x in case["plot_civil_works"])
    mcf = case["expected_results"]["market_condition_factor"]
    loc = case["expected_results"]["report_location_value_K124"]
    final = (total + civil) * mcf + loc
    print(f'All buildings DRC  {total:,.2f}  (excel {case["expected_results"]["dep_replacement_cost_all_buildings"]:,.2f})')
    print(f'Final value        {final:,.2f}  (excel {case["expected_results"]["final_reconciled_value_K139"]:,.2f})')
    print("PARITY OK" if ok and abs(final - case["expected_results"]["final_reconciled_value_K139"]) < 0.01 else "MISMATCH")
