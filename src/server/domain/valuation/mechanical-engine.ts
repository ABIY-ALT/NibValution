import { BusinessRuleError } from '@/lib/errors';
import { HUNDRED, ZERO, dec, money, type Decimal } from '@/lib/money';
import type { ConditionGrade, MechanicalItemKind } from '../shared/enums';
import { calculateDepreciation } from './depreciation';
import {
  ageAtValuation,
  applyAdjustment,
  depreciationSettings,
  fmt,
  forcedSale,
  m,
  mean,
  netAdjustment,
  paramTable,
  pct,
  positive,
  reconcile,
  resolveWeights,
  tableEntry,
  type EngineParameters,
  type ForcedSaleOverride,
  type ForcedSaleResult,
  type WeightOverride,
} from './common';

/**
 * The mechanical valuation engine (spec section 13).
 *
 * Each vehicle or machine is valued on its own, by either or both approaches:
 *
 *   cost approach     current replacement cost - from the CIF value plus the
 *                     configured duty, freight and installation loadings, or
 *                     from a quote for a new equivalent - less depreciation,
 *                     then the valuator's condition adjustment
 *   market approach   mean of comparable listings, each adjusted for
 *                     condition, age, location and anything else
 *
 * An item valued both ways is reconciled with the configured weights (the same
 * cost / sales pair the civil engine uses, the market approach standing in for
 * sales). The case's market value is the sum of its items.
 */

export const MECHANICAL_FORMULA_VERSION = 'mechanical-1.0.0';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface ComparableEquipmentInput {
  readonly description: string;
  readonly source: string | null;
  readonly marketPrice: string;
  readonly conditionAdjustment: string;
  readonly ageAdjustment: string;
  readonly locationAdjustment: string;
  readonly otherAdjustment: string;
}

export interface MechanicalItemInput {
  readonly itemId: string;
  readonly kind: MechanicalItemKind;
  readonly itemNumber: number;
  readonly description: string;
  readonly manufactureYear: number | null;
  readonly condition: ConditionGrade | null;

  /** How replacement cost is established; NONE values the item on the market alone. */
  readonly costBasis: 'CIF' | 'QUOTE' | 'NONE';
  readonly cifValue: string | null;
  readonly replacementQuote: string | null;
  /** A key of the `mechanical.economic_life` table. */
  readonly equipmentClass: string;
  readonly effectiveAgeOverride: string | null;
  /** The valuator's condition adjustment to the depreciated cost, in percent. */
  readonly conditionAdjustmentPercent: string;

  readonly comparables: readonly ComparableEquipmentInput[];
}

export interface MechanicalEngineInput {
  readonly valuationDate: string;
  readonly items: readonly MechanicalItemInput[];
  readonly reconciliation: WeightOverride | null;
  readonly forcedSale: ForcedSaleOverride | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface MechanicalCostOutput {
  readonly basis: 'CIF' | 'QUOTE';
  readonly cifValue: string | null;
  readonly loadingsPercent: string | null;
  readonly replacementCost: string;
  readonly replacementFormula: string;
  readonly depreciation: {
    readonly method: string;
    readonly effectiveAgeYears: string;
    readonly economicLifeYears: string;
    readonly residualPercent: string;
    readonly ratePercent: string;
    readonly amount: string;
    readonly formula: string;
  };
  readonly remainingLifeYears: string;
  readonly conditionAdjustmentPercent: string;
  readonly conditionAdjustment: string;
  readonly value: string;
  readonly formula: string;
}

export interface MechanicalItemOutput {
  readonly itemId: string;
  readonly kind: MechanicalItemKind;
  readonly itemNumber: number;
  readonly description: string;
  readonly equipmentClass: string;
  readonly cost: MechanicalCostOutput | null;
  readonly market: {
    readonly comparables: readonly (ComparableEquipmentInput & {
      netAdjustmentPercent: string;
      adjustedValue: string;
    })[];
    readonly value: string;
    readonly formula: string;
  } | null;
  readonly costWeight: string;
  readonly marketWeight: string;
  readonly value: string;
  readonly formula: string;
}

export interface MechanicalEngineOutput {
  readonly formulaVersion: string;
  readonly loadings: Readonly<Record<string, string>>;
  readonly items: readonly MechanicalItemOutput[];
  readonly totals: {
    readonly replacementCost: string;
    readonly depreciation: string;
    readonly conditionAdjustment: string;
    readonly costValue: string;
    readonly marketValue: string;
    readonly itemCount: number;
  };
  readonly reconciliation: {
    readonly costWeight: string;
    readonly salesWeight: string;
    readonly source: 'PARAMETERS' | 'OVERRIDE' | 'SINGLE_APPROACH';
    readonly rationale: string | null;
    readonly value: string;
    readonly formula: string;
  };
  readonly forcedSale: ForcedSaleResult;
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  readonly notes: readonly string[];
}

// ---------------------------------------------------------------------------
// Cost approach (assumption 3.7)
// ---------------------------------------------------------------------------

function loadingsTotal(params: EngineParameters): {
  percent: Decimal;
  table: Record<string, string>;
} {
  const raw = paramTable<Record<string, string | number>>(params, 'mechanical.cif_loadings');
  const table: Record<string, string> = {};
  let percent = ZERO;
  for (const key of Object.keys(raw).sort()) {
    const value = dec(raw[key] ?? 0);
    table[key] = value.toString();
    percent = percent.plus(value);
  }
  return { percent, table };
}

function valueByCost(
  params: EngineParameters,
  item: MechanicalItemInput,
  valuationDate: Date,
  label: string,
  loadingsPercent: Decimal,
): MechanicalCostOutput {
  let replacementCost: Decimal;
  let replacementFormula: string;
  let cifValue: string | null = null;

  if (item.costBasis === 'CIF') {
    const cif = positive(item.cifValue, `${label}: the CIF value`);
    replacementCost = money(cif.times(HUNDRED.plus(loadingsPercent)).dividedBy(HUNDRED));
    replacementFormula = `CIF ${fmt(cif)} x (1 + loadings ${pct(loadingsPercent)})`;
    cifValue = m(cif);
  } else {
    replacementCost = money(positive(item.replacementQuote, `${label}: the replacement quote`));
    replacementFormula = `quoted price of a new equivalent ${fmt(replacementCost)}`;
  }

  const settings = depreciationSettings(params);
  const age = ageAtValuation(item.manufactureYear, item.effectiveAgeOverride, valuationDate, label);
  const life = tableEntry(
    params,
    'mechanical.economic_life',
    item.equipmentClass,
    'Equipment class',
  );

  if (settings.method === 'AGE_LIFE_CONDITION' && !item.condition) {
    throw new BusinessRuleError(
      'CONDITION_REQUIRED',
      `${label}: the configured depreciation method needs the item's condition grade.`,
    );
  }

  const depreciation = calculateDepreciation(
    {
      method: settings.method,
      baseAmount: replacementCost,
      effectiveAgeYears: age,
      economicLifeYears: life,
      residualPercent: settings.residualPercent,
      condition: item.condition ?? undefined,
      annualRatePercent: settings.annualRatePercent,
    },
    settings.conditionModifiers,
  );

  const adjustmentPercent = dec(item.conditionAdjustmentPercent || '0');
  if (
    adjustmentPercent.lessThanOrEqualTo(HUNDRED.negated()) ||
    adjustmentPercent.greaterThan(HUNDRED)
  ) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      `${label}: the condition adjustment must be above -100% and at most +100%.`,
    );
  }
  const adjusted = money(applyAdjustment(depreciation.depreciatedValue, adjustmentPercent));
  const adjustment = money(adjusted.minus(depreciation.depreciatedValue));
  const remaining = life.minus(age);

  return {
    basis: item.costBasis === 'CIF' ? 'CIF' : 'QUOTE',
    cifValue,
    loadingsPercent: item.costBasis === 'CIF' ? loadingsPercent.toFixed(2) : null,
    replacementCost: m(replacementCost),
    replacementFormula,
    depreciation: {
      method: depreciation.method,
      effectiveAgeYears: depreciation.effectiveAgeYears.toDecimalPlaces(2).toFixed(2),
      economicLifeYears: depreciation.economicLifeYears.toDecimalPlaces(2).toFixed(2),
      residualPercent: depreciation.residualPercent.toFixed(2),
      ratePercent: depreciation.ratePercent.toFixed(4),
      amount: m(depreciation.amount),
      formula: depreciation.formula,
    },
    remainingLifeYears: (remaining.lessThan(ZERO) ? ZERO : remaining).toDecimalPlaces(2).toFixed(2),
    conditionAdjustmentPercent: adjustmentPercent.toFixed(4),
    conditionAdjustment: m(adjustment),
    value: m(adjusted),
    formula:
      `replacement cost ${fmt(replacementCost)} - depreciation ${fmt(depreciation.amount)}` +
      (adjustmentPercent.isZero() ? '' : `, then condition adjustment ${pct(adjustmentPercent)}`),
  };
}

// ---------------------------------------------------------------------------
// Market approach
// ---------------------------------------------------------------------------

function valueByMarket(item: MechanicalItemInput, label: string) {
  const comparables = item.comparables.map((comparable, index) => {
    const compLabel = `${label}, comparable ${index + 1}`;
    const price = positive(comparable.marketPrice, `${compLabel}: the market price`);
    const net = netAdjustment(
      [
        comparable.conditionAdjustment,
        comparable.ageAdjustment,
        comparable.locationAdjustment,
        comparable.otherAdjustment,
      ],
      compLabel,
    );
    return {
      ...comparable,
      netAdjustmentPercent: net.toFixed(4),
      adjustedValue: m(applyAdjustment(price, net)),
    };
  });

  const value = mean(comparables.map((c) => dec(c.adjustedValue)));
  return {
    comparables,
    value: m(value),
    formula:
      `mean of ${comparables.length} comparable${comparables.length === 1 ? '' : 's'}, ` +
      'each market price x (1 + condition + age + location + other adjustments)',
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function calculateMechanical(
  input: MechanicalEngineInput,
  params: EngineParameters,
): MechanicalEngineOutput {
  const notes: string[] = [];
  const valuationDate = new Date(`${input.valuationDate}T00:00:00.000Z`);
  if (Number.isNaN(valuationDate.getTime())) {
    throw new BusinessRuleError('VALUATION_INPUT_INVALID', 'The valuation date is not valid.');
  }
  if (input.items.length === 0) {
    throw new BusinessRuleError(
      'ITEMS_REQUIRED',
      'Register at least one vehicle or machine before calculating.',
    );
  }

  const loadings = loadingsTotal(params);
  // Resolved once, and only when some item actually needs weights, so a case
  // valued on one approach throughout is not blocked by a weight override it
  // does not use.
  let weights: ReturnType<typeof resolveWeights> | null = null;

  const items = input.items.map((item): MechanicalItemOutput => {
    const label = `${item.kind === 'VEHICLE' ? 'Vehicle' : 'Machine'} ${item.itemNumber}`;
    const cost =
      item.costBasis === 'NONE'
        ? null
        : valueByCost(params, item, valuationDate, label, loadings.percent);
    const market = item.comparables.length > 0 ? valueByMarket(item, label) : null;

    if (!cost && !market) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_MISSING',
        `${label}: choose a cost basis or add at least one market comparable.`,
      );
    }

    if (cost && market) {
      weights ??= resolveWeights(params, input.reconciliation);
      const value = reconcile(dec(cost.value), dec(market.value), weights);
      return {
        itemId: item.itemId,
        kind: item.kind,
        itemNumber: item.itemNumber,
        description: item.description,
        equipmentClass: item.equipmentClass,
        cost,
        market,
        costWeight: weights.costWeight.toFixed(2),
        marketWeight: weights.salesWeight.toFixed(2),
        value: m(value),
        formula:
          `cost ${fmt(cost.value)} x ${pct(weights.costWeight)} + market ${fmt(market.value)} x ` +
          `${pct(weights.salesWeight)}`,
      };
    }

    const single = (cost ?? market) as { value: string };
    return {
      itemId: item.itemId,
      kind: item.kind,
      itemNumber: item.itemNumber,
      description: item.description,
      equipmentClass: item.equipmentClass,
      cost,
      market,
      costWeight: cost ? '100.00' : '0.00',
      marketWeight: cost ? '0.00' : '100.00',
      value: m(single.value),
      formula: cost ? 'cost approach only' : 'market approach only',
    };
  });

  const sum = (values: readonly string[]) =>
    money(values.reduce<Decimal>((total, v) => total.plus(dec(v)), ZERO));

  const marketValue = sum(items.map((i) => i.value));
  const totals = {
    replacementCost: m(sum(items.map((i) => i.cost?.replacementCost ?? '0'))),
    depreciation: m(sum(items.map((i) => i.cost?.depreciation.amount ?? '0'))),
    conditionAdjustment: m(sum(items.map((i) => i.cost?.conditionAdjustment ?? '0'))),
    costValue: m(sum(items.map((i) => i.cost?.value ?? '0'))),
    marketValue: m(sum(items.map((i) => i.market?.value ?? '0'))),
    itemCount: items.length,
  };

  const applied = weights as ReturnType<typeof resolveWeights> | null;
  const reconciliation = {
    costWeight: applied ? applied.costWeight.toFixed(2) : '100.00',
    salesWeight: applied ? applied.salesWeight.toFixed(2) : '0.00',
    source: applied ? applied.source : ('SINGLE_APPROACH' as const),
    rationale: applied ? applied.rationale : null,
    value: m(marketValue),
    formula: `sum of ${items.length} item value${items.length === 1 ? '' : 's'}`,
  };

  if (loadings.percent.greaterThan(ZERO) && items.some((i) => i.cost?.basis === 'CIF')) {
    notes.push('CIF loadings await PVD confirmation (assumption 3.7).');
  }

  const forced = forcedSale(params, marketValue, input.forcedSale);

  return {
    formulaVersion: MECHANICAL_FORMULA_VERSION,
    loadings: loadings.table,
    items,
    totals,
    reconciliation,
    forcedSale: forced,
    marketValue: m(marketValue),
    forcedSaleValue: forced.value,
    notes,
  };
}
