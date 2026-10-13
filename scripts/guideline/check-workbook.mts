/**
 * Checks the system's civil valuation against a valuation done in the Excel
 * estimation template.
 *
 *   npx tsx scripts/guideline/check-workbook.mts <estimation.xlsm> [--input <out.json>]
 *
 * Reads what the valuator typed into the workbook - HOME, the component shares,
 * defects and works on COST APPROACH FOR COMPLETED, the location ratings and
 * the lease terms - runs the system's engine on exactly that, with the
 * published guideline tables, and sets each figure the system produces beside
 * the one Excel saved in the file: every component, every building, the site
 * works, the MCF, each land step and the final value.
 *
 * Use it on past estimations to show the system gives the workbook's answer,
 * so the workbook can be retired. A completed estimation only: the progress
 * sheet is not read. --input writes the engine input it built, as JSON.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { excelDate, openWorkbook } from './workbook.mjs';
import guidelineTables from '../../prisma/seed/guideline/v4.2.json' with { type: 'json' };
import {
  calculateCivil,
  type CivilBuildingInput,
  type CivilEngineInput,
  type CivilEngineOutput,
} from '../../src/server/domain/valuation/civil-engine.ts';
import type { EngineParameters } from '../../src/server/domain/valuation/common.ts';
import {
  agrees,
  block,
  compareFigures,
  formatFigure,
  printFigures,
  type CellValue,
} from './compare-figures.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--input');
const inputOut = args.includes('--input') ? args[args.indexOf('--input') + 1] : null;
if (!file) {
  console.error(
    'Usage: npx tsx scripts/guideline/check-workbook.mts <estimation.xlsm> [--input <out.json>]',
  );
  process.exit(2);
}

const workbook = openWorkbook(resolve(file));
const HOME = 'HOME';
const COST = 'COST APPROACH FOR COMPLETED';
const value = (sheet: string, ref: string): unknown => workbook.value(sheet, ref);
const numberAt = (sheet: string, ref: string): number | null => {
  const v = value(sheet, ref);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const textAt = (sheet: string, ref: string): string => {
  const v = value(sheet, ref);
  return v === null || v === undefined ? '' : String(v).trim();
};
/** A fraction the sheet holds (0.3) as the percentage the system takes ("30"). */
const percent = (fraction: number) => String(Number((fraction * 100).toPrecision(12)));
const text = (n: number | null) => (n === null ? null : String(n));

// ---------------------------------------------------------------------------
// The valuator's inputs
// ---------------------------------------------------------------------------

const HOLDING: Record<string, CivilEngineInput['land']['holdingRight']> = {
  'FREE/OLD(ነባር)': 'FREEHOLD',
  'LEASE(ሊዝ)': 'LEASE',
  'BOTH FREE/OLD(ነባር) & LEASE(ሊዝ)': 'BOTH',
};

const holdingText = textAt(HOME, 'E16');
const holdingRight = HOLDING[holdingText];
if (!holdingRight) throw new Error(`HOME!E16: unknown land holding right "${holdingText}"`);

/** Items listed once for the whole plot and assigned to a building by its number. */
function assigned(fromRow: number, toRow: number, building: string) {
  const rows: { row: number; item: string; description: string; rate: number | null }[] = [];
  for (let r = fromRow; r <= toRow; r++) {
    const item = textAt(COST, `B${r}`);
    if (item && textAt(COST, `E${r}`) === building) {
      rows.push({
        row: r,
        item,
        description: textAt(COST, `C${r}`),
        rate: numberAt(COST, `F${r}`),
      });
    }
  }
  return rows;
}

const skipped: string[] = [];
const buildings: CivilBuildingInput[] = [];
for (let r = 6; r <= 45; r++) {
  const costType = textAt(HOME, `J${r}`);
  if (!costType || costType === 'Select Building Type') continue;
  const k = r - 5;
  const label = textAt(HOME, `H${r}`) || `Building ${k}`;
  const b = block(k);

  const components: CivilBuildingInput['components'][number][] = [];
  for (let row = 10; row <= 200; row++) {
    const share = numberAt(COST, `${b.share}${row}`);
    if (share === null) continue;
    if (numberAt(COST, `${b.cost}${row}`) === null) {
      skipped.push(`${label} row ${row}: a share with no component cost`);
      continue;
    }
    components.push({ row, sharePercent: percent(share), completionPercent: null });
  }

  const newComponents = assigned(273, 312, label).flatMap((item, i) => {
    const share = numberAt(COST, `${b.share}${202 + i}`);
    return share === null || item.rate === null
      ? []
      : [
          {
            category: item.item,
            description: item.description || null,
            unitRate: String(item.rate),
            sharePercent: percent(share),
            completionPercent: null,
          },
        ];
  });

  const defects: CivilBuildingInput['defects'][number][] = [];
  for (let row = 237; row <= 269; row++) {
    const affected = numberAt(COST, `${b.share}${row}`);
    // Row r reads 'cost summery' row r - 230.
    if (affected !== null && affected !== 0)
      defects.push({ code: row - 230, percent: percent(affected) });
  }

  const supplementary = assigned(315, 330, label).flatMap((item, i) => {
    const quantity = numberAt(COST, `${b.share}${213 + i}`);
    return quantity === null
      ? []
      : [{ item: item.item, quantity: String(quantity), completionPercent: null }];
  });

  buildings.push({
    buildingId: `excel-${k}`,
    buildingNumber: k,
    name: textAt(HOME, `I${r}`) || label,
    constructionStatus: 'COMPLETED',
    progressPercent: null,
    floorArea: text(numberAt(HOME, `M${r}`)),
    builtUpArea: text(numberAt(HOME, `L${r}`)),
    costType,
    count: String(numberAt(HOME, `K${r}`) ?? 1),
    heightM: text(numberAt(HOME, `P${r}`)),
    components,
    newComponents,
    defects,
    supplementary,
  });
}

/** Rows of works on the plot: item in B, note in C, quantity in E. */
function works(fromRow: number, toRow: number) {
  const rows: { row: number; item: string; description: string; quantity: unknown }[] = [];
  for (let r = fromRow; r <= toRow; r++) {
    const item = textAt(COST, `B${r}`);
    if (item)
      rows.push({
        row: r,
        item,
        description: textAt(COST, `C${r}`),
        quantity: value(COST, `E${r}`),
      });
  }
  return rows;
}

const civilRows = works(333, 348);
const gasRows = works(354, 369);
const coffeeRows = works(375, 390);
const quantityText = (q: unknown) => (typeof q === 'number' ? String(q) : String(q ?? '').trim());

const input: CivilEngineInput = {
  valuationDate: excelDate(value(HOME, 'E6')),
  location: {
    city: textAt(HOME, 'E26'),
    purpose: textAt(HOME, 'E20'),
    propertyType: textAt(HOME, 'E22'),
    floorLevel: numberAt(HOME, 'E23'),
    utility: textAt(COST, 'E404'),
    neighbourhood: textAt(COST, 'E405'),
    roadQuality: textAt(COST, 'E406'),
    roadWidth: textAt(COST, 'E407'),
    proximity: textAt(COST, 'E408'),
    accessibility: textAt(COST, 'E409'),
  },
  land: {
    holdingRight,
    plotArea: text(numberAt(HOME, 'E18')),
    latitude: text(numberAt(HOME, 'E27')),
    longitude: text(numberAt(HOME, 'F27')),
    leaseRemainingYears: numberAt(COST, 'D420'),
    leaseTotalYears: numberAt(COST, 'D419'),
    leaseTotalAmount: text(numberAt(COST, 'D418')),
    leasePaidAmount: text(numberAt(COST, 'D417')),
    freeholdArea: text(numberAt(COST, 'D416')),
  },
  buildings,
  siteWorks: {
    civil: civilRows.map((w) => {
      // A swimming pool's "quantity" is its length, width and depth, "L,W,D".
      const dims = /^\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*$/.exec(quantityText(w.quantity));
      return {
        item: w.item,
        description: w.description || null,
        quantity: dims ? null : quantityText(w.quantity) || '0',
        completionPercent: null,
        pool: dims ? { length: dims[1]!, width: dims[2]!, depth: dims[3]! } : null,
      };
    }),
    gasStation: gasRows.map((w) => ({
      item: w.item,
      quantity: quantityText(w.quantity) || '0',
      completionPercent: null,
    })),
    coffeeSite: coffeeRows.map((w) => ({
      item: w.item,
      quantity: quantityText(w.quantity) || '0',
      completionPercent: null,
    })),
  },
  reconciliation: null,
  forcedSale: null,
};

if (inputOut) {
  writeFileSync(resolve(inputOut), `${JSON.stringify(input, null, 2)}\n`);
  console.warn(`Engine input written to ${inputOut}`);
}

// ---------------------------------------------------------------------------
// The system's calculation
// ---------------------------------------------------------------------------

const params: EngineParameters = {
  setCode: 'GUIDELINE',
  setVersion: 1,
  values: {},
  tables: Object.fromEntries(
    (guidelineTables as { key: string; value: unknown }[]).map((p) => [p.key, p.value]),
  ),
};

let output: CivilEngineOutput;
try {
  output = calculateCivil(input, params);
} catch (error) {
  console.error(`The system refused this estimation: ${(error as Error).message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Side by side
// ---------------------------------------------------------------------------

const rows = compareFigures(output, (sheet, ref) => workbook.value(sheet, ref) as CellValue, {
  civil: civilRows.map((w) => w.row),
  gasStation: gasRows.map((w) => w.row),
  coffeeSite: coffeeRows.map((w) => w.row),
});

console.log(`
${file}`);
console.log(
  `${output.property.propertyType} on ${output.property.purpose.toLowerCase()} land in ${output.property.city}, valued ${input.valuationDate}
`,
);
printFigures(rows, (line) => console.log(line));
const different = rows.filter((r) => !agrees(r));
for (const note of skipped) console.log(`Not read: ${note}`);
console.log(
  different.length === 0
    ? `
All ${rows.length} figures agree with the workbook. Final value ETB ${formatFigure(Number(output.marketValue), 'money')}.`
    : `
${different.length} of ${rows.length} figures differ from the workbook.`,
);
process.exit(different.length === 0 ? 0 : 1);
