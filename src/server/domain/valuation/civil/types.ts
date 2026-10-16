import type { ConstructionStatus, LandHoldingRight } from '../../shared/enums';
import type { ForcedSaleResult } from '../common';

/**
 * The output of the guideline formula (`civil-2.0.0`): land priced by location
 * zone and plot-size tiers, buildings from the guideline's component costs
 * less recorded defects, site works, and the guideline's sale approach.
 *
 * That formula no longer runs - the valuator now enters the figures - but the
 * calculations it produced are still held on cases, and the signed reports
 * frozen from them must go on rendering exactly as they were issued. Only the
 * shape is kept, for the breakdown that reads it.
 */

export type RateClass = 'R' | 'C' | 'I';
export type LocationUse = 'Residential' | 'Commercial' | 'Industrial';

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
  readonly guideline: {
    readonly version: string;
    readonly fixes: Readonly<Record<string, boolean>>;
  };
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
