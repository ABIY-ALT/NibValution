import type { TransactionClient } from '@/server/infrastructure/db/client';
import {
  FORMULA_VERSIONS,
  canonicalJson,
  runEngine,
  type EngineInput,
  type EngineName,
} from '@/server/domain/valuation/calculation';
import type { EngineParameters } from '@/server/domain/valuation/common';
import { dec } from '@/lib/money';

/**
 * The state of a case's current valuation, as other services need to see it.
 *
 * Kept apart from the valuation service so the workflow and property services
 * can depend on it without depending on each other.
 */

/**
 * Whether the case's current valuation stands: it has a market value, and its
 * latest calculation run, re-run from the stored input and parameters by
 * today's engine, reproduces the stored output exactly (workflow doc,
 * `submitForChecking`). Anything else - no valuation, a figure cleared by a
 * property change, a run from an older formula version, a mismatch - means the
 * valuation must be recalculated before the case moves on.
 */
export async function verifyCurrentValuation(
  tx: TransactionClient,
  caseId: string,
): Promise<boolean> {
  const valuation = await tx.valuation.findFirst({
    where: { caseId, isCurrent: true },
    select: { id: true, marketValue: true, forcedSaleValue: true },
  });
  if (!valuation || valuation.marketValue === null) return false;

  const run = await tx.calculationRun.findFirst({
    where: { valuationId: valuation.id },
    orderBy: { performedAt: 'desc' },
  });
  if (!run) return false;

  const engine = run.engine as EngineName;
  if (FORMULA_VERSIONS[engine] !== run.formulaVersion) return false;

  try {
    const params = run.parameterSnapshot as unknown as EngineParameters;
    const input = (run.inputSnapshot as unknown as { engine: EngineInput }).engine;
    const recomputed = runEngine(engine, input, params);
    if (canonicalJson(recomputed) !== canonicalJson(run.outputSnapshot)) return false;
    return (
      dec(valuation.marketValue.toString()).equals(recomputed.marketValue) &&
      valuation.forcedSaleValue !== null &&
      dec(valuation.forcedSaleValue.toString()).equals(recomputed.forcedSaleValue)
    );
  } catch {
    return false;
  }
}

/**
 * Clear the figures of a case whose property details have just changed. The
 * breakdown stays visible as the last calculation, but the case cannot move on
 * until it is recalculated against the property as it now stands.
 */
export async function invalidateValuation(tx: TransactionClient, caseId: string): Promise<void> {
  const current = await tx.valuation.findFirst({
    where: { caseId, isCurrent: true, frozenAt: null, marketValue: { not: null } },
    select: { id: true },
  });
  if (!current) return;
  await tx.valuation.update({
    where: { id: current.id },
    data: { marketValue: null, forcedSaleValue: null },
  });
  await tx.valuationCase.update({
    where: { id: caseId },
    data: { finalValue: null, forcedSaleValue: null },
  });
}
