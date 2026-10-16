import { dec } from '@/lib/money';

/**
 * The figures of a valuation, as the valuator enters them.
 *
 * The system does not calculate a value: the market and forced-sale values are
 * the valuator's own, and are stored as given. Each entry is still recorded as
 * a `CalculationRun` - what was entered, the figures it set and a hash of both
 * - so the figures on a case can be checked against the entry that set them,
 * and a signed report can carry its fingerprint.
 *
 * Runs made by the retired calculation engines stay on record and keep
 * rendering (see `civil-legacy.ts`, `civil/types.ts` and
 * `mechanical-legacy.ts`), but they are not this formula version, so a case
 * that carries one needs its figures entered before it moves on.
 */

export type EngineName = 'CIVIL' | 'MECHANICAL';

export const FORMULA_VERSION = 'manual-1.0.0';

/** What the valuator enters. Amounts stay strings end to end. */
export interface ValuationEntry {
  readonly valuationDate: string;
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  readonly remarks: string | null;
}

/** The stored output of an entry: the figures as the case holds them. */
export interface EnteredOutput {
  readonly formulaVersion: string;
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  /** The forced-sale value as a share of market value, for the reader. */
  readonly forcedSalePercent: string;
}

export function enteredOutput(entry: ValuationEntry): EnteredOutput {
  const market = dec(entry.marketValue);
  const forced = dec(entry.forcedSaleValue);
  return {
    formulaVersion: FORMULA_VERSION,
    marketValue: market.toFixed(2),
    forcedSaleValue: forced.toFixed(2),
    forcedSalePercent: market.isZero() ? '0.00' : forced.times(100).dividedBy(market).toFixed(2),
  };
}

/** Whether a stored output is an entry rather than the working of a retired engine. */
export function isEnteredOutput(output: unknown): output is EnteredOutput {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { formulaVersion?: unknown }).formulaVersion === FORMULA_VERSION
  );
}

/**
 * JSON with object keys sorted at every depth, so the same value always
 * serialises to the same string. This is what the input hash and the
 * verification comparison are taken over: a JSON column does not preserve key
 * order, so comparing raw `JSON.stringify` output would fail spuriously.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) sorted[key] = sortKeys(entry);
    }
    return sorted;
  }
  return value;
}
