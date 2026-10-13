import { BusinessRuleError, ConfigurationError } from '@/lib/errors';
import { Decimal, HUNDRED, ZERO, dec } from '@/lib/money';
import { fmt, m, nonNegative, positive, qty, r4 } from '../common';
import { approximateMatch, excelEquals, excelIncludes, excelLookup, pointInPolygon } from './excel';
import type {
  Guideline,
  GuidelineCity,
  LocationPolygon,
  LocationUse,
  RateClass,
  TierTable,
} from './guideline';
import type {
  CivilLandInput,
  CivilLocationInput,
  LandOutput,
  LeaseWorkingOutput,
  LocationFactorOutput,
  TierSegmentOutput,
} from './types';

/**
 * Location value: the land half of the cost approach (CALCULATION_SPEC
 * section 5; sheets "LHR with coordinate", "LHR without coordinate",
 * "Location Parameters" and COST APPROACH FOR COMPLETED rows 404-420).
 *
 *   maximum location rate   the zone the coordinates fall in, or the city's
 *                           base rate - each with its adjustment
 *   x plot-size tiers       the rate falls away for the larger part of a plot
 *   x location factors      utility, neighbourhood, road, proximity, access,
 *                           built-up area ratio, floor level
 *   = rate per m²
 *   x plot area             on the free-hold or the lease rule
 *   = location value        staged afterwards against what stands on the plot
 */

const ONE = new Decimal(1);
export const ADDIS_ABABA = 'Addis Ababa';

/** A factor as stored: six decimals. */
export const f6 = (value: Decimal | number | string): string =>
  dec(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);

/** A factor as shown in a formula, without trailing zeros. */
const show = (value: Decimal | number | string): string =>
  dec(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();

// ---------------------------------------------------------------------------
// City and class
// ---------------------------------------------------------------------------

export interface ResolvedCity {
  readonly name: string;
  readonly data: GuidelineCity;
  readonly isAddis: boolean;
}

export function resolveCity(guideline: Guideline, city: string): ResolvedCity {
  const hit = excelLookup(guideline.cities.cities, city);
  if (!hit) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      city.trim()
        ? `"${city}" is not a city or town in the guideline. Choose it from the list, or "Other Cities Not Listed Above".`
        : 'Choose the city or town the property is in.',
    );
  }
  return { name: hit.name, data: hit.value, isAddis: excelEquals(hit.name, ADDIS_ABABA) };
}

/** RESIDENTIAL is residential; COMMERCIAL, SHOP and HOTEL are commercial; anything else is industrial. */
export function propertyClassOf(purpose: string): LocationUse {
  if (excelEquals(purpose, 'RESIDENTIAL')) return 'Residential';
  if (excelIncludes(['COMMERCIAL', 'SHOP', 'HOTEL'], purpose)) return 'Commercial';
  return 'Industrial';
}

const RATE_CLASS: Record<LocationUse, RateClass> = {
  Residential: 'R',
  Commercial: 'C',
  Industrial: 'I',
};

/**
 * The table a utility, neighbourhood or proximity factor is read from. The
 * workbook tests the purpose for "Residential" and "Commercial" only, so a
 * shop or a hotel reads the industrial table here although it is commercial
 * for the land rate (G404, G405, G408).
 */
function factorUseOf(purpose: string): LocationUse {
  if (excelEquals(purpose, 'RESIDENTIAL')) return 'Residential';
  if (excelEquals(purpose, 'COMMERCIAL')) return 'Commercial';
  return 'Industrial';
}

// ---------------------------------------------------------------------------
// Maximum location rate
// ---------------------------------------------------------------------------

function findZone(
  guideline: Guideline,
  city: ResolvedCity,
  propertyClass: LocationUse,
  latitude: number,
  longitude: number,
): LocationPolygon | null {
  const source = city.isAddis ? 'addis_ababa' : 'outline';
  for (const polygon of guideline.polygons.polygons) {
    if (polygon.source !== source) continue;
    if (!excelEquals(polygon.city, city.name)) continue;
    if (!excelEquals(polygon.propertyClass, propertyClass)) continue;
    if (pointInPolygon(latitude, longitude, polygon.points) === true) return polygon;
  }
  return null;
}

/** The multiplier on a city's base rate where no zone applies ('LHR without coordinate'!B10). */
function cityRateMultiplier(
  guideline: Guideline,
  city: ResolvedCity,
  purpose: string,
  plotArea: Decimal,
): { factor: number; why: string } {
  const rules = guideline.landMaxRate;
  const w = rules.withoutCoordinates;
  const surrounding = excelIncludes(rules.surroundingTowns, city.name);
  const regional = excelIncludes(rules.regionalCities, city.name);

  if (excelEquals(purpose, 'COFFEE SITE')) {
    return surrounding
      ? {
          factor: w.coffeeSite.surrounding,
          why: 'coffee site in Addis Ababa or a surrounding town',
        }
      : { factor: w.coffeeSite.other, why: 'coffee site elsewhere' };
  }
  if (excelEquals(purpose, 'GAS STATION')) return { factor: w.gasStation, why: 'gas station' };
  if (excelIncludes(rules.institutionalPurposes, purpose)) {
    if (surrounding) {
      return {
        factor: w.institutional.surrounding,
        why: `${purpose.toLowerCase()} in Addis Ababa or a surrounding town`,
      };
    }
    return regional
      ? { factor: w.institutional.regional, why: `${purpose.toLowerCase()} in a regional city` }
      : { factor: w.institutional.other, why: `${purpose.toLowerCase()} elsewhere` };
  }
  if (city.isAddis && excelEquals(purpose, 'COMMERCIAL')) {
    return { factor: w.addisCommercial, why: 'commercial property in Addis Ababa' };
  }
  if (surrounding) return { factor: w.surrounding, why: 'Addis Ababa or a surrounding town' };
  if (regional) return { factor: w.regional, why: 'regional city' };
  if (excelEquals(purpose, 'INDUSTRIAL')) {
    return !city.isAddis && plotArea.lessThan(w.industrial.smallPlotBelow)
      ? {
          factor: w.industrial.smallPlotOutsideAddis,
          why: `industrial plot under ${w.industrial.smallPlotBelow} m²`,
        }
      : { factor: w.industrial.other, why: 'industrial plot' };
  }
  return { factor: w.other, why: 'other town' };
}

// ---------------------------------------------------------------------------
// Plot-size tiers
// ---------------------------------------------------------------------------

interface Segment {
  from: Decimal;
  to: Decimal;
  area: Decimal;
  factor: Decimal;
}

/**
 * The plot cut into the guideline's size tiers, each with the share of the
 * maximum rate it earns - a marginal scale, like a tax bracket.
 *
 * `asWorkbook` reproduces three slips in the Addis Ababa formulas
 * ('LHR without coordinate'!C16:C18), which the towns' formulas (C12:C14) do
 * not have:
 *   - industrial: the fifth and sixth tiers are priced at the fourth tier's
 *     factor ($M$13 where $N$13 and $O$13 were meant);
 *   - above the last threshold: the tier before it is measured to the plot
 *     area rather than to the threshold, so the top of the plot counts twice;
 *   - residential and commercial, 25,000-30,000 m²: the part above 25,000 is
 *     measured from 30,000, and so subtracts.
 */
export function tierSegments(
  plotArea: Decimal,
  table: TierTable,
  variant: 'OTHER' | 'ADDIS_RC' | 'ADDIS_I',
  asWorkbook: boolean,
): Segment[] {
  const thresholds = table.thresholds.map((t) => dec(t));
  const factors = table.factors.map((f) => dec(f));
  const count = thresholds.length;
  if (count === 0 || factors.length !== count) {
    throw new ConfigurationError('A land tier table has mismatched thresholds and factors.');
  }
  const first = thresholds[0]!;
  if (plotArea.lessThanOrEqualTo(first)) {
    return [{ from: ZERO, to: plotArea, area: plotArea, factor: ONE }];
  }

  const quirks = asWorkbook && variant !== 'OTHER';
  // Tier i (1-based past the first) runs from thresholds[i-1] to thresholds[i]
  // at factors[i-1]; the last factor applies above the last threshold.
  const factorOf = (tier: number): Decimal =>
    quirks && variant === 'ADDIS_I' && (tier === 4 || tier === 5)
      ? factors[2]!
      : factors[tier - 1]!;

  let reached = thresholds.findIndex((t) => plotArea.lessThanOrEqualTo(t));
  const above = reached === -1;
  if (above) reached = count;

  const segments: Segment[] = [{ from: ZERO, to: first, area: first, factor: ONE }];
  for (let tier = 1; tier < reached; tier++) {
    const from = thresholds[tier - 1]!;
    let to = thresholds[tier]!;
    if (quirks && above && tier === count - 1) to = plotArea;
    segments.push({ from, to, area: to.minus(from), factor: factorOf(tier) });
  }
  let from = thresholds[reached - 1]!;
  if (quirks && variant === 'ADDIS_RC' && !above && reached === count - 1) {
    from = thresholds[count - 1]!;
  }
  segments.push({ from, to: plotArea, area: plotArea.minus(from), factor: factorOf(reached) });
  return segments;
}

/** The average rate per m² over the whole plot: the tiers' rate, weighted by area. */
export function tieredAverageRate(
  plotArea: Decimal,
  maxRate: Decimal,
  table: TierTable,
  variant: 'OTHER' | 'ADDIS_RC' | 'ADDIS_I',
  asWorkbook: boolean,
): Decimal {
  return averageOf(tierSegments(plotArea, table, variant, asWorkbook), plotArea, maxRate);
}

function averageOf(segments: readonly Segment[], plotArea: Decimal, maxRate: Decimal): Decimal {
  return segments
    .reduce<Decimal>((sum, s) => sum.plus(s.area.times(maxRate).times(s.factor)), ZERO)
    .dividedBy(plotArea);
}

// ---------------------------------------------------------------------------
// Location factors
// ---------------------------------------------------------------------------

function choiceIndex(choices: readonly string[], choice: string, label: string): number {
  const index = choices.findIndex((c) => excelEquals(c, choice));
  if (index === -1) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      choice.trim()
        ? `${label}: "${choice}" is not one of the guideline's ratings.`
        : `Rate the property's ${label.toLowerCase()}.`,
    );
  }
  return index;
}

function rowOf(table: Readonly<Record<string, number[]>>, row: string, what: string): number[] {
  const hit = excelLookup(table, row);
  if (!hit) {
    throw new ConfigurationError(`The guideline's ${what} table has no "${row}" row.`);
  }
  return hit.value;
}

interface FactorContext {
  guideline: Guideline;
  city: ResolvedCity;
  location: CivilLocationInput;
  plotArea: Decimal;
  builtUpArea: Decimal;
  hasVilla: boolean;
  notes: string[];
}

function locationFactors(ctx: FactorContext): {
  factors: LocationFactorOutput[];
  product: Decimal;
  ratio: Decimal;
} {
  const { guideline, city, location, notes } = ctx;
  const tables = guideline.locationFactors;
  const cityClass = city.data.class;
  const cityGroup = city.data.group;
  if (!cityClass || !cityGroup) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_INVALID',
      `${city.name} has no class in the guideline's location parameters, so its location factors cannot be read. Choose "Other Cities Not Listed Above" or ask the valuation unit to class it.`,
    );
  }
  const use = factorUseOf(location.purpose);
  const out: LocationFactorOutput[] = [];
  // The stored factors are rounded for reading; the product is taken from the
  // table values themselves.
  const exact: Decimal[] = [];
  const push = (
    key: LocationFactorOutput['key'],
    label: string,
    choice: string,
    factor: number | Decimal,
    basis: string,
  ) => {
    exact.push(dec(factor));
    out.push({ key, label, choice, factor: f6(factor), basis });
  };

  // G404
  const utility = choiceIndex(tables.utility.choices, location.utility, 'Utility');
  push(
    'utility',
    'Utility',
    tables.utility.choices[utility]!,
    rowOf(tables.utility.byUse[use], cityClass, 'utility')[utility]!,
    `${use} table, ${cityClass}`,
  );

  // G405
  const neighbourhood = choiceIndex(
    tables.neighbourhood.choices,
    location.neighbourhood,
    'Neighbourhood standard',
  );
  const labels = tables.neighbourhood.approximateMatchLabels;
  const exactRow = labels.findIndex((l) => excelEquals(l, cityClass));
  const workbookRow = approximateMatch(labels, cityClass);
  const row = guideline.fixes.neighbourhoodExactMatch ? exactRow : workbookRow;
  if (row < 0 || exactRow < 0) {
    throw new ConfigurationError(`The neighbourhood table has no row for "${cityClass}".`);
  }
  const neighbourhoodTable = tables.neighbourhood.byUse[use];
  const neighbourhoodFactor = rowOf(neighbourhoodTable, labels[row]!, 'neighbourhood')[
    neighbourhood
  ]!;
  push(
    'neighbourhood',
    'Neighbourhood standard',
    tables.neighbourhood.choices[neighbourhood]!,
    neighbourhoodFactor,
    `${use} table, ${labels[row]}`,
  );
  if (workbookRow >= 0 && workbookRow !== exactRow) {
    const own = rowOf(neighbourhoodTable, labels[exactRow]!, 'neighbourhood')[neighbourhood]!;
    const workbook = rowOf(neighbourhoodTable, labels[workbookRow]!, 'neighbourhood')[
      neighbourhood
    ]!;
    if (own !== workbook) {
      notes.push(
        guideline.fixes.neighbourhoodExactMatch
          ? `Neighbourhood factor ${show(own)} is read from the ${cityClass} row; the Excel workbook reads ${show(workbook)} from the ${labels[workbookRow]} row (guideline issue 1, corrected by switch).`
          : `Neighbourhood factor ${show(workbook)} is read from the ${labels[workbookRow]} row, as the Excel workbook does; the ${cityClass} row gives ${show(own)} (guideline issue 1).`,
      );
    }
  }

  // G406, G407
  const quality = choiceIndex(tables.roadQuality.choices, location.roadQuality, 'Road quality');
  push(
    'roadQuality',
    'Road quality',
    tables.roadQuality.choices[quality]!,
    rowOf(tables.roadQuality.byGroup, cityGroup, 'road quality')[quality]!,
    cityGroup,
  );
  const width = choiceIndex(tables.roadWidth.choices, location.roadWidth, 'Road width');
  push(
    'roadWidth',
    'Road width',
    tables.roadWidth.choices[width]!,
    rowOf(tables.roadWidth.byGroup, cityGroup, 'road width')[width]!,
    cityGroup,
  );

  // G408
  const proximity = choiceIndex(
    tables.proximity.choices,
    location.proximity,
    'Proximity to the city centre',
  );
  push(
    'proximity',
    'Proximity to city centre',
    tables.proximity.choices[proximity]!,
    rowOf(tables.proximity.byUse[use], cityClass, 'proximity')[proximity]!,
    `${use} table, ${cityClass}`,
  );

  // G409
  const access = choiceIndex(
    tables.accessibility.choices,
    location.accessibility,
    'Road accessibility',
  );
  push(
    'accessibility',
    'Road accessibility',
    tables.accessibility.choices[access]!,
    rowOf(tables.accessibility.byGroup, cityGroup, 'accessibility')[access]!,
    cityGroup,
  );

  // G410: built-up area ratio
  const ratio = ctx.builtUpArea.dividedBy(ctx.plotArea);
  const residential = excelEquals(location.purpose, 'RESIDENTIAL');
  const commercial = excelEquals(location.purpose, 'COMMERCIAL');
  const barKind =
    residential || (commercial && ctx.hasVilla)
      ? 'residentialAndVilla'
      : commercial
        ? 'commercial'
        : 'industrial';
  const band = (thresholds: readonly number[]): number =>
    ratio.lessThan(thresholds[0]!)
      ? 0
      : ratio.lessThanOrEqualTo(thresholds[1]!)
        ? 1
        : ratio.lessThanOrEqualTo(thresholds[2]!)
          ? 2
          : ratio.lessThanOrEqualTo(thresholds[3]!)
            ? 3
            : 4;
  const barRow = rowOf(tables.bar[barKind], cityClass, 'built-up area ratio');
  const workbookBand = band(tables.bar.thresholds);
  const industrialBand = band(tables.bar.industrialThresholds);
  const useIndustrial = barKind === 'industrial' && guideline.fixes.industrialBarThresholds;
  const barBand = useIndustrial ? industrialBand : workbookBand;
  const percentOfPlot = `${ratio.times(HUNDRED).toDecimalPlaces(2).toString()}%`;
  push(
    'bar',
    'Built-up area ratio',
    percentOfPlot,
    barRow[barBand]!,
    `${barKind === 'residentialAndVilla' ? 'Residential and commercial G+0' : barKind === 'commercial' ? 'Commercial G+1 and above' : 'Industrial'} table, ${cityClass}`,
  );
  if (barKind === 'industrial' && barRow[workbookBand] !== barRow[industrialBand]) {
    notes.push(
      useIndustrial
        ? `Built-up area ratio ${percentOfPlot} is graded on the industrial thresholds (factor ${show(barRow[industrialBand]!)}); the Excel workbook grades it on the residential ones (${show(barRow[workbookBand]!)}) (guideline issue 2, corrected by switch).`
        : `Built-up area ratio ${percentOfPlot} is graded on the residential thresholds (factor ${show(barRow[workbookBand]!)}), as the Excel workbook does; the industrial thresholds give ${show(barRow[industrialBand]!)} (guideline issue 2).`,
    );
  }

  // G411
  const floor = tables.floorLevel;
  if (excelIncludes(floor.types, location.propertyType)) {
    if (location.floorLevel === null) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_MISSING',
        `Enter the floor level of the ${location.propertyType.toLowerCase()} unit.`,
      );
    }
    const level = location.floorLevel;
    const factor =
      level <= floor.maxFloor ? ONE.minus(dec(floor.perFloor).times(level)) : dec(floor.above);
    push('floorLevel', 'Floor level', String(level), factor, `${floor.perFloor} per floor`);
  }

  return {
    factors: out,
    product: exact.reduce<Decimal>((p, f) => p.times(f), ONE),
    ratio,
  };
}

// ---------------------------------------------------------------------------
// Holding: free-hold and lease (H413, H416)
// ---------------------------------------------------------------------------

interface LeaseTerms {
  totalYears: number;
  remainingYears: number;
  totalAmount: Decimal;
  paidAmount: Decimal;
}

function leaseTerms(land: CivilLandInput, remainingYears: number): LeaseTerms {
  if (land.leaseTotalYears === null || land.leaseTotalYears <= 0) {
    throw new BusinessRuleError(
      'LEASE_TERM_REQUIRED',
      'Enter the total lease period: with fewer lease years remaining than the guideline’s threshold, the land is valued on its lease terms.',
    );
  }
  const totalAmount = nonNegative(land.leaseTotalAmount, 'The total lease amount');
  const paidAmount = nonNegative(land.leasePaidAmount, 'The paid-up lease amount');
  if (land.leaseTotalYears < remainingYears) {
    throw new BusinessRuleError(
      'LEASE_TERMS_INVALID',
      `The remaining lease period (${remainingYears} years) is longer than the total lease period (${land.leaseTotalYears} years).`,
    );
  }
  if (paidAmount.greaterThan(totalAmount)) {
    throw new BusinessRuleError(
      'LEASE_TERMS_INVALID',
      'The paid-up lease amount is more than the total lease amount.',
    );
  }
  return { totalYears: land.leaseTotalYears, remainingYears, totalAmount, paidAmount };
}

/** The lease branch of H413/H416 for `area` m² at `rate` per m². */
function leaseValue(
  area: Decimal,
  rate: Decimal,
  terms: LeaseTerms,
  discountRate: number,
): { value: Decimal; working: LeaseWorkingOutput } {
  const share = dec(terms.remainingYears).dividedBy(terms.totalYears);
  const unpaid = terms.totalAmount.minus(terms.paidAmount);
  const full = area.times(rate);

  const net = full.minus(unpaid);
  const earned = net.times(share);
  const part1 = (
    earned.greaterThanOrEqualTo(terms.totalAmount) ? earned : terms.paidAmount.times(share)
  ).times(ONE.minus(share));

  const discounted = full.minus(unpaid.dividedBy(ONE.plus(discountRate).pow(terms.remainingYears)));
  const part2 = (
    discounted.lessThanOrEqualTo(terms.paidAmount) ? terms.paidAmount : discounted
  ).times(share);

  const value = part1.plus(part2);
  return {
    value,
    working: {
      area: r4(area),
      totalYears: terms.totalYears,
      remainingYears: terms.remainingYears,
      totalAmount: m(terms.totalAmount),
      paidAmount: m(terms.paidAmount),
      part1: m(part1),
      part2: m(part2),
      value: m(value),
      formula:
        `lease of ${qty(area)} m², ${terms.remainingYears} of ${terms.totalYears} years remaining, ` +
        `ETB ${fmt(terms.paidAmount)} paid of ${fmt(terms.totalAmount)}: ` +
        `${fmt(part1)} + ${fmt(part2)} (unpaid balance discounted at ${show(dec(discountRate).times(100))}%)`,
    },
  };
}

// ---------------------------------------------------------------------------
// Location value
// ---------------------------------------------------------------------------

export interface LocationResult {
  readonly land: Omit<LandOutput, 'staged' | 'value' | 'holdingRates'>;
  readonly locationValue: Decimal;
  /** The rate after the plot-size tiers, before the location factors. */
  readonly averageRate: Decimal;
  readonly ratePerSqm: Decimal;
  readonly plotArea: Decimal;
  /** The zone's grade, where the coordinates fell in one. */
  readonly zoneGrade: string | null;
  readonly locationLabel: string;
}

export function valueLocation(args: {
  guideline: Guideline;
  city: ResolvedCity;
  location: CivilLocationInput;
  land: CivilLandInput;
  /** Built-up area of every building on the plot, m². */
  builtUpArea: Decimal;
  hasVilla: boolean;
  notes: string[];
}): LocationResult {
  const { guideline, city, location, land, notes } = args;
  if (!land.plotArea) {
    throw new BusinessRuleError(
      'VALUATION_INPUT_MISSING',
      'The plot area is missing, so the land cannot be valued. Enter it in step 1 (Land and buildings), click "Save property details", then calculate again.',
    );
  }
  const plotArea = positive(land.plotArea, 'The plot area');
  const propertyClass = propertyClassOf(location.purpose);
  const rateClass = RATE_CLASS[propertyClass];
  const classLabel = propertyClass.toUpperCase();

  // --- maximum location rate ---------------------------------------------
  const hasCoordinates = land.latitude !== null && land.longitude !== null;
  const zone = hasCoordinates
    ? findZone(guideline, city, propertyClass, Number(land.latitude), Number(land.longitude))
    : null;
  const locationLabel = `${classLabel}-${zone ? zone.grade : 'Normal'}`;
  const institutional = excelIncludes(
    guideline.landMaxRate.institutionalPurposes,
    location.purpose,
  );

  let maxRate: Decimal;
  let maxRateOutput: LandOutput['maxRate'];
  if (zone && zone.maxRate) {
    const special = institutional ? guideline.landMaxRate.withCoordinates.institutional : 1;
    const grade =
      excelLookup(guideline.landMaxRate.withCoordinates.gradeFactors, locationLabel)?.value ?? 1;
    const multiplier = dec(special).times(grade);
    maxRate = dec(zone.maxRate).times(multiplier);
    maxRateOutput = {
      source: 'POLYGON',
      zone: {
        city: zone.city,
        grade: zone.grade,
        areaName: zone.areaName,
        rate: r4(zone.maxRate),
      },
      baseRate: r4(zone.maxRate),
      multiplier: f6(multiplier),
      value: r4(maxRate),
      formula:
        `zone ${locationLabel}${zone.areaName ? ` (${zone.areaName})` : ''} at ${fmt(zone.maxRate)} per m²` +
        (institutional ? ` x ${special} for a ${location.purpose.toLowerCase()}` : '') +
        (grade !== 1 ? ` x ${grade} for the grade` : ''),
    };
  } else {
    const base = city.data.baseRates?.[rateClass];
    if (base === undefined || base === null) {
      throw new BusinessRuleError(
        'VALUATION_INPUT_INVALID',
        `The guideline has no ${propertyClass.toLowerCase()} land rate for ${city.name}.`,
      );
    }
    const { factor, why } = cityRateMultiplier(guideline, city, location.purpose, plotArea);
    maxRate = dec(base).times(factor);
    maxRateOutput = {
      source: 'CITY_TABLE',
      zone: null,
      baseRate: r4(base),
      multiplier: f6(factor),
      value: r4(maxRate),
      formula: `${city.name} ${propertyClass.toLowerCase()} rate ${fmt(base)} per m² x ${factor} (${why})`,
    };
    notes.push(
      hasCoordinates
        ? `The property's coordinates fall in no ${propertyClass.toLowerCase()} location zone of ${city.name}, so the city's base rate is used.`
        : `The property has no coordinates, so the location zone could not be looked up and ${city.name}'s base rate is used. Record the coordinates to price it by zone.`,
    );
  }

  // --- plot-size tiers ----------------------------------------------------
  const tierTable = (city.isAddis ? guideline.landTiers.addis : guideline.landTiers.other)[
    rateClass
  ];
  const variant = !city.isAddis ? 'OTHER' : rateClass === 'I' ? 'ADDIS_I' : 'ADDIS_RC';
  const asWorkbook = !guideline.fixes.addisTierFormula;
  const segments = tierSegments(plotArea, tierTable, variant, asWorkbook);
  const averageRate = averageOf(segments, plotArea, maxRate);
  if (variant !== 'OTHER') {
    const other = averageOf(
      tierSegments(plotArea, tierTable, variant, !asWorkbook),
      plotArea,
      maxRate,
    );
    if (!other.equals(averageRate)) {
      notes.push(
        asWorkbook
          ? `The plot-size tiers follow the Excel workbook's Addis Ababa formula, giving ${fmt(averageRate)} per m²; applying every tier at its own factor gives ${fmt(other)} (guideline issue 5).`
          : `The plot-size tiers apply every tier at its own factor, giving ${fmt(averageRate)} per m²; the Excel workbook's Addis Ababa formula gives ${fmt(other)} (guideline issue 5, corrected by switch).`,
      );
    }
  }
  const tierOutput: TierSegmentOutput[] = segments.map((s) => ({
    from: r4(s.from),
    to: r4(s.to),
    area: r4(s.area),
    factor: f6(s.factor),
  }));

  // --- location factors ---------------------------------------------------
  const { factors, product, ratio } = locationFactors({
    guideline,
    city,
    location,
    plotArea,
    builtUpArea: args.builtUpArea,
    hasVilla: args.hasVilla,
    notes,
  });
  const ratePerSqm = averageRate.times(product);

  // --- holding ------------------------------------------------------------
  const rules = guideline.locationValue.lease;
  const whole = plotArea.times(ratePerSqm);
  let basis: LandOutput['holding']['basis'] = 'FREEHOLD';
  let freeholdArea = plotArea;
  let freeholdValue = whole;
  let lease: LeaseWorkingOutput | null = null;
  let leaseAmount = ZERO;
  let holdingFormula = `plot ${qty(plotArea)} m² x ${fmt(ratePerSqm)} per m² (free hold)`;

  if (land.holdingRight !== 'FREEHOLD') {
    if (land.leaseRemainingYears === null) {
      throw new BusinessRuleError(
        'LEASE_TERMS_REQUIRED',
        'Lease-held land needs the remaining lease years. Record them in step 1 (Land and buildings), then calculate again.',
      );
    }
    const remaining = land.leaseRemainingYears;
    const longLease = remaining >= rules.fullValueFromRemainingYears;

    if (land.holdingRight === 'LEASE') {
      if (longLease) {
        basis = 'LEASE_AS_FREEHOLD';
        holdingFormula = `plot ${qty(plotArea)} m² x ${fmt(ratePerSqm)} per m² (lease with ${remaining} years remaining, valued in full from ${rules.fullValueFromRemainingYears} years)`;
      } else {
        basis = 'LEASE';
        const result = leaseValue(
          plotArea,
          ratePerSqm,
          leaseTerms(land, remaining),
          rules.discountRate,
        );
        freeholdArea = ZERO;
        freeholdValue = ZERO;
        lease = result.working;
        leaseAmount = result.value;
        holdingFormula = result.working.formula;
      }
    } else {
      basis = 'BOTH';
      const free = nonNegative(land.freeholdArea, 'The free-hold part of the plot');
      if (free.greaterThan(plotArea)) {
        throw new BusinessRuleError(
          'VALUATION_INPUT_INVALID',
          'The free-hold part of the plot cannot be larger than the plot.',
        );
      }
      const leased = plotArea.minus(free);
      if (guideline.fixes.bothHoldingDoubleCount) {
        freeholdArea = free;
        freeholdValue = free.times(ratePerSqm);
        if (longLease) {
          leaseAmount = leased.times(ratePerSqm);
          holdingFormula = `free hold ${qty(free)} m² + lease ${qty(leased)} m² (${remaining} years remaining, valued in full), each x ${fmt(ratePerSqm)} per m²`;
        } else {
          const result = leaseValue(
            leased,
            ratePerSqm,
            leaseTerms(land, remaining),
            rules.discountRate,
          );
          lease = result.working;
          leaseAmount = result.value;
          holdingFormula = `free hold ${qty(free)} m² x ${fmt(ratePerSqm)} per m² + ${result.working.formula}`;
        }
      } else {
        // H413 values the whole plot once the lease has 20 years or more to
        // run, and H416 still adds the lease part below 25 years.
        freeholdArea = longLease ? plotArea : free;
        freeholdValue = freeholdArea.times(ratePerSqm);
        holdingFormula = `${longLease ? 'whole plot' : 'free hold'} ${qty(freeholdArea)} m² x ${fmt(ratePerSqm)} per m²`;
        if (remaining < rules.bothLeaseBelowRemainingYears) {
          const result = leaseValue(
            leased,
            ratePerSqm,
            leaseTerms(land, remaining),
            rules.discountRate,
          );
          lease = result.working;
          leaseAmount = result.value;
          holdingFormula += ` + ${result.working.formula}`;
          if (longLease) {
            notes.push(
              `The plot is held both free and on lease with ${remaining} years remaining: as in the Excel workbook, the whole plot is valued as free hold and the lease part is added again (guideline issue 4).`,
            );
          }
        }
      }
    }
  }

  const locationValue = freeholdValue.plus(leaseAmount);

  return {
    land: {
      holdingRight: land.holdingRight,
      plotArea: r4(plotArea),
      propertyClass,
      rateClass,
      coordinates: hasCoordinates
        ? { latitude: String(land.latitude), longitude: String(land.longitude) }
        : null,
      maxRate: maxRateOutput,
      locationLabel,
      tiers: {
        table: city.isAddis ? 'ADDIS_ABABA' : 'OTHER_TOWNS',
        segments: tierOutput,
        averageRate: r4(averageRate),
        formula:
          segments.map((s) => `${qty(s.area)} m² x ${show(s.factor)}`).join(' + ') +
          `, x ${fmt(maxRate)} / ${qty(plotArea)} m²`,
      },
      builtUpAreaRatio: f6(ratio),
      factors,
      factorProduct: f6(product),
      ratePerSqm: r4(ratePerSqm),
      holding: {
        basis,
        freeholdArea: r4(freeholdArea),
        freeholdValue: m(freeholdValue),
        lease,
        leaseValue: m(leaseAmount),
        formula: holdingFormula,
      },
      locationValue: m(locationValue),
    },
    locationValue,
    averageRate,
    ratePerSqm,
    plotArea,
    zoneGrade: zone ? zone.grade : null,
    locationLabel,
  };
}

// ---------------------------------------------------------------------------
// Staging (REPORT-COMPLETED!K124, REPORT-PROGRESS!K125)
// ---------------------------------------------------------------------------

export interface StagedLocation {
  readonly staged: LandOutput['staged'];
  readonly value: Decimal;
}

/**
 * The location value a property earns for what stands on it: half for a plot
 * with little or nothing built, rising to the whole as the development value
 * approaches the land's. Prime Addis Ababa zones then carry a multiplier.
 */
export function stageLocation(args: {
  guideline: Guideline;
  city: ResolvedCity;
  propertyType: string;
  locationLabel: string;
  locationValue: Decimal;
  /** Buildings and site works: complete, or as they stand for a property under construction. */
  developmentValue: Decimal;
  /** Overall completion as a fraction, for a property under construction. */
  progress: Decimal | null;
  notes: string[];
}): StagedLocation {
  const { guideline, locationValue: lv, developmentValue: v, progress, notes } = args;
  const rules = guideline.locationValue;
  const byCompletedRule = (): { rule: 'HALF' | 'PARTIAL' | 'FULL'; value: Decimal } => {
    const s = rules.staged;
    const scaled = v.times(s.developmentMultiple);
    if (scaled.lessThanOrEqualTo(lv.times(s.lowerShare))) {
      return { rule: 'HALF', value: lv.times(s.minimumShare) };
    }
    if (scaled.lessThan(lv.times(s.upperShare))) {
      return {
        rule: 'PARTIAL',
        value: lv.times(s.minimumShare).plus(scaled.dividedBy(lv).minus(s.lowerShare).times(lv)),
      };
    }
    return { rule: 'FULL', value: lv };
  };

  let rule: 'HALF' | 'PARTIAL' | 'FULL';
  let value: Decimal;
  let progressFactor = ONE;
  let formula: string;

  if (progress === null) {
    ({ rule, value } = byCompletedRule());
    const s = rules.staged;
    formula =
      rule === 'FULL'
        ? `location value ${fmt(lv)} in full: ${s.developmentMultiple} x development ${fmt(v)} is at least ${s.upperShare * 100}% of it`
        : rule === 'HALF'
          ? `${s.minimumShare * 100}% of location value ${fmt(lv)}: ${s.developmentMultiple} x development ${fmt(v)} is no more than ${s.lowerShare * 100}% of it`
          : `${s.minimumShare * 100}% of location value ${fmt(lv)} + (${s.developmentMultiple} x development ${fmt(v)} / location value - ${s.lowerShare}) of it`;
  } else {
    const p = rules.progress;
    progressFactor = progress.lessThan(p.completionBelow) ? dec(p.factor) : ONE;
    if (excelEquals(args.propertyType, 'Apartment')) {
      rule = 'FULL';
      value = lv;
      formula = `location value ${fmt(lv)} in full (apartment)`;
    } else if (guideline.fixes.progressLocationValue) {
      ({ rule, value } = byCompletedRule());
      formula = `location value ${fmt(lv)} staged by the completed-report rule on development ${fmt(v)} as it stands`;
    } else if (v.lessThanOrEqualTo(lv.times(p.lowerShare))) {
      rule = 'HALF';
      value = lv.times(p.minimumShare);
      formula = `${p.minimumShare * 100}% of location value ${fmt(lv)}: development ${fmt(v)} is no more than ${p.lowerShare * 100}% of it`;
    } else if (v.lessThan(lv.times(p.upperShare))) {
      rule = 'PARTIAL';
      value = v.plus(lv.times(p.addShare));
      formula = `development ${fmt(v)} + ${p.addShare * 100}% of location value ${fmt(lv)}`;
      notes.push(
        'The location value of this property under construction is set, as in the Excel progress report, to the development value plus 20% of the location value - a different rule from the completed report (guideline issue 8).',
      );
    } else {
      rule = 'FULL';
      value = lv;
      formula = `location value ${fmt(lv)} in full: development ${fmt(v)} is at least ${p.upperShare * 100}% of it`;
    }
    if (!progressFactor.equals(ONE)) {
      value = value.times(progressFactor);
      formula += ` x ${show(progressFactor)} (under ${p.completionBelow * 100}% complete)`;
    }
  }

  const prime =
    args.city.isAddis && !excelIncludes(rules.primeMultiplierExcludedTypes, args.propertyType)
      ? (excelLookup(rules.addisPrimeMultipliers, args.locationLabel)?.value ?? 1)
      : 1;
  const beforePrime = value;
  if (prime !== 1) {
    value = value.times(prime);
    formula += ` x ${prime} (${args.locationLabel}, Addis Ababa)`;
  }

  if (rule !== 'FULL' && progress === null) {
    notes.push(
      `Only ${beforePrime.dividedBy(lv).times(HUNDRED).toDecimalPlaces(2).toString()}% of the location value is taken, because the buildings and site works are small beside the land.`,
    );
  }

  return {
    staged: {
      rule,
      developmentValue: m(v),
      sharePercent: lv.isZero()
        ? '0.00'
        : beforePrime.dividedBy(lv).times(HUNDRED).toDecimalPlaces(2).toFixed(2),
      value: m(beforePrime),
      progressFactor: f6(progressFactor),
      primeMultiplier: f6(prime),
      formula,
    },
    value,
  };
}
