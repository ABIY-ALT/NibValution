import type { MechanicalItemKind } from '../shared/enums';
import type { ForcedSaleResult } from './common';

/**
 * The output of the mechanical formula (`mechanical-1.0.0`): each vehicle or
 * machine valued at its replacement cost less depreciation, by comparable
 * listings, or both, reconciled and summed.
 *
 * That formula no longer runs - the valuator now enters the figures - but the
 * calculations it produced are still held on cases, and the signed reports
 * frozen from them must go on rendering exactly as they were issued. Only the
 * shape is kept, for the breakdown that reads it.
 */

interface ComparableEquipment {
  readonly description: string;
  readonly source: string | null;
  readonly marketPrice: string;
  readonly conditionAdjustment: string;
  readonly ageAdjustment: string;
  readonly locationAdjustment: string;
  readonly otherAdjustment: string;
}

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
    readonly comparables: readonly (ComparableEquipment & {
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
