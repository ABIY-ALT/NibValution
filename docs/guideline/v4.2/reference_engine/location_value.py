"""
Reference implementation of the LOCATION VALUE part of the NIB template:
 'LHR with coordinate', 'LHR without coordinate', 'Location Parameters',
 'COST APPROACH FOR COMPLETED' rows 404-420 and 'REPORT-COMPLETED' K124.
Run: python location_value.py ../golden_case_golla_bee.json ../reference_tables
"""
import csv, json, sys

def ptinpoly(x, y, poly):
    """Exact port of the VBA UDF PtInPoly (ray casting). x = latitude, y = longitude."""
    if not poly or poly[0] != poly[-1]:
        return None                                             # '#UnclosedPolygon!'
    crossed = 0
    for i in range(len(poly) - 1):
        (x1, y1), (x2, y2) = poly[i], poly[i + 1]
        if (x1 > x) != (x2 > x):
            m = (y2 - y1) / (x2 - x1)
            b = (y1 * x2 - x1 * y2) / (x2 - x1)
            if m * x + b > y:
                crossed += 1
    return crossed % 2 == 1

def property_class(purpose):
    p = purpose.strip().upper()
    if p == "RESIDENTIAL": return "Residential"
    if p in ("COMMERCIAL", "SHOP", "HOTEL"): return "Commercial"
    return "Industrial"

def find_polygon(polys, city, purpose, lat, lon):
    cls = property_class(purpose)
    src = "addis_ababa" if city.strip().lower() == "addis ababa" else "outline"
    for p in polys:                                             # first match wins, like MATCH(...,0)
        if p["source"] == src and p["city"].lower() == city.strip().lower() \
           and p["property_class"] == cls and ptinpoly(lat, lon, p["polygon_lat_lon"]):
            return p
    return None

COMMERCIAL_GRADE_FACTOR = {"COMMERCIAL-Prime 1-B": 1.21, "COMMERCIAL-Prime 2-A": 1.28, "COMMERCIAL-Prime 2-B": 1.35,
                           "COMMERCIAL-Prime 2-C": 1.35, "COMMERCIAL-Middle - A": 1.19, "COMMERCIAL-Middle - B": 1.17,
                           "COMMERCIAL-Middle - C": 1.305}

def max_rate_with_coordinate(poly, purpose):            # 'LHR with coordinate'!B11
    if not poly: return 0
    r = poly["max_location_rate"]
    if purpose.upper() in ("SCHOOL", "HOSPITAL", "RESORT"): r *= 1.5
    label = f'{property_class(purpose).upper()}-{poly["grade"]}'
    return r * COMMERCIAL_GRADE_FACTOR.get(label, 1)

def tiered_average_rate(lhr_rows, city, purpose, plot, max_rate):
    """'LHR without coordinate'!B11 (C12..C18): progressive reduction of the max rate by plot-size tiers."""
    g = lambda r, c: lhr_rows[r-1][c-1] if r-1 < len(lhr_rows) and c-1 < len(lhr_rows[r-1]) else ""
    cls = {"Residential": 0, "Commercial": 1}.get(property_class(purpose), 2)
    if city.strip().lower() == "addis ababa": thr_row, fac_row = 8 + cls, 11 + cls     # J8.. / K11..
    else:                                     thr_row, fac_row = 1 + cls, 4 + cls      # J1.. / K4..
    def nums(row, start):
        out = []
        for c in range(start, 40):
            try: out.append(float(g(row, c)))
            except (ValueError, TypeError): break
        return out
    thr = nums(thr_row, 10)                  # thresholds from column J
    fac = nums(fac_row, 11)                  # factors from column K (factor of the 2nd tier onward)
    # first tier [0, J] at 100%, tier (thr[i-1], thr[i]] at fac[i-1], above the last threshold at fac[len(thr)-1]
    total, prev = 0.0, 0.0
    for i, t in enumerate(thr):
        f = 1.0 if i == 0 else fac[i - 1]
        if plot <= t:
            return (total + (plot - prev) * max_rate * f) / plot
        total += (t - prev) * max_rate * f; prev = t
    return (total + (plot - prev) * max_rate * fac[len(thr) - 1]) / plot
    # NOTE: Excel's Addis formula has a quirk above 30,000 m2 (double-counts the last tier) - see spec.


def lease_location_value(area, L, T, R, A, Pd):
    """Excel H413/H416 lease branch. L = location rate per m2 after all factors."""
    if T < R or Pd > A: return None
    X = area * L - (A - Pd)
    part1 = (X * R / T if X * R / T >= A else Pd * R / T) * (1 - R / T)
    Y = area * L - (A - Pd) / (1.07 ** R)
    part2 = (Pd if Y <= Pd else Y) * R / T
    return part1 + part2

def location_value(right_type, plot, L, lease):
    R = lease.get("remaining_lease_period") or 0
    if right_type.startswith("FREE/OLD") or R >= 20:
        return plot * L
    if right_type == "LEASE(ሊዝ)":
        return lease_location_value(plot, L, lease["total_lease_period"], R,
                                    lease["total_lease_amount"], lease["paid_up_lease_amount"])
    return (lease.get("freehold_part_of_plot") or 0) * L        # BOTH: free part here, lease part = H416

def report_staged_location_value(building_value, LV):
    """REPORT-COMPLETED K124 (before the Addis prime multipliers)."""
    v3 = building_value * 3
    if v3 <= 0.3 * LV: return 0.5 * LV
    if v3 < 0.8 * LV:  return 0.5 * LV + (v3 / LV - 0.3) * LV
    return LV

if __name__ == "__main__":
    case = json.load(open(sys.argv[1])); d = sys.argv[2]; g = case["general"]
    polys = json.load(open(f"{d}/location_polygons.json"))
    lhr = list(csv.reader(open(f"{d}/LHR_without_coordinate.csv", encoding="utf-8-sig")))
    poly = find_polygon(polys, g["city"], g["permitted_land_purpose"], g["latitude"], g["longitude"])
    print("polygon:", poly and (poly["city"], poly["grade"], poly["property_class"], poly["max_location_rate"]))
    mx = max_rate_with_coordinate(poly, g["permitted_land_purpose"])
    avg = tiered_average_rate(lhr, g["city"], g["permitted_land_purpose"], g["plot_area_m2"], mx)
    factors = 1.0
    for k, v in case["location_ratings"].items(): factors *= float(v["excel_factor"])   # G404..G411
    L = avg * factors
    LV = location_value(g["land_holding_right_type"], g["plot_area_m2"], L, case["lease"])
    exp = case["expected_results"]
    print(f"average rate {avg:,.4f} (excel {exp['lhr_average_rate_after_area_tiers']:,.4f})")
    print(f"location value {LV:,.2f} (excel {exp['location_value_H413']:,.2f})")
    ok = abs(avg - exp["lhr_average_rate_after_area_tiers"]) < 1e-6 and abs(LV - exp["location_value_H413"]) < 0.01
    print("PARITY OK" if ok else "MISMATCH")
