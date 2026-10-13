import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dec } from '@/lib/money';
import { tierSegments, tieredAverageRate } from '@/server/domain/valuation/civil/land';
import type { LandTiersTable } from '@/server/domain/valuation/civil/guideline';
import { evaluateFormula, formulasOf } from '../helpers/excel-formula';
import { guidelineTable } from '../helpers/guideline';

/**
 * The plot-size tiers, checked against the workbook itself.
 *
 * Each tier formula in 'LHR without coordinate' is thousands of characters of
 * nested IFs. Rather than trust a reading of them, these tests run the
 * workbook's own formula text over a sweep of plot areas and require the
 * engine to give the same rate - including the three slips in the Addis Ababa
 * formulas, which the engine reproduces until the valuation unit switches the
 * correction on.
 */

const GUIDELINE = join(process.cwd(), 'docs', 'guideline', 'v4.2');
const formulas = formulasOf(
  readFileSync(join(GUIDELINE, 'excel_formulas', 'LHR_without_coordinate.txt'), 'utf8'),
);
const sheet = readFileSync(
  join(GUIDELINE, 'reference_tables', 'LHR_without_coordinate.csv'),
  'utf8',
)
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .map((line) => line.split(','));

function column(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The sheet as the formula sees it, with the plot area and maximum rate under test. */
function cells(plotArea: number, maxRate: number) {
  return (letters: string, row: number): number | string => {
    if (letters === 'B' && row === 8) return plotArea;
    if (letters === 'B' && row === 10) return maxRate;
    const raw = sheet[row - 1]?.[column(letters)] ?? '';
    return raw === '' ? 0 : Number(raw);
  };
}

const tiers = guidelineTable<LandTiersTable>('guideline.land_tiers');
const MAX_RATE = 9000;

const CASES = [
  {
    name: 'other towns, residential',
    cell: 'C12',
    offset: 0,
    table: tiers.other.R,
    variant: 'OTHER',
  },
  {
    name: 'other towns, commercial',
    cell: 'C12',
    offset: 1,
    table: tiers.other.C,
    variant: 'OTHER',
  },
  {
    name: 'other towns, industrial',
    cell: 'C12',
    offset: 2,
    table: tiers.other.I,
    variant: 'OTHER',
  },
  {
    name: 'Addis Ababa, residential',
    cell: 'C16',
    offset: 0,
    table: tiers.addis.R,
    variant: 'ADDIS_RC',
  },
  {
    name: 'Addis Ababa, commercial',
    cell: 'C16',
    offset: 1,
    table: tiers.addis.C,
    variant: 'ADDIS_RC',
  },
  {
    name: 'Addis Ababa, industrial',
    cell: 'C18',
    offset: 0,
    table: tiers.addis.I,
    variant: 'ADDIS_I',
  },
] as const;

/** Every threshold, a little either side of it, the middle of each tier, and well beyond the last. */
function sweep(thresholds: readonly number[]): number[] {
  const areas = new Set<number>([1, 37.5, thresholds[0]! / 2]);
  thresholds.forEach((t, i) => {
    areas.add(t);
    areas.add(t - 0.5);
    areas.add(t + 0.5);
    const next = thresholds[i + 1];
    if (next !== undefined) areas.add((t + next) / 2);
  });
  const last = thresholds[thresholds.length - 1]!;
  areas.add(last * 1.2);
  areas.add(last * 3);
  return [...areas].sort((a, b) => a - b);
}

describe('plot-size tiers', () => {
  for (const c of CASES) {
    it(`gives the workbook's rate for ${c.name}, at every tier`, () => {
      const formula = formulas.get(c.cell)!;
      for (const area of sweep(c.table.thresholds)) {
        const workbook = evaluateFormula(formula, cells(area, MAX_RATE), c.offset) as number;
        const engine = tieredAverageRate(dec(area), dec(MAX_RATE), c.table, c.variant, true);
        expect(engine.toNumber(), `${c.name} at ${area} m²`).toBeCloseTo(workbook, 6);
      }
    });
  }

  it('gives the six rates the sheet holds for the golden plot', () => {
    // 'LHR without coordinate'!C12:C18 as the workbook left them: 2,201.6 m² at 9,000.
    const held = {
      C12: 6253.201308139535,
      C13: 5850.277979651163,
      C14: 5685.501453488372,
      C16: 7825.127180232558,
      C17: 7825.290697674419,
      C18: 7915.388808139535,
    };
    const rate = (i: number) =>
      tieredAverageRate(
        dec('2201.6'),
        dec(9000),
        CASES[i]!.table,
        CASES[i]!.variant,
        true,
      ).toNumber();
    expect(rate(0)).toBeCloseTo(held.C12, 8);
    expect(rate(1)).toBeCloseTo(held.C13, 8);
    expect(rate(2)).toBeCloseTo(held.C14, 8);
    expect(rate(3)).toBeCloseTo(held.C16, 8);
    expect(rate(4)).toBeCloseTo(held.C17, 8);
    expect(rate(5)).toBeCloseTo(held.C18, 8);
  });

  it('prices every tier at its own factor once the correction is switched on', () => {
    for (const c of CASES) {
      for (const area of sweep(c.table.thresholds)) {
        // The plain marginal scale, worked here independently of the engine.
        let total = Math.min(area, c.table.thresholds[0]!);
        c.table.thresholds.forEach((from, i) => {
          const to = c.table.thresholds[i + 1] ?? Infinity;
          if (area > from) total += (Math.min(area, to) - from) * c.table.factors[i]!;
        });
        const engine = tieredAverageRate(dec(area), dec(MAX_RATE), c.table, c.variant, false);
        expect(engine.toNumber(), `${c.name} at ${area} m²`).toBeCloseTo(
          (total * MAX_RATE) / area,
          6,
        );
      }
    }
  });

  it('differs from the workbook only where the Addis Ababa formulas slip', () => {
    const differs = (i: number, area: number) => {
      const c = CASES[i]!;
      const workbook = tieredAverageRate(dec(area), dec(MAX_RATE), c.table, c.variant, true);
      const corrected = tieredAverageRate(dec(area), dec(MAX_RATE), c.table, c.variant, false);
      return !workbook.equals(corrected);
    };
    // The towns' formulas have no slip at any size.
    for (const i of [0, 1, 2]) {
      for (const area of sweep(CASES[i]!.table.thresholds)) expect(differs(i, area)).toBe(false);
    }
    // Addis Ababa industrial: the fifth and sixth tiers (2,000-3,000 m²) take the fourth's factor.
    expect(differs(5, 2000)).toBe(false);
    expect(differs(5, 2201.6)).toBe(true);
    expect(differs(5, 40000)).toBe(true);
    // Addis Ababa residential: sound up to 25,000 m², then the last two branches slip.
    expect(differs(3, 25000)).toBe(false);
    expect(differs(3, 27000)).toBe(true);
    expect(differs(3, 31000)).toBe(true);
  });

  it('charges the whole of a small plot at the maximum rate', () => {
    const segments = tierSegments(dec(150), tiers.other.R, 'OTHER', true);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.factor.toNumber()).toBe(1);
    expect(
      tieredAverageRate(dec(150), dec(MAX_RATE), tiers.other.R, 'OTHER', true).toNumber(),
    ).toBe(MAX_RATE);
  });
});
