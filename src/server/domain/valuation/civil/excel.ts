/**
 * The few spreadsheet behaviours the guideline's formulas depend on, written
 * once so every lookup in the civil engine compares text the way the Excel
 * workbook does.
 */

/** Text as Excel's `=` and exact-match lookups see it: trimmed, spaces collapsed, case ignored. */
export function excelKey(text: string | null | undefined): string {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function excelEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  return excelKey(a) === excelKey(b);
}

export function excelIncludes(list: readonly string[], value: string | null | undefined): boolean {
  const key = excelKey(value);
  return list.some((item) => excelKey(item) === key);
}

/** The entry of a name-keyed table whose name equals `name` as Excel compares text. */
export function excelLookup<T>(
  table: Readonly<Record<string, T>>,
  name: string,
): { name: string; value: T } | null {
  const key = excelKey(name);
  for (const [entry, value] of Object.entries(table)) {
    if (excelKey(entry) === key) return { name: entry, value };
  }
  return null;
}

/**
 * `MATCH(value, list)` with no match type: Excel's approximate match, a binary
 * search for the last item not greater than `value`, which stops as soon as a
 * probe equals it. On a list that is not sorted the answer is wherever the
 * search lands - which is the behaviour the neighbourhood factor depends on
 * (CALCULATION_SPEC issue 1). Checked against Excel itself for every city
 * class (scripts/guideline/excel). Returns the zero-based position, or -1 when
 * every probe was greater.
 */
export function approximateMatch(list: readonly string[], value: string): number {
  const target = excelKey(value);
  let low = 0;
  let high = list.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const probe = excelKey(list[middle]);
    if (probe === target) return middle;
    if (probe < target) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * The workbook's `PtInPoly` VBA function, ported line for line: ray casting
 * with x = latitude and y = longitude, refusing a polygon whose last point does
 * not repeat its first. Geometry, not money, so it works in the same IEEE
 * doubles the VBA did.
 */
export function pointInPolygon(
  latitude: number,
  longitude: number,
  points: readonly (readonly [number, number])[],
): boolean | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return null;
  let crossings = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[i + 1]!;
    if (x1 > latitude !== x2 > latitude) {
      const slope = (y2 - y1) / (x2 - x1);
      const intercept = (y1 * x2 - x1 * y2) / (x2 - x1);
      if (slope * latitude + intercept > longitude) crossings++;
    }
  }
  return crossings % 2 === 1;
}
