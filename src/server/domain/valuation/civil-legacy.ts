import type { ConstructionStatus, LandHoldingRight } from '../shared/enums';
import type { ForcedSaleResult } from './common';

/**
 * The output of the first civil formula (`civil-1.0.0`): land at a rate the
 * valuator typed, buildings at a typed cost per m² less age-life depreciation,
 * and comparable sales.
 *
 * That formula no longer runs - the guideline engine replaced it - but the
 * calculations it produced are still held on cases, and the signed reports
 * frozen from them must go on rendering exactly as they were issued. Only the
 * shape is kept, for the breakdown that reads it.
 */

export const LEGACY_CIVIL_FORMULA_VERSION = 'civil-1.0.0';

interface LegacyComparable {
  readonly reference: string | null;
  readonly location: string;
  readonly characteristics: string | null;
  readonly saleDate: string | null;
  readonly salePrice: string;
  readonly area: string;
  readonly unitPrice: string;
  readonly netAdjustmentPercent: string;
  readonly adjustedUnitPrice: string;
  readonly adjustedValue: string;
}

export interface LegacyCivilEngineOutput {
  readonly formulaVersion: string;
  readonly land: {
    readonly holdingRight: LandHoldingRight;
    readonly area: string;
    readonly ratePerSqm: string;
    readonly grossValue: string;
    readonly basis: string;
    readonly leaseFactor: string | null;
    readonly unpaidBalanceDeducted: string;
    readonly value: string;
    readonly formula: string;
  };
  readonly buildings: readonly {
    readonly buildingId: string;
    readonly buildingNumber: number;
    readonly description: string;
    readonly constructionStatus: ConstructionStatus;
    readonly constructionType: string;
    readonly area: string;
    readonly unitRate: string;
    readonly replacementCost: string;
    readonly replacementFormula: string;
    readonly progressPercent: string | null;
    readonly depreciation: {
      readonly method: string;
      readonly effectiveAgeYears: string;
      readonly economicLifeYears: string;
      readonly residualPercent: string;
      readonly ratePercent: string;
      readonly amount: string;
      readonly formula: string;
    } | null;
    readonly value: string;
    readonly formula: string;
  }[];
  readonly externalWorks: readonly {
    readonly description: string;
    readonly unit: string | null;
    readonly quantity: string;
    readonly rate: string;
    readonly amount: string;
    readonly formula: string;
  }[];
  readonly cost: {
    readonly landValue: string;
    readonly replacementCost: string;
    readonly totalDepreciation: string;
    readonly buildingsValue: string;
    readonly externalWorksValue: string;
    readonly subtotal: string;
    readonly factor: string;
    readonly indicatedValue: string;
    readonly formula: string;
  };
  readonly sales: {
    readonly basis: 'PLOT_AREA' | 'BUILDING_AREA';
    readonly subjectArea: string;
    readonly comparables: readonly LegacyComparable[];
    readonly indicatedValue: string;
    readonly formula: string;
  } | null;
  readonly reconciliation: {
    readonly costValue: string;
    readonly salesValue: string | null;
    readonly costWeight: string;
    readonly salesWeight: string;
    readonly source: 'PARAMETERS' | 'OVERRIDE' | 'COST_ONLY';
    readonly rationale: string | null;
    readonly value: string;
    readonly formula: string;
  };
  readonly forcedSale: ForcedSaleResult;
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  readonly notes: readonly string[];
}

/** Whether a stored civil output is from the first formula rather than the guideline engine. */
export function isLegacyCivilOutput(output: unknown): output is LegacyCivilEngineOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { formulaVersion?: unknown }).formulaVersion === LEGACY_CIVIL_FORMULA_VERSION
  );
}
