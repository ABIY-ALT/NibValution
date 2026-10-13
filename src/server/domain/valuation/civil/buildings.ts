import { BusinessRuleError } from '@/lib/errors';
import { Decimal, HUNDRED, ZERO, dec } from '@/lib/money';
import { fmt, m, nonNegative, positive, qty, r4 } from '../common';
import { excelEquals, excelIncludes, excelLookup } from './excel';
import type { Grade, Guideline } from './guideline';
import { f6 } from './land';
import type {
  BuildingStageOutput,
  CivilBuildingInput,
  CivilBuildingOutput,
  ComponentOutput,
  DefectOutput,
  NewComponentOutput,
  PricedItemOutput,
} from './types';

/**
 * Depreciated replacement cost of a building (CALCULATION_SPEC section 2;
 * COST APPROACH FOR COMPLETED rows 10-233, and the same rows of COST APPROACH
 * FOR PROGRESS for a building under construction).
 *
 *   component cost   grade's cost curve at the building's size
 *                    x the component's weight x the share of the building it makes up
 *   area rate        sum of the components, x 1.2 outside Addis Ababa
 *   depreciation     sum of each recorded defect's rate x how much is affected
 *   DRC              depreciated rate x floor area of every identical building
 *                    (volume-rated halls and factories: x 4, +20% per metre above 4 m)
 *                  + supplementary works at quantity x rate
 */

const ONE = new Decimal(1);

/** A percentage 0-100 typed by the valuator, as a fraction. */
export function fractionOf(value: string | null | undefined, label: string): Decimal {
  const percent = nonNegative(value, label);
  if (percent.greaterThan(HUNDRED)) {
    throw new BusinessRuleError('VALUATION_INPUT_INVALID', `${label} cannot exceed 100%.`);
  }
  return percent.dividedBy(HUNDRED);
}

const percentText = (fraction: Decimal): string =>
  fraction.times(HUNDRED).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

function curveGrade(grade: string): Grade {
  if (excelEquals(grade, 'Luxury')) return 'Luxury';
  if (excelEquals(grade, 'Excellent')) return 'Excellent';
  if (excelEquals(grade, 'Good')) return 'Good';
  return 'minimum';
}

export interface BuildingResult {
  readonly output: CivilBuildingOutput;
  readonly completeValue: Decimal;
  readonly currentValue: Decimal;
  readonly replacementCost: Decimal;
  readonly depreciation: Decimal;
  /** Built-up and floor area of every identical building, m². */
  readonly builtUpArea: Decimal;
  readonly floorArea: Decimal;
}

export function valueBuilding(args: {
  guideline: Guideline;
  building: CivilBuildingInput;
  isAddis: boolean;
  /** Whether the valuation reports the property as it stands (any building under construction). */
  progressMode: boolean;
  notes: string[];
}): BuildingResult {
  const { guideline, building, notes } = args;
  const label = `Building ${building.buildingNumber}`;
  const rules = guideline.buildingRules;

  const curveEntry = building.costType.trim()
    ? excelLookup(guideline.costCurves.curves, building.costType)
    : null;
  const catalogue = curveEntry
    ? excelLookup(guideline.components.components, curveEntry.name)
    : null;
  if (!curveEntry || !catalogue) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      building.costType.trim()
        ? `${label}: "${building.costType}" is not a building type in the guideline.`
        : `${label}: choose its building type.`,
    );
  }
  const costType = curveEntry.name;
  const curves = curveEntry.value;

  if (!building.floorArea) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      `${label} has no gross (total floor) area, so it cannot be valued. Edit it in step 1 (Land and buildings), enter its gross area, then calculate again.`,
    );
  }
  const floorArea = positive(building.floorArea, `${label}: the gross area`);
  const count = positive(building.count, `${label}: the number of identical buildings`);
  const builtUp = building.builtUpArea
    ? nonNegative(building.builtUpArea, `${label}: the built-up area`)
    : null;

  const volumeRated = excelIncludes(rules.volumeRatedTypes, costType);
  const heightAdjusted = excelIncludes(rules.heightAdjustedTypes, costType);
  const height =
    volumeRated || heightAdjusted
      ? positive(building.heightM, `${label}: the height of a ${costType} building`)
      : building.heightM
        ? positive(building.heightM, `${label}: the height`)
        : null;
  const driver = volumeRated ? floorArea.times(height!) : floorArea;
  const rateAt = (grade: string): Decimal => {
    const [a, b, c] = curves[curveGrade(grade)];
    return dec(a).times(driver).times(driver).plus(dec(b).times(driver)).plus(c);
  };

  // --- components ---------------------------------------------------------
  const underConstruction = building.constructionStatus === 'UNDER_CONSTRUCTION';
  const defaultCompletion = underConstruction
    ? fractionOf(building.progressPercent ?? '0', `${label}: the registered completion`)
    : ONE;
  const completionOf = (value: string | null, what: string): Decimal =>
    underConstruction && value !== null
      ? fractionOf(value, `${label}, ${what}: the completion`)
      : defaultCompletion;

  if (building.components.length === 0 && building.newComponents.length === 0) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      `${label}: select the components it is built of and the share each makes up.`,
    );
  }

  const byRow = new Map(catalogue.value.map((c) => [c.row, c]));
  const seen = new Set<number>();
  const shareByGroup = new Map<string, Decimal>();
  let completeRate = ZERO;
  let currentRate = ZERO;

  const components: ComponentOutput[] = building.components.map((input) => {
    const entry = byRow.get(input.row);
    if (!entry) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        `${label}: component ${input.row} is not in the guideline's ${costType} list. Choose the building's components again.`,
      );
    }
    if (seen.has(input.row)) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        `${label}: "${entry.name}" is entered twice.`,
      );
    }
    seen.add(input.row);

    const share = fractionOf(input.sharePercent, `${label}, ${entry.name}: the share`);
    const completion = completionOf(input.completionPercent, entry.name);
    const unitRate = rateAt(entry.grade);
    const cost = unitRate.times(entry.weight).times(share);
    const currentCost = cost.times(completion);
    completeRate = completeRate.plus(cost);
    currentRate = currentRate.plus(currentCost);

    const group = entry.part ? `${entry.element} - ${entry.part}` : entry.element;
    shareByGroup.set(group, (shareByGroup.get(group) ?? ZERO).plus(share));

    return {
      row: entry.row,
      element: entry.element,
      part: entry.part,
      name: entry.name,
      grade: entry.grade,
      weightPercent: percentText(dec(entry.weight)),
      sharePercent: percentText(share),
      completionPercent: percentText(completion),
      unitRate: r4(unitRate),
      cost: r4(cost),
      currentCost: r4(currentCost),
    };
  });

  for (const [group, share] of shareByGroup) {
    if (share.greaterThan(ONE)) {
      notes.push(
        `${label}: the components under "${group}" add up to ${percentText(share)}% of the building. Check the shares.`,
      );
    }
  }

  const newComponents: NewComponentOutput[] = building.newComponents.map((input, index) => {
    const what = input.description?.trim() || input.category || `new component ${index + 1}`;
    const unitRate = nonNegative(input.unitRate, `${label}, ${what}: the unit price`);
    const share = fractionOf(input.sharePercent, `${label}, ${what}: the share`);
    const completion = completionOf(input.completionPercent, what);
    const cost = unitRate.times(share);
    const currentCost = cost.times(completion);
    completeRate = completeRate.plus(cost);
    currentRate = currentRate.plus(currentCost);
    return {
      category: input.category,
      description: input.description,
      unitRate: r4(unitRate),
      sharePercent: percentText(share),
      completionPercent: percentText(completion),
      cost: r4(cost),
      currentCost: r4(currentCost),
    };
  });

  // --- depreciation -------------------------------------------------------
  const defectTable = guideline.defects;
  const workbookCategory =
    excelLookup(defectTable.categoryByType, costType)?.value ?? defectTable.defaultCategory;
  const correctedCategory =
    excelLookup(defectTable.correctedCategoryByType, costType)?.value ??
    defectTable.defaultCategory;
  const category = guideline.fixes.multiStoreyDefectRates ? correctedCategory : workbookCategory;
  const defectByCode = new Map(defectTable.defects.map((d) => [d.code, d]));
  const seenDefects = new Set<number>();
  let depreciationShare = ZERO;
  let otherShare = ZERO;
  // The progress sheet records only some defects (its own list); a building's
  // value as it stands is depreciated for those alone, as in the workbook.
  const progressCodes =
    defectTable.progressCodes && !guideline.fixes.progressFloorDefects
      ? new Set(defectTable.progressCodes)
      : null;
  let currentShare = ZERO;
  const defects: DefectOutput[] = building.defects.map((input) => {
    const entry = defectByCode.get(input.code);
    if (!entry) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        `${label}: condition defect ${input.code} is not in the guideline's list.`,
      );
    }
    if (seenDefects.has(input.code)) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        `${label}: the defect "${entry.label}" is entered twice.`,
      );
    }
    seenDefects.add(input.code);
    const affected = fractionOf(input.percent, `${label}, ${entry.label}: the affected share`);
    const rate = dec(entry.rates[category] ?? 0);
    const part = rate.times(affected);
    depreciationShare = depreciationShare.plus(part);
    if (!progressCodes || progressCodes.has(entry.code)) currentShare = currentShare.plus(part);
    const otherCategory = category === workbookCategory ? correctedCategory : workbookCategory;
    otherShare = otherShare.plus(dec(entry.rates[otherCategory] ?? 0).times(affected));
    return {
      code: entry.code,
      group: entry.group,
      label: entry.label,
      ratePercent: percentText(rate),
      percent: percentText(affected),
      depreciationPercent: percentText(part),
    };
  });
  if (depreciationShare.greaterThan(ONE)) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      `${label}: the recorded defects depreciate it by more than 100%.`,
    );
  }
  if (workbookCategory !== correctedCategory && !otherShare.equals(depreciationShare)) {
    notes.push(
      guideline.fixes.multiStoreyDefectRates
        ? `${label}: depreciation ${percentText(depreciationShare)}% uses the ${category} defect rates; the Excel workbook uses the ${workbookCategory} rates for every ${costType} building (${percentText(otherShare)}%) (guideline issue 3, corrected by switch).`
        : `${label}: depreciation ${percentText(depreciationShare)}% uses the ${category} defect rates, as the Excel workbook does for every ${costType} building; the ${correctedCategory} rates give ${percentText(otherShare)}% (guideline issue 3).`,
    );
  }

  // --- supplementary works on the building --------------------------------
  const supplementary: PricedItemOutput[] = [];
  let supplementaryComplete = ZERO;
  let supplementaryCurrent = ZERO;
  building.supplementary.forEach((input, index) => {
    const what = `${label}, supplementary work ${index + 1}`;
    const entry = guideline.supplementary.items.find((i) => excelEquals(i.name, input.item));
    if (!entry) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        input.item.trim()
          ? `${what}: "${input.item}" is not in the guideline's supplementary works.`
          : `${what}: choose the work.`,
      );
    }
    const quantity = nonNegative(input.quantity, `${what}: the quantity`);
    const completion =
      underConstruction && input.completionPercent !== null
        ? fractionOf(input.completionPercent, `${what}: the completion`)
        : ONE;
    const amount = quantity.times(entry.rate);
    const currentAmount = amount.times(completion);
    supplementaryComplete = supplementaryComplete.plus(amount);
    supplementaryCurrent = supplementaryCurrent.plus(currentAmount);
    supplementary.push({
      item: entry.name,
      description: null,
      kind: 'RATE',
      rate: r4(entry.rate),
      quantity: r4(quantity),
      completionPercent: percentText(completion),
      amount: m(amount),
      currentAmount: m(currentAmount),
      formula: `${qty(quantity)} x ${fmt(entry.rate)}`,
    });
  });

  // --- depreciated replacement cost ---------------------------------------
  const locationFactor = args.isAddis ? ONE : dec(rules.outsideAddisFactor);
  const allFloorArea = floorArea.times(count);
  const costedArea = heightAdjusted
    ? allFloorArea.times(rules.heightAdjustedAreaMultiplier)
    : allFloorArea;
  const heightFactor = heightAdjusted
    ? ONE.plus(height!.minus(rules.baseHeight).times(rules.upliftPerMetre))
    : ONE;

  const stage = (
    componentRate: Decimal,
    supplementaryTotal: Decimal,
    share: Decimal,
  ): {
    output: BuildingStageOutput;
    value: Decimal;
    replacement: Decimal;
    depreciation: Decimal;
  } => {
    const areaRate = componentRate.times(locationFactor);
    const depreciatedRate = areaRate.minus(share.times(areaRate));
    const replacement = areaRate.times(costedArea).times(heightFactor);
    const depreciatedCost = depreciatedRate.times(costedArea).times(heightFactor);
    const value = depreciatedCost.plus(supplementaryTotal);
    return {
      output: {
        componentRate: r4(componentRate),
        areaRate: r4(areaRate),
        depreciatedRate: r4(depreciatedRate),
        replacementCost: m(replacement),
        depreciation: m(replacement.minus(depreciatedCost)),
        depreciatedCost: m(depreciatedCost),
        supplementaryTotal: m(supplementaryTotal),
        value: m(value),
      },
      value,
      replacement,
      depreciation: replacement.minus(depreciatedCost),
    };
  };

  const complete = stage(completeRate, supplementaryComplete, depreciationShare);
  // A property under construction is reported from the progress sheet, which
  // holds every building - finished ones too - with its own defect list.
  const current = args.progressMode
    ? stage(currentRate, supplementaryCurrent, currentShare)
    : complete;
  if (args.progressMode && !currentShare.equals(depreciationShare)) {
    notes.push(
      `${label}: as it stands it is depreciated ${percentText(currentShare)}%, not ${percentText(depreciationShare)}%: the Excel progress sheet cannot record floor-finish defects.`,
    );
  }
  const reported = args.progressMode ? current : complete;

  if (building.constructionStatus === 'ABANDONED') {
    notes.push(
      `${label} is recorded as abandoned and is valued as a standing structure; record its defects so its condition is reflected.`,
    );
  }

  const sizeText = volumeRated
    ? `${qty(floorArea)} m² x ${qty(height!)} m = ${qty(driver)} m³`
    : `${qty(floorArea)} m²`;
  const formula =
    `component rates at ${sizeText} sum to ${fmt(dec(reported.output.componentRate))}` +
    (locationFactor.equals(ONE) ? '' : ` x ${locationFactor.toString()} outside Addis Ababa`) +
    (depreciationShare.isZero() ? '' : ` - ${percentText(depreciationShare)}% depreciation`) +
    ` = ${fmt(dec(reported.output.depreciatedRate))} per m²; x ${qty(costedArea)} m²` +
    (heightAdjusted
      ? ` (${qty(allFloorArea)} m² x ${rules.heightAdjustedAreaMultiplier}) x ${heightFactor.toString()} for ${qty(height!)} m height`
      : count.equals(ONE)
        ? ''
        : ` (${qty(count)} buildings)`) +
    (dec(reported.output.supplementaryTotal).isZero()
      ? ''
      : ` + supplementary works ${fmt(dec(reported.output.supplementaryTotal))}`);

  return {
    output: {
      buildingId: building.buildingId,
      buildingNumber: building.buildingNumber,
      name: building.name,
      costType,
      constructionStatus: building.constructionStatus,
      count: r4(count),
      floorArea: r4(floorArea),
      builtUpArea: builtUp ? r4(builtUp) : null,
      heightM: height ? r4(height) : null,
      rateBasis: volumeRated ? 'VOLUME' : 'AREA',
      rateDriver: r4(driver),
      components,
      newComponents,
      locationFactor: f6(locationFactor),
      defectCategory: category,
      defects,
      depreciationPercent: percentText(depreciationShare),
      costedArea: r4(costedArea),
      heightFactor: f6(heightFactor),
      supplementary,
      complete: complete.output,
      current: current.output,
      completionPercent: complete.value.isZero()
        ? '0.0000'
        : percentText(current.value.dividedBy(complete.value)),
      value: reported.output.value,
      formula,
    },
    completeValue: complete.value,
    currentValue: current.value,
    replacementCost: reported.replacement,
    depreciation: reported.depreciation,
    builtUpArea: builtUp ? builtUp.times(count) : ZERO,
    floorArea: allFloorArea,
  };
}
