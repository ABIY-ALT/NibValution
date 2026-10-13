import { BusinessRuleError, ConfigurationError } from '@/lib/errors';
import { Decimal, HUNDRED, ZERO, dec, money, percentOf, rate, type Numeric } from '@/lib/money';
import {
  CONDITION_GRADES,
  DEPRECIATION_METHODS,
  type ConditionGrade,
  type DepreciationMethod,
} from '../shared/enums';

/**
 * Pieces shared by the civil and mechanical valuation engines (spec sections
 * 9-13): reading parameters, comparable adjustments, reconciliation and the
 * forced-sale value.
 *
 * Every engine function is pure. It takes the complete input and the parameter
 * set in force on the valuation date, and returns every figure together with
 * the formula that produced it. Nothing here reads the database or the clock,
 * which is what lets a stored calculation be re-run years later and produce the
 * identical result (section 28).
 *
 * Figures leave the engines as strings at a fixed scale, never as Decimal or
 * number objects, so an output can be stored as JSON and compared byte for
 * byte with a recomputation.
 */

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/** The parameter set in force on the valuation date, as the engines read it. */
export interface EngineParameters {
  readonly setCode: string;
  readonly setVersion: number;
  readonly values: Readonly<Record<string, string>>;
  readonly tables: Readonly<Record<string, unknown>>;
}

function describeSet(params: EngineParameters): string {
  return `parameter set ${params.setCode} v${params.setVersion}`;
}

/** A numeric parameter. Missing is a configuration fault, never a silent default. */
export function param(params: EngineParameters, key: string): Decimal {
  const raw = params.values[key];
  if (raw === undefined) {
    throw new ConfigurationError(
      `Valuation parameter "${key}" is not defined in ${describeSet(params)}.`,
    );
  }
  return dec(raw);
}

export function paramTable<T>(params: EngineParameters, key: string): T {
  const table = params.tables[key];
  if (table === undefined || table === null) {
    throw new ConfigurationError(
      `Valuation parameter table "${key}" is not defined in ${describeSet(params)}.`,
    );
  }
  return table as T;
}

/** A value from a keyed table, falling back to the table's `DEFAULT` entry. */
export function tableEntry(
  params: EngineParameters,
  key: string,
  entry: string,
  label: string,
): Decimal {
  const table = paramTable<Record<string, Numeric>>(params, key);
  const value = table[entry] ?? table.DEFAULT;
  if (value === undefined) {
    throw new ConfigurationError(
      `${label} "${entry}" has no entry, and no DEFAULT, in table "${key}" of ${describeSet(params)}.`,
    );
  }
  return dec(value);
}

/** The keys a maker may choose from in a keyed table, `DEFAULT` excluded. */
export function tableKeys(tables: Readonly<Record<string, unknown>>, key: string): string[] {
  const table = tables[key];
  if (!table || typeof table !== 'object') return [];
  return Object.keys(table).filter((k) => k !== 'DEFAULT');
}

// ---------------------------------------------------------------------------
// Depreciation settings
// ---------------------------------------------------------------------------

export interface DepreciationSettings {
  readonly method: DepreciationMethod;
  readonly residualPercent: Decimal;
  readonly conditionModifiers: Record<ConditionGrade, string>;
  /** Only read by DECLINING_BALANCE. */
  readonly annualRatePercent?: Decimal;
}

/** The depreciation method, floor and modifiers the parameter set prescribes. */
export function depreciationSettings(params: EngineParameters): DepreciationSettings {
  const configured = paramTable<{ method?: string }>(params, 'depreciation.method').method;
  if (!configured || !(DEPRECIATION_METHODS as readonly string[]).includes(configured)) {
    throw new ConfigurationError(
      `Depreciation method "${String(configured)}" in ${describeSet(params)} is not one of ${DEPRECIATION_METHODS.join(', ')}.`,
    );
  }
  const method = configured as DepreciationMethod;

  const rawModifiers = paramTable<Record<string, Numeric>>(
    params,
    'depreciation.condition_modifiers',
  );
  const conditionModifiers = {} as Record<ConditionGrade, string>;
  for (const grade of CONDITION_GRADES) {
    conditionModifiers[grade] = dec(rawModifiers[grade] ?? '1').toString();
  }

  return {
    method,
    residualPercent: param(params, 'depreciation.residual_percent'),
    conditionModifiers,
    annualRatePercent:
      method === 'DECLINING_BALANCE'
        ? param(params, 'depreciation.annual_rate_percent')
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A money figure as stored: two decimals, half-up. */
export const m = (value: Numeric): string => money(value).toFixed(2);
/** A rate or area as stored: four decimals, half-up. */
export const r4 = (value: Numeric): string =>
  dec(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
/** A quantity or area as shown in formulas: at most four decimals, no trailing zeros. */
export const qty = (value: Numeric): string =>
  dec(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString();
/** A percentage as shown in formulas, without trailing zeros. */
export const pct = (value: Numeric): string => `${dec(value).toDecimalPlaces(4).toString()}%`;
/** An amount as shown in formulas: grouped, two decimals. */
export function fmt(value: Numeric): string {
  const [whole = '0', fraction = '00'] = money(value).toFixed(2).split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  return `${negative ? '-' : ''}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

export function positive(value: Numeric | null | undefined, label: string): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new BusinessRuleError('VALUATION_INPUT_MISSING', `${label} is required.`);
  }
  const d = dec(value);
  if (d.lessThanOrEqualTo(ZERO)) {
    throw new BusinessRuleError('VALUATION_INPUT_INVALID', `${label} must be greater than zero.`);
  }
  return d;
}

export function nonNegative(value: Numeric | null | undefined, label: string): Decimal {
  if (value === null || value === undefined || value === '') {
    throw new BusinessRuleError('VALUATION_INPUT_MISSING', `${label} is required.`);
  }
  const d = dec(value);
  if (d.lessThan(ZERO)) {
    throw new BusinessRuleError('VALUATION_INPUT_INVALID', `${label} cannot be negative.`);
  }
  return d;
}

/**
 * Age at the valuation date, or the valuator's override where a renovation has
 * changed the effective age. The year is read in UTC so the same calculation
 * gives the same age on every server, whatever its time zone.
 */
export function ageAtValuation(
  year: number | null,
  override: string | null,
  valuationDate: Date,
  label: string,
): Decimal {
  if (override !== null) return nonNegative(override, `${label}: the effective age`);
  if (year === null) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      `${label}: record the year, or enter an effective age.`,
    );
  }
  return dec(Math.max(0, valuationDate.getUTCFullYear() - year));
}

// ---------------------------------------------------------------------------
// Comparables
// ---------------------------------------------------------------------------

/**
 * The sum of named percentage adjustments, refusing a total that would take a
 * price to zero or below - an adjustment that large means the comparable is not
 * comparable.
 */
export function netAdjustment(adjustments: readonly Numeric[], label: string): Decimal {
  const net = adjustments.reduce<Decimal>((sum, a) => sum.plus(dec(a)), ZERO);
  if (net.lessThanOrEqualTo(HUNDRED.negated())) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      `${label}: adjustments totalling ${pct(net)} would reduce the price to nothing.`,
    );
  }
  return rate(net);
}

/** `price x (1 + net / 100)`. */
export function applyAdjustment(price: Numeric, netPercent: Numeric): Decimal {
  return dec(price)
    .times(HUNDRED.plus(dec(netPercent)))
    .dividedBy(HUNDRED);
}

/** The arithmetic mean of a non-empty list, at money scale. */
export function mean(values: readonly Decimal[]): Decimal {
  if (values.length === 0) return ZERO;
  return money(values.reduce<Decimal>((sum, v) => sum.plus(v), ZERO).dividedBy(values.length));
}

// ---------------------------------------------------------------------------
// Reconciliation (spec section 11)
// ---------------------------------------------------------------------------

export interface WeightOverride {
  readonly costWeight: string;
  readonly salesWeight: string;
  readonly rationale: string;
}

export interface Weights {
  readonly costWeight: Decimal;
  readonly salesWeight: Decimal;
  readonly source: 'PARAMETERS' | 'OVERRIDE';
  readonly rationale: string | null;
}

/**
 * The cost/sales weights for a valuation using both approaches: the configured
 * defaults, or the maker's override with its justification. Either way the pair
 * must total exactly 100 (the database checks it again).
 */
export function resolveWeights(params: EngineParameters, override: WeightOverride | null): Weights {
  if (override) {
    const costWeight = dec(override.costWeight);
    const salesWeight = dec(override.salesWeight);
    if (
      costWeight.lessThan(ZERO) ||
      salesWeight.lessThan(ZERO) ||
      !costWeight.plus(salesWeight).equals(HUNDRED)
    ) {
      throw new BusinessRuleError(
        'WEIGHTS_INVALID',
        'Reconciliation weights must each be between 0 and 100 and total exactly 100.',
      );
    }
    if (override.rationale.trim().length < 10) {
      throw new BusinessRuleError(
        'WEIGHTS_RATIONALE_REQUIRED',
        'Explain why the configured reconciliation weights are being overridden (10 characters minimum).',
      );
    }
    return { costWeight, salesWeight, source: 'OVERRIDE', rationale: override.rationale.trim() };
  }

  const costWeight = param(params, 'reconciliation.cost_weight');
  const salesWeight = param(params, 'reconciliation.sales_weight');
  if (!costWeight.plus(salesWeight).equals(HUNDRED)) {
    throw new ConfigurationError(
      `Reconciliation weights in ${describeSet(params)} total ${costWeight.plus(salesWeight).toString()}, not 100.`,
    );
  }
  return { costWeight, salesWeight, source: 'PARAMETERS', rationale: null };
}

/** `cost x wc / 100 + sales x ws / 100`, at money scale. */
export function reconcile(cost: Decimal, sales: Decimal, weights: Weights): Decimal {
  return money(
    cost
      .times(weights.costWeight)
      .dividedBy(HUNDRED)
      .plus(sales.times(weights.salesWeight).dividedBy(HUNDRED)),
  );
}

// ---------------------------------------------------------------------------
// Forced sale (spec section 12)
// ---------------------------------------------------------------------------

export interface ForcedSaleOverride {
  readonly percent: string;
  readonly reason: string;
}

export interface ForcedSaleResult {
  readonly marketValue: string;
  readonly percent: string;
  readonly isOverridden: boolean;
  readonly reason: string | null;
  readonly value: string;
  readonly formula: string;
}

/**
 * Forced-sale value as a percentage of market value. The configured percentage
 * applies unless the maker overrides it, and an override is meaningless without
 * a justification (assumption 3.4; the database requires it too).
 *
 * The civil engine passes `prescribed`: the guideline gives the percentage by
 * city and land purpose, so it does not come from `forced_sale.percent`.
 */
export function forcedSale(
  params: EngineParameters,
  marketValue: Decimal,
  override: ForcedSaleOverride | null,
  prescribed?: { readonly percent: Decimal; readonly basis: string },
): ForcedSaleResult {
  let percent: Decimal;
  let reason: string | null = null;

  if (override) {
    percent = dec(override.percent);
    if (percent.lessThan(ZERO) || percent.greaterThan(HUNDRED)) {
      throw new BusinessRuleError(
        'FORCED_SALE_INVALID',
        'The forced-sale percentage must be between 0 and 100.',
      );
    }
    reason = override.reason.trim();
    if (reason.length < 10) {
      throw new BusinessRuleError(
        'FORCED_SALE_REASON_REQUIRED',
        'Explain why the configured forced-sale percentage is being overridden (10 characters minimum).',
      );
    }
  } else {
    percent = prescribed ? prescribed.percent : param(params, 'forced_sale.percent');
  }

  const value = percentOf(marketValue, percent);
  return {
    marketValue: m(marketValue),
    percent: dec(percent).toDecimalPlaces(2).toFixed(2),
    isOverridden: override !== null,
    reason,
    value: m(value),
    formula:
      `market value ${fmt(marketValue)} x ${pct(percent)}` +
      (override
        ? ' (overridden by the valuator)'
        : prescribed
          ? ` (${prescribed.basis})`
          : ' (configured percentage)'),
  };
}
