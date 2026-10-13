/**
 * The system's civil figures set beside the cells of the Excel estimation
 * template that hold the same figures.
 *
 * Shared by check-workbook.mts (a saved workbook) and excel/scenarios.mts
 * (scenarios recalculated by Excel). `get` reads a cell's value, however it was
 * obtained. A completed estimation is compared on COST APPROACH FOR COMPLETED
 * and REPORT-COMPLETED; one under construction also on COST APPROACH FOR
 * PROGRESS and REPORT-PROGRESS.
 */
import type { CivilEngineOutput } from '@/server/domain/valuation/civil-engine';

export type CellValue = number | string | boolean | null | undefined;
export type CellGetter = (sheet: string, ref: string) => CellValue;
export type Kind = 'money' | 'rate';

export interface FigureRow {
  readonly cell: string;
  readonly what: string;
  readonly excel: number | null;
  readonly excelText: string;
  readonly system: number;
  readonly kind: Kind;
  /** For a total summed from rounded figures: half a cent for each. */
  readonly tolerance?: number;
}

export const COMPLETED = 'COST APPROACH FOR COMPLETED';
export const PROGRESS = 'COST APPROACH FOR PROGRESS';
export const REPORT = 'REPORT-COMPLETED';
export const REPORT_PROGRESS = 'REPORT-PROGRESS';
const LHR_WITH = 'LHR with coordinate';
const LHR_WITHOUT = 'LHR without coordinate';
const SALE = 'SALE APPROACH ';

/** Building k (1-based) is priced in columns B, C, D shifted three to the right per building. */
export function block(k: number): { name: string; share: string; cost: string } {
  const col = (n: number) => {
    let s = '';
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };
  return { name: col(2 + 3 * (k - 1)), share: col(3 + 3 * (k - 1)), cost: col(4 + 3 * (k - 1)) };
}

const FACTOR_CELLS: Record<string, string> = {
  utility: 'G404',
  neighbourhood: 'G405',
  roadQuality: 'G406',
  roadWidth: 'G407',
  proximity: 'G408',
  accessibility: 'G409',
  bar: 'G410',
  floorLevel: 'G411',
};

export function compareFigures(
  output: CivilEngineOutput,
  get: CellGetter,
  rows: {
    /** Workbook rows of the plot civil works, gas station and coffee site items, in input order. */
    civil: readonly number[];
    gasStation: readonly number[];
    coffeeSite: readonly number[];
  },
): FigureRow[] {
  const out: FigureRow[] = [];
  const numberAt = (sheet: string, ref: string): number | null => {
    const v = get(sheet, ref);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  /** `blankIsZero`: a cell Excel leaves blank (or "") where its figure does not apply. */
  const compare = (
    sheet: string,
    ref: string,
    what: string,
    system: string | number,
    kind: Kind = 'money',
    blankIsZero = false,
    tolerance?: number,
  ) => {
    const raw = get(sheet, ref);
    const blank = raw === null || raw === undefined || raw === '';
    out.push({
      cell: `${sheet}!${ref}`,
      what,
      excel: numberAt(sheet, ref) ?? (blankIsZero && blank ? 0 : null),
      excelText: blank ? '(empty)' : String(raw),
      system: Number(system),
      kind,
      ...(tolerance === undefined ? {} : { tolerance }),
    });
  };
  const sum = (values: readonly string[]) => values.reduce((s, v) => s + Number(v), 0);
  const progress = output.mode === 'PROGRESS';

  // --- buildings, complete (COST APPROACH FOR COMPLETED) ----------------------
  for (const b of output.buildings) {
    const c = block(b.buildingNumber);
    for (const component of b.components) {
      compare(
        COMPLETED,
        `${c.cost}${component.row}`,
        `${b.name}: ${component.name}`,
        component.cost,
        'rate',
      );
    }
    b.newComponents.forEach((n, i) =>
      compare(
        COMPLETED,
        `${c.cost}${202 + i}`,
        `${b.name}: new component ${n.category}`,
        n.cost,
        'rate',
      ),
    );
    b.supplementary.forEach((s, i) =>
      compare(COMPLETED, `${c.cost}${213 + i}`, `${b.name}: ${s.item}`, s.amount),
    );
    compare(
      COMPLETED,
      `${c.cost}223`,
      `${b.name}: rate per m² (or m³)`,
      b.complete.areaRate,
      'rate',
    );
    compare(
      COMPLETED,
      `${c.cost}224`,
      `${b.name}: depreciation`,
      Number(b.depreciationPercent) / 100,
      'rate',
      true,
    );
    compare(
      COMPLETED,
      `${c.cost}230`,
      `${b.name}: depreciated replacement cost`,
      b.complete.depreciatedCost,
    );
    compare(COMPLETED, `${c.cost}231`, `${b.name}: with supplementary works`, b.complete.value);
  }
  // Complete figures; for a property under construction the engine reports
  // them as it stands, so they are summed here from the rounded parts.
  if (progress) {
    compare(
      COMPLETED,
      'D233',
      'All buildings',
      sum(output.buildings.map((b) => b.complete.value)),
      'money',
      false,
      0.005 * output.buildings.length + 0.005,
    );
  } else {
    compare(COMPLETED, 'D233', 'All buildings', output.cost.buildingsValue);
  }

  // --- site works -------------------------------------------------------------
  rows.civil.forEach((row, i) =>
    compare(
      COMPLETED,
      `F${row}`,
      output.siteWorks.civil[i]!.item,
      output.siteWorks.civil[i]!.amount,
    ),
  );
  rows.gasStation.forEach((row, i) =>
    compare(
      COMPLETED,
      `F${row}`,
      output.siteWorks.gasStation[i]!.item,
      output.siteWorks.gasStation[i]!.amount,
    ),
  );
  rows.coffeeSite.forEach((row, i) =>
    compare(
      COMPLETED,
      `F${row}`,
      output.siteWorks.coffeeSite[i]!.item,
      output.siteWorks.coffeeSite[i]!.amount,
    ),
  );
  if (progress) {
    compare(
      COMPLETED,
      'F349',
      'Plot civil works',
      sum(output.siteWorks.civil.map((w) => w.amount)),
      'money',
      true,
      0.005 * output.siteWorks.civil.length + 0.005,
    );
  } else {
    compare(COMPLETED, 'F349', 'Plot civil works', output.siteWorks.civilTotal, 'money', true);
  }
  compare(COMPLETED, 'F395', 'Market condition factor', output.cost.factor, 'rate');

  // --- land ---------------------------------------------------------------------
  if (output.land.maxRate.source === 'POLYGON') {
    compare(LHR_WITH, 'B11', 'Maximum location rate (zone)', output.land.maxRate.value, 'rate');
  }
  compare(LHR_WITHOUT, 'B10', 'Maximum location rate used', output.land.maxRate.value, 'rate');
  compare(LHR_WITHOUT, 'B11', 'Rate after plot-size tiers', output.land.tiers.averageRate, 'rate');
  for (const f of output.land.factors) {
    compare(COMPLETED, FACTOR_CELLS[f.key]!, `Factor: ${f.label}`, f.factor, 'rate');
  }
  // H413 holds the free-hold value - or, for a plot held on lease alone with
  // under 20 years to run, the lease value. H416 holds the lease part of a
  // plot held both ways.
  if (output.land.holding.basis === 'LEASE') {
    compare(COMPLETED, 'H413', 'Location value (lease)', output.land.holding.leaseValue);
  } else {
    compare(COMPLETED, 'H413', 'Location value (free hold)', output.land.holding.freeholdValue);
    compare(
      COMPLETED,
      'H416',
      'Location value (lease part)',
      output.land.holding.leaseValue,
      'money',
      true,
    );
  }

  // --- sale approach ------------------------------------------------------------
  compare(
    SALE,
    'H11',
    'Sale approach value (complete)',
    output.sales.valueAtCompletion,
    'money',
    true,
  );

  const report = progress ? REPORT_PROGRESS : REPORT;
  ['E46', 'F46', 'G46', 'H46', 'I46'].forEach((ref, i) =>
    compare(
      report,
      ref,
      `Land holding rate, grade ${i + 1}`,
      output.land.holdingRates.grades[i]!,
      'rate',
    ),
  );
  compare(
    report,
    'J46',
    'Average land holding rate taken',
    output.land.holdingRates.averageTaken,
    'rate',
  );

  if (!progress) {
    compare(REPORT, 'K124', 'Location value taken', output.land.value);
    compare(REPORT, 'K125', 'Cost approach value', output.cost.indicatedValue);
    compare(
      REPORT,
      'H137',
      'Weight on cost',
      Number(output.reconciliation.costWeight) / 100,
      'rate',
    );
    compare(
      REPORT,
      'H138',
      'Weight on sale',
      Number(output.reconciliation.salesWeight) / 100,
      'rate',
    );
    compare(REPORT, 'K139', 'FINAL VALUE', output.marketValue);
    if (numberAt(REPORT, 'H141') !== null) {
      compare(REPORT, 'H141', 'Forced-sale value', output.forcedSaleValue);
    }
    return out;
  }

  // --- a property under construction (COST APPROACH FOR PROGRESS, REPORT-PROGRESS)
  for (const b of output.buildings) {
    const c = block(b.buildingNumber);
    compare(
      PROGRESS,
      `${c.cost}223`,
      `${b.name}: rate per m² as it stands`,
      b.current.areaRate,
      'rate',
    );
    compare(
      PROGRESS,
      `${c.cost}230`,
      `${b.name}: depreciated cost as it stands`,
      b.current.depreciatedCost,
    );
    compare(PROGRESS, `${c.cost}231`, `${b.name}: value as it stands`, b.current.value);
  }
  compare(
    PROGRESS,
    'F345',
    'Plot civil works as they stand',
    output.siteWorks.civilTotal,
    'money',
    true,
  );
  const p = output.progress!;
  compare(REPORT_PROGRESS, 'F122', 'Development at completion', p.developmentAtCompletion);
  compare(REPORT_PROGRESS, 'H122', 'Development as it stands', p.developmentAtCurrentStage);
  compare(REPORT_PROGRESS, 'K122', 'Overall completion', Number(p.completionPercent) / 100, 'rate');
  compare(REPORT_PROGRESS, 'K123', 'Market condition factor', output.cost.factor, 'rate');
  compare(REPORT_PROGRESS, 'K125', 'Location value taken', output.land.value);
  compare(REPORT_PROGRESS, 'K127', 'Development after MCF', output.cost.afterFactor);
  compare(REPORT_PROGRESS, 'K130', 'Value at the current stage', output.cost.indicatedValue);
  compare(REPORT_PROGRESS, 'K131', 'Value at completion', p.valueAtCompletion);
  compare(
    REPORT_PROGRESS,
    'K139',
    'Sale value at the current stage',
    output.sales.indicatedValue,
    'money',
    true,
  );
  compare(
    REPORT_PROGRESS,
    'H142',
    'Weight on cost',
    Number(output.reconciliation.costWeight) / 100,
    'rate',
  );
  compare(
    REPORT_PROGRESS,
    'H143',
    'Weight on sale',
    Number(output.reconciliation.salesWeight) / 100,
    'rate',
  );
  compare(REPORT_PROGRESS, 'K144', 'FINAL VALUE (current stage)', output.marketValue);
  if (numberAt(REPORT_PROGRESS, 'H147') !== null) {
    compare(REPORT_PROGRESS, 'H147', 'Forced-sale value', output.forcedSaleValue);
  }
  return out;
}

/** Money to the cent; rates and factors to a part in ten thousand. */
export function agrees(row: FigureRow): boolean {
  if (row.excel === null) return false;
  return row.kind === 'money'
    ? Math.abs(row.excel - row.system) < Math.max(0.01, row.tolerance ?? 0)
    : Math.abs(row.excel - row.system) <= 1e-4 * Math.max(1, Math.abs(row.excel));
}

export function formatFigure(n: number | null, kind: Kind, text = '(empty)'): string {
  if (n === null) return text.slice(0, 18);
  return kind === 'money'
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(Number(n.toPrecision(10)));
}

/** The comparison as a table, one figure a line, differences marked. */
export function printFigures(rows: readonly FigureRow[], log: (line: string) => void): void {
  const width = Math.max(...rows.map((r) => r.what.length), 10);
  log(`${'Figure'.padEnd(width)}  ${'Excel'.padStart(18)}  ${'System'.padStart(18)}  Cell`);
  for (const r of rows) {
    log(
      `${r.what.slice(0, width).padEnd(width)}  ${formatFigure(r.excel, r.kind, r.excelText).padStart(18)}  ${formatFigure(r.system, r.kind).padStart(18)}  ${agrees(r) ? '' : 'DIFFERENT  '}${r.cell}`,
    );
  }
}
