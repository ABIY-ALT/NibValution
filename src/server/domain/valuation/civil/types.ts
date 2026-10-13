import type { ConstructionStatus, LandHoldingRight } from '../../shared/enums';
import type { ForcedSaleOverride, ForcedSaleResult, WeightOverride } from '../common';
import type { ExcelFixes, LocationUse, RateClass } from './guideline';

/**
 * What the civil engine is given and what it returns.
 *
 * Amounts, areas and percentages cross the boundary as strings, as everywhere
 * else in the valuation domain. Percentages are 0-100: a component that makes
 * up 30% of a building's walls is "30", not the 0.3 the Excel sheet stores.
 */

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** HOME!E20-E26 and the location ratings of COST APPROACH!E404:E411. */
export interface CivilLocationInput {
  readonly city: string;
  /** Permitted land purpose, e.g. RESIDENTIAL. */
  readonly purpose: string;
  /** Property type, e.g. Residential Building. */
  readonly propertyType: string;
  /** Asked only of a condominium or apartment unit. */
  readonly floorLevel: number | null;
  readonly utility: string;
  readonly neighbourhood: string;
  readonly roadQuality: string;
  readonly roadWidth: string;
  readonly proximity: string;
  readonly accessibility: string;
}

export interface CivilLandInput {
  readonly holdingRight: LandHoldingRight;
  /** m², from the registered property. */
  readonly plotArea: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly leaseRemainingYears: number | null;
  readonly leaseTotalYears: number | null;
  readonly leaseTotalAmount: string | null;
  readonly leasePaidAmount: string | null;
  /** The free-hold part of a plot held both ways, m². */
  readonly freeholdArea: string | null;
}

export interface ComponentInput {
  /** The component's row in the guideline catalogue for the building's type. */
  readonly row: number;
  readonly sharePercent: string;
  /** How far the component is built; read only for a building under construction. */
  readonly completionPercent: string | null;
}

export interface NewComponentInput {
  readonly category: string;
  readonly description: string | null;
  /** ETB per m² of the building. */
  readonly unitRate: string;
  readonly sharePercent: string;
  readonly completionPercent: string | null;
}

export interface DefectInput {
  readonly code: number;
  /** How much of the element is affected, 0-100. */
  readonly percent: string;
}

export interface QuantityItemInput {
  readonly item: string;
  readonly quantity: string;
  readonly completionPercent: string | null;
}

export interface CivilBuildingInput {
  readonly buildingId: string;
  readonly buildingNumber: number;
  readonly name: string;
  readonly constructionStatus: ConstructionStatus;
  /** The registered completion, the default for each component of a building under construction. */
  readonly progressPercent: string | null;
  /** Total floor area of one building, m² (HOME column M). */
  readonly floorArea: string | null;
  /** Built-up (footprint) area of one building, m² (HOME column L). */
  readonly builtUpArea: string | null;
  /** The guideline building type that prices it, e.g. Villa. */
  readonly costType: string;
  /** Number of identical buildings (HOME column K). */
  readonly count: string;
  readonly heightM: string | null;
  readonly components: readonly ComponentInput[];
  readonly newComponents: readonly NewComponentInput[];
  readonly defects: readonly DefectInput[];
  readonly supplementary: readonly QuantityItemInput[];
}

export interface CivilWorkInput {
  readonly item: string;
  readonly description: string | null;
  readonly quantity: string | null;
  readonly completionPercent: string | null;
  /** Internal length, width and depth in metres, for a swimming pool. */
  readonly pool: { readonly length: string; readonly width: string; readonly depth: string } | null;
}

export interface CivilEngineInput {
  /** YYYY-MM-DD. The caller uses it to pick the parameter set. */
  readonly valuationDate: string;
  readonly location: CivilLocationInput;
  readonly land: CivilLandInput;
  readonly buildings: readonly CivilBuildingInput[];
  readonly siteWorks: {
    readonly civil: readonly CivilWorkInput[];
    readonly gasStation: readonly QuantityItemInput[];
    readonly coffeeSite: readonly QuantityItemInput[];
  };
  readonly reconciliation: WeightOverride | null;
  readonly forcedSale: ForcedSaleOverride | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface LocationFactorOutput {
  readonly key:
    | 'utility'
    | 'neighbourhood'
    | 'roadQuality'
    | 'roadWidth'
    | 'proximity'
    | 'accessibility'
    | 'bar'
    | 'floorLevel';
  readonly label: string;
  readonly choice: string;
  readonly factor: string;
  /** Which table row and column the factor was read from. */
  readonly basis: string;
}

export interface TierSegmentOutput {
  readonly from: string;
  readonly to: string;
  readonly area: string;
  readonly factor: string;
}

export interface LeaseWorkingOutput {
  readonly area: string;
  readonly totalYears: number;
  readonly remainingYears: number;
  readonly totalAmount: string;
  readonly paidAmount: string;
  readonly part1: string;
  readonly part2: string;
  readonly value: string;
  readonly formula: string;
}

export interface LandOutput {
  readonly holdingRight: LandHoldingRight;
  readonly plotArea: string;
  readonly propertyClass: LocationUse;
  readonly rateClass: RateClass;
  readonly coordinates: { readonly latitude: string; readonly longitude: string } | null;
  readonly maxRate: {
    readonly source: 'POLYGON' | 'CITY_TABLE';
    readonly zone: {
      readonly city: string;
      readonly grade: string;
      readonly areaName: string | null;
      readonly rate: string;
    } | null;
    readonly baseRate: string;
    readonly multiplier: string;
    readonly value: string;
    readonly formula: string;
  };
  /** The workbook's location label, e.g. INDUSTRIAL-Prime or RESIDENTIAL-Normal. */
  readonly locationLabel: string;
  readonly tiers: {
    readonly table: 'ADDIS_ABABA' | 'OTHER_TOWNS';
    readonly segments: readonly TierSegmentOutput[];
    readonly averageRate: string;
    readonly formula: string;
  };
  readonly builtUpAreaRatio: string;
  readonly factors: readonly LocationFactorOutput[];
  readonly factorProduct: string;
  /** Location rate per m² after the plot-size tiers and every location factor. */
  readonly ratePerSqm: string;
  readonly holding: {
    readonly basis: 'FREEHOLD' | 'LEASE_AS_FREEHOLD' | 'LEASE' | 'BOTH';
    readonly freeholdArea: string;
    readonly freeholdValue: string;
    readonly lease: LeaseWorkingOutput | null;
    readonly leaseValue: string;
    readonly formula: string;
  };
  /** Location value before it is staged against what stands on the plot. */
  readonly locationValue: string;
  readonly staged: {
    readonly rule: 'HALF' | 'PARTIAL' | 'FULL';
    readonly developmentValue: string;
    readonly sharePercent: string;
    readonly value: string;
    readonly progressFactor: string;
    readonly primeMultiplier: string;
    readonly formula: string;
  };
  /** The location value that enters the cost approach. */
  readonly value: string;
  /**
   * The land holding rates the report quotes (REPORT-COMPLETED!E46:J46): the
   * rate after the plot-size tiers, with the prime multiplier, at grades 1 to 5
   * (100% down to 60%), and the location value taken per m² of plot.
   */
  readonly holdingRates: {
    readonly grades: readonly string[];
    readonly averageTaken: string;
  };
}

export interface ComponentOutput {
  readonly row: number;
  readonly element: string;
  readonly part: string | null;
  readonly name: string;
  readonly grade: string;
  readonly weightPercent: string;
  readonly sharePercent: string;
  readonly completionPercent: string;
  /** The grade's cost curve at this building's area or volume. */
  readonly unitRate: string;
  readonly cost: string;
  readonly currentCost: string;
}

export interface NewComponentOutput {
  readonly category: string;
  readonly description: string | null;
  readonly unitRate: string;
  readonly sharePercent: string;
  readonly completionPercent: string;
  readonly cost: string;
  readonly currentCost: string;
}

export interface DefectOutput {
  readonly code: number;
  readonly group: string;
  readonly label: string;
  readonly ratePercent: string;
  readonly percent: string;
  readonly depreciationPercent: string;
}

export interface PricedItemOutput {
  readonly item: string;
  readonly description: string | null;
  readonly kind: 'RATE' | 'LUMP_SUM' | 'POOL';
  readonly rate: string;
  readonly quantity: string;
  readonly completionPercent: string;
  /** Value complete. */
  readonly amount: string;
  /** Value as it stands; equal to `amount` unless the property is under construction. */
  readonly currentAmount: string;
  readonly formula: string;
}

export interface BuildingStageOutput {
  readonly componentRate: string;
  readonly areaRate: string;
  readonly depreciatedRate: string;
  readonly replacementCost: string;
  readonly depreciation: string;
  readonly depreciatedCost: string;
  readonly supplementaryTotal: string;
  readonly value: string;
}

export interface CivilBuildingOutput {
  readonly buildingId: string;
  readonly buildingNumber: number;
  readonly name: string;
  readonly costType: string;
  readonly constructionStatus: ConstructionStatus;
  readonly count: string;
  readonly floorArea: string;
  readonly builtUpArea: string | null;
  readonly heightM: string | null;
  readonly rateBasis: 'AREA' | 'VOLUME';
  /** The x of the cost curve: floor area, or volume for a volume-rated type. */
  readonly rateDriver: string;
  readonly components: readonly ComponentOutput[];
  readonly newComponents: readonly NewComponentOutput[];
  readonly locationFactor: string;
  readonly defectCategory: string;
  readonly defects: readonly DefectOutput[];
  readonly depreciationPercent: string;
  /** Area the depreciated rate is applied to, all identical buildings together. */
  readonly costedArea: string;
  readonly heightFactor: string;
  readonly supplementary: readonly PricedItemOutput[];
  /** The building complete: replacement cost, depreciation and value. */
  readonly complete: BuildingStageOutput;
  /** The building as it stands; equal to `complete` unless it is under construction. */
  readonly current: BuildingStageOutput;
  readonly completionPercent: string;
  /** Depreciated replacement cost with supplementary works, at the stage the valuation reports. */
  readonly value: string;
  readonly formula: string;
}

export interface SiteWorksOutput {
  readonly civil: readonly PricedItemOutput[];
  readonly gasStation: readonly PricedItemOutput[];
  readonly coffeeSite: readonly PricedItemOutput[];
  readonly civilTotal: string;
  readonly gasStationTotal: string;
  readonly coffeeSiteTotal: string;
}

export interface CostOutput {
  /** The columns the persisted cost-approach row reads. */
  readonly landValue: string;
  readonly replacementCost: string;
  readonly totalDepreciation: string;
  readonly buildingsValue: string;
  readonly siteWorksValue: string;
  /** Buildings and site works together, before the MCF. */
  readonly developmentValue: string;
  readonly factor: string;
  readonly afterFactor: string;
  readonly indicatedValue: string;
  readonly formula: string;
}

export interface ProgressOutput {
  readonly completionPercent: string;
  readonly developmentAtCompletion: string;
  readonly developmentAtCurrentStage: string;
  readonly valueAtCompletion: string;
  readonly valueAtCurrentStage: string;
  readonly formula: string;
}

export interface SalesOutput {
  readonly applicable: boolean;
  /** Why the sale approach does or does not apply. */
  readonly reason: string;
  readonly model: 'RESIDENTIAL_BUILDING' | 'CONDOMINIUM' | 'APARTMENT' | null;
  readonly variables: {
    readonly plotArea: string;
    readonly floorArea: string;
    readonly builtUpArea: string;
    readonly floorLevel: string | null;
    readonly costRate: string;
    readonly locationRate: string;
  } | null;
  readonly valueAtCompletion: string;
  readonly indicatedValue: string;
  readonly formula: string;
}

export interface ReconciliationOutput {
  readonly costValue: string;
  readonly salesValue: string | null;
  readonly costWeight: string;
  readonly salesWeight: string;
  readonly source: 'GUIDELINE' | 'OVERRIDE' | 'COST_ONLY';
  readonly rule: string;
  readonly rationale: string | null;
  readonly value: string;
  readonly formula: string;
}

export interface CivilEngineOutput {
  readonly formulaVersion: string;
  readonly guideline: { readonly version: string; readonly fixes: ExcelFixes };
  readonly mode: 'COMPLETED' | 'PROGRESS';
  readonly property: {
    readonly city: string;
    readonly cityGroup: string;
    readonly cityClass: string;
    readonly purpose: string;
    readonly propertyType: string;
    readonly floorLevel: number | null;
  };
  readonly land: LandOutput;
  readonly buildings: readonly CivilBuildingOutput[];
  readonly siteWorks: SiteWorksOutput;
  readonly cost: CostOutput;
  readonly progress: ProgressOutput | null;
  readonly sales: SalesOutput;
  readonly reconciliation: ReconciliationOutput;
  readonly forcedSale: ForcedSaleResult;
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  /** Points a checker should notice: assumptions made, workbook quirks that moved a figure. */
  readonly notes: readonly string[];
}
