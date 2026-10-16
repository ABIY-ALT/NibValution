/**
 * The forced-sale working every retired calculation engine stored with its
 * output. Those engines no longer run, but their outputs are still held on
 * cases and in signed reports, so the shape is kept for the breakdown that
 * reads it.
 */
export interface ForcedSaleResult {
  readonly marketValue: string;
  readonly percent: string;
  readonly isOverridden: boolean;
  readonly reason: string | null;
  readonly value: string;
  readonly formula: string;
}
