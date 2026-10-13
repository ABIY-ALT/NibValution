import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCivil, type CivilEngineInput } from '@/server/domain/valuation/civil-engine';
import {
  agrees,
  compareFigures,
  formatFigure,
  type CellValue,
} from '../../scripts/guideline/compare-figures';
import { guidelineParameters } from '../helpers/guideline';

/**
 * The engine against Microsoft Excel, across every path of the calculation.
 *
 * Each scenario was typed into a fresh copy of the version 4.2 estimation
 * template and recalculated by Excel itself (scripts/guideline/excel). The
 * fixture holds each scenario's input and the values Excel gave in every cell
 * the engine's figures are compared with. Re-record it after a template or
 * engine change:
 *
 *   npx tsx scripts/guideline/excel/scenarios.mts build <template.xlsm> scenarios.json
 *   powershell -File scripts/guideline/excel/run-scenarios.ps1 -Workbook <template.xlsm> `
 *     -Scenarios scenarios.json -Out results.json
 *   npx tsx scripts/guideline/excel/scenarios.mts compare scenarios.json results.json `
 *     --record docs/guideline/v4.2/excel_scenarios.json
 */

const FIXTURE = join(process.cwd(), 'docs', 'guideline', 'v4.2', 'excel_scenarios.json');
const recorded = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      scenarios: {
        name: string;
        about: string;
        input: CivilEngineInput;
        excel: Record<string, CellValue>;
      }[];
    })
  : { scenarios: [] };

const PARAMS = guidelineParameters();

describe('the engine against Excel', () => {
  it('has the recorded scenarios', () => {
    expect(recorded.scenarios.length).toBeGreaterThanOrEqual(50);
  });

  for (const scenario of recorded.scenarios) {
    it(`${scenario.name}: ${scenario.about}`, () => {
      const output = calculateCivil(scenario.input, PARAMS);
      const rows = compareFigures(output, (sheet, ref) => scenario.excel[`${sheet}!${ref}`], {
        civil: scenario.input.siteWorks.civil.map((_, i) => 333 + i),
        gasStation: scenario.input.siteWorks.gasStation.map((_, i) => 354 + i),
        coffeeSite: scenario.input.siteWorks.coffeeSite.map((_, i) => 375 + i),
      });
      const differ = rows
        .filter((r) => !agrees(r))
        .map(
          (r) =>
            `${r.cell} ${r.what}: Excel ${formatFigure(r.excel, r.kind, r.excelText)}, system ${formatFigure(r.system, r.kind)}`,
        );
      expect(differ).toEqual([]);
      expect(rows.length).toBeGreaterThan(20);
    });
  }
});
