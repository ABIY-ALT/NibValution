import { BusinessRuleError } from '@/lib/errors';
import { Decimal, HUNDRED, ZERO, dec, money } from '@/lib/money';
import { fmt, forcedSale, m, pct, r4, type EngineParameters } from './common';
import { valueBuilding } from './civil/buildings';
import { excelEquals, excelIncludes, excelLookup } from './civil/excel';
import { readGuideline, type Guideline } from './civil/guideline';
import { f6, resolveCity, stageLocation, valueLocation } from './civil/land';
import { valueBySale } from './civil/sale';
import { valueSiteWorks } from './civil/site-works';
import type {
  CivilEngineInput,
  CivilEngineOutput,
  ProgressOutput,
  ReconciliationOutput,
} from './civil/types';

export type {
  CivilBuildingInput,
  CivilBuildingOutput,
  CivilEngineInput,
  CivilEngineOutput,
  CivilLandInput,
  CivilLocationInput,
  CivilWorkInput,
  ComponentInput,
  DefectInput,
  NewComponentInput,
  QuantityItemInput,
} from './civil/types';

/**
 * The civil valuation engine: the bank's property valuation guideline, as its
 * Excel estimation template calculates it (docs/guideline/v4.2/CALCULATION_SPEC.md).
 *
 *   buildings        depreciated replacement cost of each, from the guideline's
 *                    cost curves, component weights and defect rates
 * + site works       plot civil works, fuel station and coffee site works
 *   x MCF            market condition factor for the city and land purpose
 * + location value   zone or city rate, plot-size tiers and location factors,
 *                    on the free-hold or lease rule, staged against what stands
 *                    on the plot
 * = cost approach
 *
 *   sale approach    the guideline's regression, for Addis Ababa residences
 *
 *   market value     the two reconciled by the guideline's weights
 *   forced-sale      market value x the city's foreclosure percentage
 *
 * Every rate, factor and table the calculation reads is a `guideline.*`
 * parameter; nothing is typed in by the valuator but what was measured or
 * observed. By default the figures match the Excel workbook's, known slips
 * included - each correction is a switch in `excel_fixes.switches`, off until
 * the valuation unit approves it (CALCULATION_SPEC section 11).
 */

export const CIVIL_FORMULA_VERSION = 'civil-2.0.0';

const percentText = (fraction: Decimal): string =>
  fraction.times(HUNDRED).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

/**
 * The grades of the report's "range of land holding rate" (REPORT-COMPLETED!
 * E46:I46): the rate at 100%, 90%, 80%, 70% and 60%. A way of quoting the
 * rate, not a figure that prices anything.
 */
const RATE_GRADES = ['1', '0.9', '0.8', '0.7', '0.6'] as const;

function chosen(list: readonly string[], value: string, missing: string, invalid: string): string {
  const hit = list.find((item) => excelEquals(item, value));
  if (!hit) {
    throw new BusinessRuleError(
      value.trim() ? 'VALUATION_INPUT_INVALID' : 'VALUATION_INPUT_MISSING',
      value.trim() ? invalid : missing,
    );
  }
  return hit;
}

/** The guideline's cost/sale weights for a completed property (REPORT-COMPLETED!H137:H138). */
function completedWeights(
  guideline: Guideline,
  propertyType: string,
  zoneGrade: string | null,
  costValue: Decimal,
  salesValue: Decimal,
): { cost: number; sales: number; rule: string } {
  const rules = guideline.reconciliation.completed;
  if (salesValue.lessThan(costValue)) {
    return {
      cost: 0,
      sales: 100,
      rule: 'the sale value is below the cost value, so it is taken alone',
    };
  }
  if (excelIncludes(rules.condominiumTypes, propertyType)) {
    const [cost, sales] = rules.condominiumOrApartment;
    return { cost, sales, rule: 'condominium or apartment' };
  }
  if (zoneGrade !== null && excelIncludes(rules.primeGrades, zoneGrade)) {
    const [cost, sales] = rules.prime;
    return { cost, sales, rule: `prime location (${zoneGrade})` };
  }
  const [cost, sales] = rules.other;
  return { cost, sales, rule: 'other locations' };
}

export function calculateCivil(
  input: CivilEngineInput,
  params: EngineParameters,
): CivilEngineOutput {
  const notes: string[] = [];
  const valuationDate = new Date(`${input.valuationDate}T00:00:00.000Z`);
  if (Number.isNaN(valuationDate.getTime())) {
    throw new BusinessRuleError('VALUATION_INPUT_INVALID', 'The valuation date is not valid.');
  }

  const guideline = readGuideline(params);
  const city = resolveCity(guideline, input.location.city);
  const purpose = chosen(
    guideline.lists.purposes,
    input.location.purpose,
    'Choose the permitted land purpose.',
    `"${input.location.purpose}" is not a permitted land purpose in the guideline.`,
  );
  const propertyType = chosen(
    guideline.lists.propertyTypes,
    input.location.propertyType,
    'Choose the property type.',
    `"${input.location.propertyType}" is not a property type in the guideline.`,
  );
  const location = { ...input.location, city: city.name, purpose, propertyType };

  // A property with any building still going up is reported as it stands
  // (REPORT-PROGRESS); otherwise complete (REPORT-COMPLETED).
  const progressMode = input.buildings.some((b) => b.constructionStatus === 'UNDER_CONSTRUCTION');

  // --- buildings and site works -------------------------------------------
  const buildings = [...input.buildings]
    .sort((a, b) => a.buildingNumber - b.buildingNumber)
    .map((building) =>
      valueBuilding({ guideline, building, isAddis: city.isAddis, progressMode, notes }),
    );
  const site = valueSiteWorks({
    guideline,
    civil: input.siteWorks.civil,
    gasStation: input.siteWorks.gasStation,
    coffeeSite: input.siteWorks.coffeeSite,
    progressMode,
    notes,
  });

  const sum = (values: readonly Decimal[]): Decimal =>
    values.reduce<Decimal>((total, v) => total.plus(v), ZERO);
  const builtUpArea = sum(buildings.map((b) => b.builtUpArea));
  const floorArea = sum(buildings.map((b) => b.floorArea));
  const buildingsComplete = sum(buildings.map((b) => b.completeValue));
  const buildingsCurrent = sum(buildings.map((b) => b.currentValue));
  const siteComplete = site.complete.civil
    .plus(site.complete.gasStation)
    .plus(site.complete.coffeeSite);
  const siteCurrent = site.current.civil
    .plus(site.current.gasStation)
    .plus(site.current.coffeeSite);
  const developmentComplete = buildingsComplete.plus(siteComplete);
  const developmentCurrent = buildingsCurrent.plus(siteCurrent);
  const completion = progressMode
    ? developmentComplete.isZero()
      ? ZERO
      : developmentCurrent.dividedBy(developmentComplete)
    : null;
  const development = progressMode ? developmentCurrent : developmentComplete;

  // --- market condition factor (F395) -------------------------------------
  const mcfValue = city.data.mcf ? excelLookup(city.data.mcf, purpose)?.value : null;
  if (mcfValue === null || mcfValue === undefined) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      `The guideline has no market condition factor for ${purpose.toLowerCase()} property in ${city.name}.`,
    );
  }
  const mcf = dec(mcfValue);

  // --- location value -----------------------------------------------------
  const located = valueLocation({
    guideline,
    city,
    location,
    land: input.land,
    builtUpArea,
    hasVilla: buildings.some((b) => excelEquals(b.output.costType, 'Villa')),
    notes,
  });
  const staged = stageLocation({
    guideline,
    city,
    propertyType,
    locationLabel: located.locationLabel,
    locationValue: located.locationValue,
    developmentValue: development,
    progress: completion,
    notes,
  });

  // --- cost approach (K125 / K130) ----------------------------------------
  const afterFactor = development.times(mcf);
  const costValue = afterFactor.plus(staged.value);
  const buildingsValue = progressMode ? buildingsCurrent : buildingsComplete;
  const siteWorksValue = progressMode ? siteCurrent : siteComplete;

  let progress: ProgressOutput | null = null;
  if (completion !== null) {
    const valueAtCompletion = developmentComplete.times(mcf).plus(staged.value);
    progress = {
      completionPercent: percentText(completion),
      developmentAtCompletion: m(developmentComplete),
      developmentAtCurrentStage: m(developmentCurrent),
      valueAtCompletion: m(valueAtCompletion),
      valueAtCurrentStage: m(costValue),
      formula: `buildings and site works stand at ${fmt(developmentCurrent)} of ${fmt(developmentComplete)} complete`,
    };
    notes.push(
      `The property is under construction and is valued as it stands, ${percentText(completion)}% complete. Complete, the cost approach would give ETB ${fmt(valueAtCompletion)}.`,
    );
  }

  // --- sale approach ------------------------------------------------------
  const sale = valueBySale({
    guideline,
    cityName: city.name,
    purpose,
    propertyType,
    floorLevel: input.location.floorLevel,
    plotArea: located.plotArea,
    costTypes: buildings.map((b) => b.output.costType),
    floorArea,
    builtUpArea,
    developmentCost: buildingsComplete.plus(site.complete.civil),
    locationValue: located.locationValue,
    notes,
  });
  let salesValue = sale.value;
  let saleNote = '';
  if (completion !== null && !salesValue.isZero()) {
    // REPORT-PROGRESS!K139:K140: only an apartment or a residential building
    // carries a sale value while it is being built, scaled by its completion.
    if (excelIncludes(guideline.reconciliation.progress.saleTypes, propertyType)) {
      salesValue = salesValue.times(completion);
      saleNote = ` x ${percentText(completion)}% complete`;
    } else {
      salesValue = ZERO;
      saleNote = '; not taken while under construction';
    }
  }

  // --- reconciliation (H137:K139 / H142:K144) -----------------------------
  let reconciliation: ReconciliationOutput;
  if (salesValue.isZero()) {
    reconciliation = {
      costValue: m(costValue),
      salesValue: null,
      costWeight: '100.00',
      salesWeight: '0.00',
      source: 'COST_ONLY',
      rule: 'no sale value',
      rationale: null,
      value: m(costValue),
      formula: `cost approach ${fmt(costValue)} x 100% (${sale.output.applicable ? 'no sale value at this stage' : 'no sale approach'})`,
    };
  } else {
    let weights: { cost: number | Decimal; sales: number | Decimal; rule: string };
    let source: ReconciliationOutput['source'] = 'GUIDELINE';
    let rationale: string | null = null;
    if (input.reconciliation) {
      const cost = dec(input.reconciliation.costWeight);
      const sales = dec(input.reconciliation.salesWeight);
      if (cost.lessThan(ZERO) || sales.lessThan(ZERO) || !cost.plus(sales).equals(HUNDRED)) {
        throw new BusinessRuleError(
          'WEIGHTS_INVALID',
          'Reconciliation weights must each be between 0 and 100 and total exactly 100.',
        );
      }
      rationale = input.reconciliation.rationale.trim();
      if (rationale.length < 10) {
        throw new BusinessRuleError(
          'WEIGHTS_RATIONALE_REQUIRED',
          'Explain why the guideline’s reconciliation weights are being overridden (10 characters minimum).',
        );
      }
      weights = { cost, sales, rule: 'overridden by the valuator' };
      source = 'OVERRIDE';
    } else if (completion !== null) {
      const rules = guideline.reconciliation.progress;
      weights = salesValue.lessThan(costValue)
        ? { cost: 100, sales: 0, rule: 'the sale value at this stage is below the cost value' }
        : { cost: rules.weights[0], sales: rules.weights[1], rule: 'property under construction' };
    } else {
      weights = completedWeights(guideline, propertyType, located.zoneGrade, costValue, salesValue);
      if (weights.cost === 0) {
        notes.push(
          `The sale value (ETB ${fmt(salesValue)}) is below the cost approach (ETB ${fmt(costValue)}), so the guideline takes the sale value alone. Confirm this is intended (guideline issue 9).`,
        );
      }
    }
    const costWeight = dec(weights.cost);
    const salesWeight = dec(weights.sales);
    const value = costValue
      .times(costWeight)
      .dividedBy(HUNDRED)
      .plus(salesValue.times(salesWeight).dividedBy(HUNDRED));
    reconciliation = {
      costValue: m(costValue),
      salesValue: m(salesValue),
      costWeight: costWeight.toFixed(2),
      salesWeight: salesWeight.toFixed(2),
      source,
      rule: weights.rule,
      rationale,
      value: m(value),
      formula:
        `cost ${fmt(costValue)} x ${pct(costWeight)} + sale ${fmt(salesValue)} x ${pct(salesWeight)} ` +
        `(${weights.rule})`,
    };
  }

  // --- forced sale (H141) -------------------------------------------------
  const marketValue = dec(reconciliation.value);
  const foreclosure = guideline.foreclosure;
  const listed = excelIncludes(foreclosure.purposes, purpose)
    ? excelLookup(foreclosure.percentByCity, city.name)
    : null;
  const forced = forcedSale(params, marketValue, input.forcedSale, {
    percent: dec(listed ? listed.value : foreclosure.defaultPercent),
    basis: listed
      ? `guideline percentage for ${purpose.toLowerCase()} property in ${city.name}`
      : 'guideline percentage for other cities and land purposes',
  });

  const replacementCost = sum(buildings.map((b) => b.replacementCost));
  const totalDepreciation = sum(buildings.map((b) => b.depreciation));

  return {
    formulaVersion: CIVIL_FORMULA_VERSION,
    guideline: { version: guideline.source.version, fixes: guideline.fixes },
    mode: progressMode ? 'PROGRESS' : 'COMPLETED',
    property: {
      city: city.name,
      cityGroup: city.data.group ?? '',
      cityClass: city.data.class ?? '',
      purpose,
      propertyType,
      floorLevel: input.location.floorLevel,
    },
    land: {
      ...located.land,
      staged: staged.staged,
      value: m(staged.value),
      holdingRates: {
        grades: RATE_GRADES.map((grade) =>
          r4(located.averageRate.times(staged.staged.primeMultiplier).times(grade)),
        ),
        averageTaken: r4(staged.value.dividedBy(located.plotArea)),
      },
    },
    buildings: buildings.map((b) => b.output),
    siteWorks: {
      civil: site.civil,
      gasStation: site.gasStation,
      coffeeSite: site.coffeeSite,
      civilTotal: m(progressMode ? site.current.civil : site.complete.civil),
      gasStationTotal: m(progressMode ? site.current.gasStation : site.complete.gasStation),
      coffeeSiteTotal: m(progressMode ? site.current.coffeeSite : site.complete.coffeeSite),
    },
    cost: {
      landValue: m(staged.value),
      replacementCost: m(replacementCost),
      totalDepreciation: m(totalDepreciation),
      buildingsValue: m(buildingsValue),
      siteWorksValue: m(siteWorksValue),
      developmentValue: m(development),
      factor: f6(mcf),
      afterFactor: m(afterFactor),
      indicatedValue: m(costValue),
      formula:
        `(buildings ${fmt(buildingsValue)} + site works ${fmt(siteWorksValue)}) x MCF ${mcf.toString()} ` +
        `for ${purpose.toLowerCase()} property in ${city.name} + location value ${fmt(staged.value)}`,
    },
    progress,
    sales: {
      ...sale.output,
      indicatedValue: m(salesValue),
      formula: sale.output.formula + saleNote,
    },
    reconciliation,
    forcedSale: forced,
    marketValue: m(money(marketValue)),
    forcedSaleValue: forced.value,
    notes,
  };
}
