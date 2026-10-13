import { describe, expect, it } from 'vitest';
import type { CivilEngineInput } from '@/server/domain/valuation/civil-engine';
import {
  calculateMechanical,
  type MechanicalEngineInput,
  type MechanicalItemInput,
} from '@/server/domain/valuation/mechanical-engine';
import { canonicalJson, runEngine } from '@/server/domain/valuation/calculation';
import type { EngineParameters } from '@/server/domain/valuation/common';
import { goldenInput, guidelineParameters } from '../helpers/guideline';

/**
 * Every expected figure below was worked by hand from the formulas in the
 * engines' doc comments, not read back from the engine - a test that only
 * repeats the code's own output proves nothing about the arithmetic.
 *
 * The civil engine has suites of its own: civil-golden (the Excel workbook's
 * own case), civil-land-tiers (the workbook's formulas) and civil-engine (each
 * rule of the guideline).
 */

const PARAMS: EngineParameters = {
  setCode: 'TEST',
  setVersion: 1,
  values: {
    'reconciliation.cost_weight': '60',
    'reconciliation.sales_weight': '40',
    'forced_sale.percent': '75',
    'cost_approach.mcf': '1.000000',
    'depreciation.residual_percent': '10',
  },
  tables: {
    'depreciation.method': { method: 'STRAIGHT_LINE' },
    'depreciation.economic_life': { RCC_FRAME: 60, MASONRY: 50, DEFAULT: 50 },
    'depreciation.condition_modifiers': {
      EXCELLENT: '0.70',
      VERY_GOOD: '0.85',
      GOOD: '1.00',
      FAIR: '1.15',
      POOR: '1.35',
      SCRAP: '1.00',
    },
    'mechanical.cif_loadings': {
      DUTY_PERCENT: 10,
      INLAND_FREIGHT_PERCENT: 5,
      INSTALLATION_PERCENT: 5,
    },
    'mechanical.economic_life': { PASSENGER_VEHICLE: 12, DEFAULT: 15 },
    'land.lease_valuation_basis': { basis: 'REMAINING_TERM', includeUnpaidLeaseBalance: true },
  },
};

const withParams = (
  values: Record<string, string> = {},
  tables: Record<string, unknown> = {},
): EngineParameters => ({
  ...PARAMS,
  values: { ...PARAMS.values, ...values },
  tables: { ...PARAMS.tables, ...tables },
});

// ---------------------------------------------------------------------------
// Mechanical
// ---------------------------------------------------------------------------

const machine: MechanicalItemInput = {
  itemId: 'm1',
  kind: 'MACHINERY',
  itemNumber: 1,
  description: 'Injection moulder',
  manufactureYear: 2021,
  condition: 'GOOD',
  costBasis: 'CIF',
  cifValue: '1000000',
  replacementQuote: null,
  equipmentClass: 'PRODUCTION_MACHINERY',
  effectiveAgeOverride: null,
  conditionAdjustmentPercent: '0',
  comparables: [],
};

const vehicle: MechanicalItemInput = {
  itemId: 'v1',
  kind: 'VEHICLE',
  itemNumber: 2,
  description: 'Toyota Hilux',
  manufactureYear: 2020,
  condition: 'GOOD',
  costBasis: 'QUOTE',
  cifValue: null,
  replacementQuote: '2000000',
  equipmentClass: 'PASSENGER_VEHICLE',
  effectiveAgeOverride: null,
  conditionAdjustmentPercent: '10',
  comparables: [
    {
      description: 'Hilux 2020, Addis',
      source: 'Dealer listing',
      marketPrice: '1300000',
      conditionAdjustment: '-10',
      ageAdjustment: '0',
      locationAdjustment: '0',
      otherAdjustment: '0',
    },
    {
      description: 'Hilux 2019, Adama',
      source: null,
      marketPrice: '1000000',
      conditionAdjustment: '0',
      ageAdjustment: '5',
      locationAdjustment: '0',
      otherAdjustment: '0',
    },
  ],
};

const mechanicalInput: MechanicalEngineInput = {
  valuationDate: '2026-09-01',
  items: [machine, vehicle],
  reconciliation: null,
  forcedSale: null,
};

describe('mechanical valuation engine', () => {
  it('values each item and sums them', () => {
    const result = calculateMechanical(mechanicalInput, PARAMS);
    const [m1, v1] = result.items;

    // CIF 1,000,000 + 20% loadings; 5 of 15 years (DEFAULT class) = 33.333333%
    expect(m1?.cost?.replacementCost).toBe('1200000.00');
    expect(m1?.cost?.depreciation.amount).toBe('400000.00');
    expect(m1?.value).toBe('800000.00');

    // Quote 2,000,000; 6 of 12 years = 50%; then +10% condition
    expect(v1?.cost?.depreciation.amount).toBe('1000000.00');
    expect(v1?.cost?.value).toBe('1100000.00');
    // (1,300,000 x 0.9 + 1,000,000 x 1.05) / 2
    expect(v1?.market?.value).toBe('1110000.00');
    // 1,100,000 x 60% + 1,110,000 x 40%
    expect(v1?.value).toBe('1104000.00');

    expect(result.marketValue).toBe('1904000.00');
    expect(result.forcedSaleValue).toBe('1428000.00');
    expect(result.reconciliation.source).toBe('PARAMETERS');
  });

  it('values an item on the market alone when no cost basis is given', () => {
    const result = calculateMechanical(
      { ...mechanicalInput, items: [{ ...vehicle, costBasis: 'NONE' }] },
      PARAMS,
    );
    expect(result.items[0]?.cost).toBeNull();
    expect(result.marketValue).toBe('1110000.00');
    expect(result.reconciliation.source).toBe('SINGLE_APPROACH');
  });

  it('refuses an item with neither approach', () => {
    expect(() =>
      calculateMechanical(
        { ...mechanicalInput, items: [{ ...vehicle, costBasis: 'NONE', comparables: [] }] },
        PARAMS,
      ),
    ).toThrow(/cost basis or add at least one/);
  });
});

// ---------------------------------------------------------------------------
// Reproducibility (spec section 28)
// ---------------------------------------------------------------------------

describe('reproducibility', () => {
  it('produces byte-identical output for the same input and parameters', () => {
    const civilInput = goldenInput();
    const params = guidelineParameters();
    const first = canonicalJson(runEngine('CIVIL', civilInput, params));
    const second = canonicalJson(
      runEngine(
        'CIVIL',
        JSON.parse(JSON.stringify(civilInput)) as CivilEngineInput,
        JSON.parse(JSON.stringify(params)) as EngineParameters,
      ),
    );
    expect(second).toBe(first);
  });

  it('serialises independently of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe(
      '{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });

  it('changes when a parameter changes', () => {
    const base = canonicalJson(runEngine('MECHANICAL', mechanicalInput, PARAMS));
    const changed = canonicalJson(
      runEngine('MECHANICAL', mechanicalInput, withParams({ 'forced_sale.percent': '70' })),
    );
    expect(changed).not.toBe(base);
  });
});
