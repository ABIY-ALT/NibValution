import { BusinessRuleError } from '@/lib/errors';
import {
  Decimal,
  HUNDRED,
  ZERO,
  assertNonNegative,
  assertPercent,
  dec,
  divide,
  money,
  percentOf,
  rate,
  type Numeric,
} from '@/lib/money';
import type { ConditionGrade, DepreciationMethod } from '../shared/enums';

/**
 * Depreciation (spec section 9).
 *
 * The method and every rate are configuration, not code (assumption 3.3): PVD
 * has yet to confirm which method is approved, so all three are implemented and
 * selected per property category from `ValuationParameter`.
 *
 * Every result carries the formula that produced it as a human-readable string,
 * because the report must show the working (section 9) and an auditor must be
 * able to check it without reading TypeScript.
 */

export interface DepreciationInput {
  readonly method: DepreciationMethod;
  /** Replacement cost new - the amount being depreciated. */
  readonly baseAmount: Numeric;
  readonly effectiveAgeYears: Numeric;
  readonly economicLifeYears: Numeric;
  /** Floor as a percentage of base; the asset never depreciates below this. */
  readonly residualPercent?: Numeric;
  /** Required by AGE_LIFE_CONDITION; ignored by the other methods. */
  readonly condition?: ConditionGrade;
  /** Required by DECLINING_BALANCE: annual rate as a percentage. */
  readonly annualRatePercent?: Numeric;
}

export interface DepreciationResult {
  readonly method: DepreciationMethod;
  readonly baseAmount: Decimal;
  readonly effectiveAgeYears: Decimal;
  readonly economicLifeYears: Decimal;
  readonly residualPercent: Decimal;
  /** Total depreciation as a percentage of base, after the residual floor. */
  readonly ratePercent: Decimal;
  readonly amount: Decimal;
  /** Base less depreciation. */
  readonly depreciatedValue: Decimal;
  readonly formula: string;
}

/**
 * Condition modifiers for AGE_LIFE_CONDITION. A well-maintained building is
 * effectively younger than its calendar age; a poor one, older. Seeded as
 * configuration so PVD can tune them without a release.
 */
export const DEFAULT_CONDITION_MODIFIERS: Record<ConditionGrade, string> = {
  EXCELLENT: '0.70',
  VERY_GOOD: '0.85',
  GOOD: '1.00',
  FAIR: '1.15',
  POOR: '1.35',
  SCRAP: '1.00',
};

export function calculateDepreciation(
  input: DepreciationInput,
  conditionModifiers: Record<ConditionGrade, string> = DEFAULT_CONDITION_MODIFIERS,
): DepreciationResult {
  const baseAmount = money(assertNonNegative(input.baseAmount, 'Replacement cost'));
  const effectiveAge = assertNonNegative(input.effectiveAgeYears, 'Effective age');
  const economicLife = dec(input.economicLifeYears);
  const residualPercent = assertPercent(input.residualPercent ?? 0, 'Residual percentage');

  if (economicLife.lessThanOrEqualTo(ZERO)) {
    throw new BusinessRuleError(
      'INVALID_ECONOMIC_LIFE',
      'Economic life must be greater than zero years to compute depreciation.',
    );
  }

  const maximumPercent = HUNDRED.minus(residualPercent);

  let rawPercent: Decimal;
  let formula: string;

  switch (input.method) {
    case 'STRAIGHT_LINE': {
      rawPercent = rate(effectiveAge.dividedBy(economicLife).times(HUNDRED));
      formula = `(effective age ${effectiveAge.toString()} / economic life ${economicLife.toString()}) x 100`;
      break;
    }

    case 'AGE_LIFE_CONDITION': {
      if (!input.condition) {
        throw new BusinessRuleError(
          'CONDITION_REQUIRED',
          'The age-life method requires a condition grade for the property.',
        );
      }
      const modifier = dec(conditionModifiers[input.condition]);
      const adjustedAge = effectiveAge.times(modifier);
      rawPercent = rate(adjustedAge.dividedBy(economicLife).times(HUNDRED));
      formula =
        `(effective age ${effectiveAge.toString()} x condition factor ${modifier.toString()} ` +
        `[${input.condition}] / economic life ${economicLife.toString()}) x 100`;
      break;
    }

    case 'DECLINING_BALANCE': {
      if (input.annualRatePercent === undefined) {
        throw new BusinessRuleError(
          'ANNUAL_RATE_REQUIRED',
          'The declining-balance method requires an annual depreciation rate.',
        );
      }
      const annualRate = assertPercent(input.annualRatePercent, 'Annual depreciation rate');
      // Remaining fraction = (1 - r)^age; depreciation = 1 - that.
      const remainingFraction = HUNDRED.minus(annualRate)
        .dividedBy(HUNDRED)
        .pow(effectiveAge.toNumber());
      rawPercent = rate(HUNDRED.minus(remainingFraction.times(HUNDRED)));
      formula =
        `(1 - (1 - ${annualRate.toString()}%)^${effectiveAge.toString()}) x 100 ` +
        `[declining balance]`;
      break;
    }
  }

  // Clamp: never below zero, never past the residual floor.
  let ratePercent = rawPercent;
  if (ratePercent.lessThan(ZERO)) ratePercent = ZERO;
  if (ratePercent.greaterThan(maximumPercent)) {
    ratePercent = maximumPercent;
    formula += ` (capped at ${maximumPercent.toString()}% by a ${residualPercent.toString()}% residual floor)`;
  }

  const amount = percentOf(baseAmount, ratePercent);
  const depreciatedValue = money(baseAmount.minus(amount));

  return {
    method: input.method,
    baseAmount,
    effectiveAgeYears: effectiveAge,
    economicLifeYears: economicLife,
    residualPercent,
    ratePercent: rate(ratePercent),
    amount,
    depreciatedValue,
    formula,
  };
}

/**
 * Effective age from a construction year. Kept separate from the depreciation
 * itself so a Maker can override the age where a renovation has genuinely
 * extended the life of a building - a judgement the calendar cannot make.
 */
export function effectiveAgeFromYear(
  constructionYear: number,
  valuationDate: Date,
  overrideAgeYears?: Numeric,
): Decimal {
  if (overrideAgeYears !== undefined) {
    return assertNonNegative(overrideAgeYears, 'Effective age override');
  }
  const age = valuationDate.getFullYear() - constructionYear;
  return age < 0 ? ZERO : dec(age);
}

/** Remaining useful life, floored at zero. */
export function remainingUsefulLife(
  effectiveAgeYears: Numeric,
  economicLifeYears: Numeric,
): Decimal {
  const remaining = dec(economicLifeYears).minus(dec(effectiveAgeYears));
  return remaining.lessThan(ZERO) ? ZERO : remaining.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Proportion of life already consumed, as a percentage. Useful for reporting. */
export function lifeConsumedPercent(
  effectiveAgeYears: Numeric,
  economicLifeYears: Numeric,
): Decimal {
  const life = dec(economicLifeYears);
  if (life.lessThanOrEqualTo(ZERO)) return HUNDRED;
  const consumed = divide(dec(effectiveAgeYears).times(HUNDRED), life, 4);
  return consumed.greaterThan(HUNDRED) ? HUNDRED : consumed;
}
