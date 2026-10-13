import { CIVIL_FORMULA_VERSION, calculateCivil, type CivilEngineInput } from './civil-engine';
import {
  MECHANICAL_FORMULA_VERSION,
  calculateMechanical,
  type MechanicalEngineInput,
} from './mechanical-engine';
import type { EngineParameters } from './common';

/**
 * One entry point over both engines, used both to calculate and - from a stored
 * `CalculationRun` - to recalculate (spec section 28).
 *
 * The engine name and formula version are stored with every run. A run made by
 * an older formula version cannot be verified by today's code, so it counts as
 * needing recalculation rather than being trusted.
 */

export type EngineName = 'CIVIL' | 'MECHANICAL';

export const FORMULA_VERSIONS: Record<EngineName, string> = {
  CIVIL: CIVIL_FORMULA_VERSION,
  MECHANICAL: MECHANICAL_FORMULA_VERSION,
};

export type EngineInput = CivilEngineInput | MechanicalEngineInput;

export interface EngineResult {
  readonly marketValue: string;
  readonly forcedSaleValue: string;
  readonly formulaVersion: string;
}

export function runEngine(
  engine: EngineName,
  input: EngineInput,
  params: EngineParameters,
): EngineResult & Record<string, unknown> {
  return engine === 'CIVIL'
    ? { ...calculateCivil(input as CivilEngineInput, params) }
    : { ...calculateMechanical(input as MechanicalEngineInput, params) };
}

/**
 * JSON with object keys sorted at every depth, so the same value always
 * serialises to the same string. This is what the input hash and the
 * recomputation comparison are taken over: a JSON column does not preserve key
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
