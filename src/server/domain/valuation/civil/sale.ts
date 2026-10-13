import { Decimal, ZERO, dec } from '@/lib/money';
import { fmt, m, qty, r4 } from '../common';
import { excelEquals, excelIncludes } from './excel';
import type { Guideline } from './guideline';
import type { SalesOutput } from './types';

/**
 * The sale approach (CALCULATION_SPEC section 6; sheet "SALE APPROACH").
 *
 * Not a comparison of individual sales: the guideline gives a regression,
 * fitted to Addis Ababa residential sales, on the plot area, the built-up and
 * floor areas, the cost rate and the location rate. It applies to a
 * residential building, a condominium unit or an apartment unit in Addis
 * Ababa, and to nothing else.
 */

export interface SaleResult {
  readonly output: Omit<SalesOutput, 'indicatedValue'>;
  /** Sale value of the property complete; zero where the approach does not apply. */
  readonly value: Decimal;
}

export function valueBySale(args: {
  guideline: Guideline;
  cityName: string;
  purpose: string;
  propertyType: string;
  floorLevel: number | null;
  plotArea: Decimal;
  /** Cost types of the buildings, in building order. */
  costTypes: readonly string[];
  /** Total floor and built-up area of every building, m². */
  floorArea: Decimal;
  builtUpArea: Decimal;
  /** Depreciated replacement cost of the buildings plus plot civil works, complete. */
  developmentCost: Decimal;
  /** Location value before staging. */
  locationValue: Decimal;
  notes: string[];
}): SaleResult {
  const rules = args.guideline.saleApproach;
  const none = (reason: string): SaleResult => ({
    output: {
      applicable: false,
      reason,
      model: null,
      variables: null,
      valueAtCompletion: m(ZERO),
      formula: reason,
    },
    value: ZERO,
  });

  if (!excelEquals(args.cityName, rules.city)) {
    return none(`The sale approach applies in ${rules.city} only.`);
  }
  if (
    !excelEquals(args.purpose, rules.purpose) ||
    !excelIncludes(rules.propertyTypes, args.propertyType)
  ) {
    return none('The sale approach applies to residential property only.');
  }
  const excluded = args.costTypes.find((t) => excelIncludes(rules.excludedBuildingTypes, t));
  if (excluded) {
    return none(`The sale approach does not apply to a plot with a ${excluded} building.`);
  }
  if (args.floorArea.isZero()) {
    return none('The sale approach needs a building: no floor area is recorded.');
  }

  const costRate = args.developmentCost.dividedBy(args.floorArea);
  const locationRate = args.locationValue.dividedBy(args.plotArea);
  const variables = {
    plotArea: r4(args.plotArea),
    floorArea: r4(args.floorArea),
    builtUpArea: r4(args.builtUpArea),
    floorLevel: args.floorLevel === null ? null : String(args.floorLevel),
    costRate: r4(costRate),
    locationRate: r4(locationRate),
  };

  let model: SalesOutput['model'];
  let value: Decimal;
  let formula: string;

  if (excelEquals(args.propertyType, 'Residential Building')) {
    const c = rules.residentialBuilding;
    model = 'RESIDENTIAL_BUILDING';
    value = dec(c.intercept)
      .plus(dec(c.plotArea).times(args.plotArea))
      .plus(dec(c.builtUpArea).times(args.builtUpArea))
      .plus(dec(c.floorArea).times(args.floorArea))
      .plus(dec(c.costRate).times(costRate))
      .plus(dec(c.locationRate).times(locationRate));
    formula =
      `${fmt(c.intercept)} + ${fmt(c.plotArea)} x plot ${qty(args.plotArea)} m² + ` +
      `${fmt(c.builtUpArea)} x built-up ${qty(args.builtUpArea)} m² + ` +
      `${fmt(c.floorArea)} x floor ${qty(args.floorArea)} m² + ` +
      `${c.costRate} x cost rate ${fmt(costRate)} + ${c.locationRate} x location rate ${fmt(locationRate)}`;
  } else {
    // The unit's formula is read only where the first building is itself
    // priced as a condominium or an apartment (SALE APPROACH!H11, HOME!J6).
    if (!excelEquals(args.costTypes[0] ?? '', args.propertyType)) {
      return none(
        `The sale approach for a ${args.propertyType.toLowerCase()} needs building 1 to be priced as a ${args.propertyType}.`,
      );
    }
    const c = rules.condominium;
    const level = dec(args.floorLevel ?? 0);
    const regression = dec(c.intercept)
      .plus(dec(c.floorArea).times(args.floorArea))
      .plus(dec(c.costRate).times(costRate))
      .plus(dec(c.locationRate).times(locationRate))
      .plus(dec(c.floorLevel).times(level));
    const small =
      args.floorArea.lessThan(rules.smallUnit.floorAreaBelow) &&
      regression.lessThan(rules.smallUnit.valueBelow);
    value = small
      ? args.floorArea.times(costRate.plus(locationRate)).times(rules.smallUnit.factor)
      : regression;
    formula = small
      ? `floor ${qty(args.floorArea)} m² x (cost rate ${fmt(costRate)} + location rate ${fmt(locationRate)}) x ${rules.smallUnit.factor} (unit under ${rules.smallUnit.floorAreaBelow} m²)`
      : `${fmt(c.intercept)} + ${fmt(c.floorArea)} x floor ${qty(args.floorArea)} m² + ` +
        `${c.costRate} x cost rate ${fmt(costRate)} + ${c.locationRate} x location rate ${fmt(locationRate)} ` +
        `- ${fmt(dec(c.floorLevel).abs())} x floor level ${level.toString()}`;
    if (excelEquals(args.propertyType, 'Apartment')) {
      model = 'APARTMENT';
      value = value.times(rules.apartmentFactor);
      formula = `(${formula}) x ${rules.apartmentFactor}`;
    } else {
      model = 'CONDOMINIUM';
    }
  }

  if (value.lessThanOrEqualTo(ZERO)) {
    args.notes.push(
      `The sale-approach regression gives ${fmt(value)} for this property, which is not a value; the cost approach is used alone.`,
    );
    return {
      output: {
        applicable: false,
        reason: 'The sale-approach regression gives no positive value for this property.',
        model,
        variables,
        valueAtCompletion: m(ZERO),
        formula,
      },
      value: ZERO,
    };
  }

  return {
    output: {
      applicable: true,
      reason: `${args.propertyType} in ${rules.city} on residential land.`,
      model,
      variables,
      valueAtCompletion: m(value),
      formula,
    },
    value,
  };
}
