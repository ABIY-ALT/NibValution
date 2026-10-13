import { describe, expect, it } from 'vitest';
import { calculateCivil } from '@/server/domain/valuation/civil-engine';
import { GOLDEN, goldenInput, guidelineParameters } from '../helpers/guideline';

/**
 * The golden case: Golla Bee Production PLC, valued in the Excel estimation
 * template (docs/guideline/v4.2/golden_case_golla_bee.json). The expected
 * figures are the workbook's own cells, so this is the proof that the engine
 * calculates as the guideline's template does - to the cent.
 */

const expected = GOLDEN.expected_results;
const cents = (value: number): string => value.toFixed(2);

describe('civil engine against the Excel golden case', () => {
  const output = calculateCivil(goldenInput(), guidelineParameters());

  it('finds the location zone the coordinates fall in', () => {
    expect(output.land.maxRate.source).toBe('POLYGON');
    expect(output.land.maxRate.zone).toMatchObject({ city: 'Furi', grade: 'Prime' });
    expect(Number(output.land.maxRate.value)).toBe(expected.lhr_max_rate_after_adjustment);
    expect(output.land.locationLabel).toBe(expected.report_location_label_E25);
  });

  it('reduces the land rate by the plot-size tiers', () => {
    expect(Number(output.land.tiers.averageRate)).toBeCloseTo(
      expected.lhr_average_rate_after_area_tiers,
      4,
    );
  });

  it('reads each location factor the workbook reads', () => {
    const ratings = GOLDEN.location_ratings;
    const factor = (key: string) => Number(output.land.factors.find((f) => f.key === key)?.factor);
    expect(factor('utility')).toBe(ratings.utility.excel_factor);
    expect(factor('neighbourhood')).toBe(ratings.neighborhood.excel_factor);
    expect(factor('roadQuality')).toBe(ratings.road_quality.excel_factor);
    expect(factor('roadWidth')).toBe(ratings.road_width.excel_factor);
    expect(factor('proximity')).toBe(ratings.proximity.excel_factor);
    expect(factor('accessibility')).toBe(ratings.accessibility.excel_factor);
    expect(factor('bar')).toBe(ratings.bar.excel_factor);
    expect(Number(output.land.builtUpAreaRatio)).toBeCloseTo(ratings.bar.choice, 6);
  });

  it('values the land on the lease rule', () => {
    expect(output.land.holding.basis).toBe('LEASE_AS_FREEHOLD');
    expect(output.land.locationValue).toBe(cents(expected.location_value_H413));
    expect(output.land.staged.rule).toBe('FULL');
    expect(output.land.value).toBe(cents(expected.report_location_value_K124));
  });

  it('quotes the report’s range of land holding rates', () => {
    // REPORT-COMPLETED!E46:J46 as the workbook saved them.
    const range = [
      5685.501453488372, 5116.951308139535, 4548.4011627906975, 3979.85101744186,
      3411.3008720930234,
    ];
    output.land.holdingRates.grades.forEach((rate, i) =>
      expect(Number(rate)).toBeCloseTo(range[i]!, 4),
    );
    expect(Number(output.land.holdingRates.averageTaken)).toBeCloseTo(2937.850746855696, 4);
  });

  it('prices every component of every building', () => {
    GOLDEN.buildings.forEach((building, index) => {
      const valued = output.buildings[index]!;
      for (const component of building.components) {
        const priced = valued.components.find((c) => c.row === component.row);
        expect(priced, `${building.name} row ${component.row}`).toBeDefined();
        expect(Number(priced!.cost)).toBeCloseTo(component.excel_cost_per_unit, 3);
      }
      expect(Number(valued.complete.areaRate)).toBeCloseTo(building.excel.area_volume_rate, 3);
      expect(valued.complete.depreciatedCost).toBe(cents(building.excel.drc_all));
      expect(valued.value).toBe(cents(building.excel.drc_all_with_supp));
    });
  });

  it('prices the plot civil works', () => {
    GOLDEN.plot_civil_works.forEach((work, index) => {
      expect(output.siteWorks.civil[index]!.amount).toBe(cents(work.excel_amount));
    });
    expect(output.siteWorks.civilTotal).toBe(cents(expected.plot_civil_works_total));
  });

  it('applies the market condition factor and reaches the workbook’s value', () => {
    expect(output.cost.buildingsValue).toBe(cents(expected.dep_replacement_cost_all_buildings));
    expect(output.cost.developmentValue).toBe(cents(expected.drc_plus_civil_works));
    expect(Number(output.cost.factor)).toBe(expected.market_condition_factor);
    expect(output.cost.afterFactor).toBe(cents(expected.drc_after_mcf));
    expect(output.cost.indicatedValue).toBe(cents(expected.report_cost_approach_value_K125));
  });

  it('takes the cost approach alone outside Addis Ababa', () => {
    expect(output.sales.applicable).toBe(false);
    expect(output.reconciliation.source).toBe('COST_ONLY');
    expect(output.marketValue).toBe(cents(expected.final_reconciled_value_K139));
    expect(output.marketValue).toBe('37588956.55');
  });

  it('takes the foreclosure percentage for other land purposes', () => {
    // Furi is listed at 80%, but only for residential, commercial and shop land.
    expect(output.forcedSale.percent).toBe('70.00');
    expect(output.forcedSaleValue).toBe('26312269.59');
  });
});
