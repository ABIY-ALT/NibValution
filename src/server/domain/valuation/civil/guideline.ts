import { ConfigurationError } from '@/lib/errors';
import { paramTable, type EngineParameters } from '../common';

/**
 * The valuation guideline's reference tables, as the civil engine reads them.
 *
 * Every table is a `guideline.*` valuation parameter, built from the Excel
 * estimation template by `scripts/guideline/build-tables.mjs` and published
 * with a guideline release. Nothing in the engine carries a rate, a factor or
 * a city name of its own: a figure the engine uses is a figure in one of these
 * tables, so the parameter set recorded on a valuation is the whole of what
 * priced it.
 */

export const GUIDELINE_KEYS = {
  source: 'guideline.source',
  cities: 'guideline.cities',
  foreclosure: 'guideline.foreclosure',
  landTiers: 'guideline.land_tiers',
  landMaxRate: 'guideline.land_max_rate',
  polygons: 'guideline.location_polygons',
  locationFactors: 'guideline.location_factors',
  locationValue: 'guideline.location_value',
  costCurves: 'guideline.cost_curves',
  components: 'guideline.building_components',
  buildingRules: 'guideline.building_rules',
  defects: 'guideline.condition_defects',
  lists: 'guideline.lists',
  civilWorks: 'guideline.civil_works',
  swimmingPool: 'guideline.swimming_pool',
  supplementary: 'guideline.supplementary_works',
  gasStation: 'guideline.gas_station_works',
  coffeeSite: 'guideline.coffee_site_works',
  saleApproach: 'guideline.sale_approach',
  reconciliation: 'guideline.reconciliation',
  remarks: 'guideline.remarks',
} as const;

/** The parameter holding the switches that correct the workbook's known issues. */
export const EXCEL_FIXES_KEY = 'excel_fixes.switches';

/** Keys under this prefix are published with a guideline release, never edited by hand. */
export const GUIDELINE_PREFIX = 'guideline.';

export function isGuidelineKey(key: string): boolean {
  return key.startsWith(GUIDELINE_PREFIX);
}

// ---------------------------------------------------------------------------
// Table shapes
// ---------------------------------------------------------------------------

export interface GuidelineSource {
  version: string;
  template: string;
  guidelineApproved: string;
  templateUpdated: string;
}

export type RateClass = 'R' | 'C' | 'I';
export type CityGroup = 'Addis Ababa' | 'Sheger City' | 'Outline Cities';

export interface GuidelineCity {
  grade: string | null;
  /** Location Parameters column N: which road-factor row applies. */
  group: string | null;
  /** Location Parameters column O: which utility/neighbourhood/proximity/BAR row applies. */
  class: string | null;
  /** Maximum location rate per m² where no polygon applies. */
  baseRates: Record<RateClass, number> | null;
  mcfGrade: string | null;
  /** Market condition factor by permitted land purpose. */
  mcf: Record<string, number | null> | null;
}

export interface CitiesTable {
  cities: Record<string, GuidelineCity>;
}

export interface ForeclosureTable {
  percentByCity: Record<string, number>;
  purposes: string[];
  defaultPercent: number;
}

export interface TierTable {
  thresholds: number[];
  factors: number[];
}

export interface LandTiersTable {
  other: Record<RateClass, TierTable>;
  addis: Record<RateClass, TierTable>;
}

export interface LandMaxRateTable {
  surroundingTowns: string[];
  regionalCities: string[];
  institutionalPurposes: string[];
  withoutCoordinates: {
    coffeeSite: { surrounding: number; other: number };
    gasStation: number;
    institutional: { surrounding: number; regional: number; other: number };
    addisCommercial: number;
    surrounding: number;
    regional: number;
    industrial: { smallPlotBelow: number; smallPlotOutsideAddis: number; other: number };
    other: number;
  };
  withCoordinates: { institutional: number; gradeFactors: Record<string, number> };
}

export interface LocationPolygon {
  source: string;
  city: string;
  areaName: string | null;
  grade: string;
  propertyClass: string;
  maxRate: number | null;
  points: [number, number][];
}

export interface PolygonsTable {
  polygons: LocationPolygon[];
}

interface GroupFactorTable {
  choices: string[];
  byGroup: Record<string, number[]>;
}

export type LocationUse = 'Residential' | 'Commercial' | 'Industrial';

interface UseFactorTable {
  choices: string[];
  byUse: Record<LocationUse, Record<string, number[]>>;
}

export interface LocationFactorsTable {
  classes: string[];
  roadQuality: GroupFactorTable;
  roadWidth: GroupFactorTable;
  accessibility: GroupFactorTable;
  proximity: UseFactorTable;
  utility: UseFactorTable;
  neighbourhood: UseFactorTable & { approximateMatchLabels: string[] };
  bar: {
    thresholds: number[];
    industrialThresholds: number[];
    residentialAndVilla: Record<string, number[]>;
    commercial: Record<string, number[]>;
    industrial: Record<string, number[]>;
  };
  floorLevel: { types: string[]; perFloor: number; maxFloor: number; above: number };
}

export interface LocationValueTable {
  lease: {
    fullValueFromRemainingYears: number;
    bothLeaseBelowRemainingYears: number;
    discountRate: number;
  };
  staged: {
    developmentMultiple: number;
    lowerShare: number;
    upperShare: number;
    minimumShare: number;
  };
  progress: {
    lowerShare: number;
    upperShare: number;
    minimumShare: number;
    addShare: number;
    completionBelow: number;
    factor: number;
  };
  addisPrimeMultipliers: Record<string, number>;
  primeMultiplierExcludedTypes: string[];
}

export type Grade = 'minimum' | 'Good' | 'Excellent' | 'Luxury';

export interface CostCurvesTable {
  curves: Record<string, Record<Grade, [number, number, number]>>;
}

export interface CatalogueComponent {
  /** The cost-sheet row the component is entered on in the Excel (10-200). */
  row: number;
  element: string;
  part: string | null;
  name: string;
  grade: string;
  weight: number;
}

export interface ComponentsTable {
  components: Record<string, CatalogueComponent[]>;
}

export interface BuildingRulesTable {
  outsideAddisFactor: number;
  volumeRatedTypes: string[];
  heightAdjustedTypes: string[];
  heightAdjustedAreaMultiplier: number;
  baseHeight: number;
  upliftPerMetre: number;
}

export interface ConditionDefect {
  code: number;
  group: string;
  label: string;
  rates: Record<string, number>;
}

export interface DefectsTable {
  categories: string[];
  categoryByType: Record<string, string>;
  correctedCategoryByType: Record<string, string>;
  defaultCategory: string;
  defects: ConditionDefect[];
  /**
   * The defects COST APPROACH FOR PROGRESS can record (rows 237-265). The
   * progress sheet has its own, shorter list: a building's value as it stands
   * is depreciated only for these.
   */
  progressCodes?: number[];
}

export interface ListsTable {
  purposes: string[];
  propertyTypes: string[];
  newComponentCategories: string[];
}

export interface RatedItem {
  name: string;
  rate: number;
}

export interface CivilWorksTable {
  items: (RatedItem & { lumpSum: boolean })[];
}

export interface SwimmingPoolTable {
  rates: {
    siteClearance: number;
    excavationTo150: number;
    excavation150To300: number;
    fillBelowHardcore: number;
    fillAroundWall: number;
    hardcore: number;
    cartAway: number;
    groundSlab: number;
    shearWall: number;
    reinforcement: number;
    formwork: number;
    waterproofing: number;
    plastering: number;
  };
  electricalShare: number;
  sanitaryShare: number;
  finishes: Record<string, number>;
  items: {
    name: string;
    wallFinish: string | null;
    wallRate: number;
    floorFinish: string | null;
    floorRate: number;
  }[];
}

export interface RatedItemsTable {
  items: RatedItem[];
}

export interface SaleApproachTable {
  city: string;
  purpose: string;
  propertyTypes: string[];
  excludedBuildingTypes: string[];
  residentialBuilding: {
    intercept: number;
    plotArea: number;
    builtUpArea: number;
    floorArea: number;
    costRate: number;
    locationRate: number;
  };
  condominium: {
    intercept: number;
    floorArea: number;
    costRate: number;
    locationRate: number;
    floorLevel: number;
  };
  apartmentFactor: number;
  smallUnit: { floorAreaBelow: number; valueBelow: number; factor: number };
}

export interface ReconciliationTable {
  completed: {
    condominiumOrApartment: [number, number];
    prime: [number, number];
    other: [number, number];
    condominiumTypes: string[];
    primeGrades: string[];
  };
  progress: { saleTypes: string[]; weights: [number, number] };
}

export interface RemarksTable {
  remarks: { section: string; case: string | null; remark: string; impact: string | null }[];
}

// ---------------------------------------------------------------------------
// The switches (CALCULATION_SPEC section 11)
// ---------------------------------------------------------------------------

/**
 * Corrections to known issues in the Excel workbook. Each is off until the
 * valuation unit approves it, so by default the engine reproduces the
 * workbook's figures exactly; switching one on publishes a new parameter
 * version like any other change.
 */
export const EXCEL_FIXES = {
  neighbourhoodExactMatch: 'Read the neighbourhood factor from the city’s own class row (issue 1).',
  industrialBarThresholds:
    'Grade an industrial plot’s built-up area ratio on the industrial thresholds, 7/14/25/35% (issue 2).',
  multiStoreyDefectRates:
    'Use the multi-storey defect rates for 2-5, 6-10 and 11+ storey buildings (issue 3).',
  bothHoldingDoubleCount:
    'For land held both free and on lease, value the free part once (issue 4).',
  addisTierFormula:
    'Apply every plot-size tier of the Addis Ababa land tables at its own factor (issue 5).',
  progressLocationValue:
    'Stage the location value of a property under construction by the completed-report rule (issue 8).',
  poolOwnFinishes:
    'Price each swimming pool with its own wall and floor finishes, not those named on the first row of plot civil works.',
  progressFloorDefects:
    'Depreciate a building under construction for floor-finish defects too, which the progress sheet cannot record.',
} as const;

export type ExcelFix = keyof typeof EXCEL_FIXES;
export type ExcelFixes = Record<ExcelFix, boolean>;

export function readExcelFixes(params: EngineParameters): ExcelFixes {
  const raw = (params.tables[EXCEL_FIXES_KEY] ?? {}) as Record<string, unknown>;
  const fixes = {} as ExcelFixes;
  for (const key of Object.keys(EXCEL_FIXES) as ExcelFix[]) fixes[key] = raw[key] === true;
  return fixes;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Guideline {
  source: GuidelineSource;
  cities: CitiesTable;
  foreclosure: ForeclosureTable;
  landTiers: LandTiersTable;
  landMaxRate: LandMaxRateTable;
  polygons: PolygonsTable;
  locationFactors: LocationFactorsTable;
  locationValue: LocationValueTable;
  costCurves: CostCurvesTable;
  components: ComponentsTable;
  buildingRules: BuildingRulesTable;
  defects: DefectsTable;
  lists: ListsTable;
  civilWorks: CivilWorksTable;
  swimmingPool: SwimmingPoolTable;
  supplementary: RatedItemsTable;
  gasStation: RatedItemsTable;
  coffeeSite: RatedItemsTable;
  saleApproach: SaleApproachTable;
  reconciliation: ReconciliationTable;
  fixes: ExcelFixes;
}

/**
 * The guideline tables of a parameter set. A set without them cannot value a
 * civil property, and says so - it never falls back to a figure of its own.
 */
export function readGuideline(params: EngineParameters): Guideline {
  const table = <T>(key: string): T => {
    try {
      return paramTable<T>(params, key);
    } catch {
      throw new ConfigurationError(
        `Guideline table "${key}" is not in parameter set ${params.setCode} v${params.setVersion}. Apply the guideline migration before valuing civil properties.`,
      );
    }
  };
  return {
    source: table(GUIDELINE_KEYS.source),
    cities: table(GUIDELINE_KEYS.cities),
    foreclosure: table(GUIDELINE_KEYS.foreclosure),
    landTiers: table(GUIDELINE_KEYS.landTiers),
    landMaxRate: table(GUIDELINE_KEYS.landMaxRate),
    polygons: table(GUIDELINE_KEYS.polygons),
    locationFactors: table(GUIDELINE_KEYS.locationFactors),
    locationValue: table(GUIDELINE_KEYS.locationValue),
    costCurves: table(GUIDELINE_KEYS.costCurves),
    components: table(GUIDELINE_KEYS.components),
    buildingRules: table(GUIDELINE_KEYS.buildingRules),
    defects: table(GUIDELINE_KEYS.defects),
    lists: table(GUIDELINE_KEYS.lists),
    civilWorks: table(GUIDELINE_KEYS.civilWorks),
    swimmingPool: table(GUIDELINE_KEYS.swimmingPool),
    supplementary: table(GUIDELINE_KEYS.supplementary),
    gasStation: table(GUIDELINE_KEYS.gasStation),
    coffeeSite: table(GUIDELINE_KEYS.coffeeSite),
    saleApproach: table(GUIDELINE_KEYS.saleApproach),
    reconciliation: table(GUIDELINE_KEYS.reconciliation),
    fixes: readExcelFixes(params),
  };
}
