import type { TransactionClient } from '@/server/infrastructure/db/client';
import {
  FORMULA_VERSION,
  canonicalJson,
  enteredOutput,
  type ValuationEntry,
} from '@/server/domain/valuation/calculation';
import { dec } from '@/lib/money';

/**
 * The state of a case's current valuation, as other services need to see it.
 *
 * Kept apart from the valuation service so the workflow and property services
 * can depend on it without depending on each other.
 */

/**
 * Whether the case's current valuation stands: it has its figures, and its
 * latest run - the valuator's entry - holds exactly those figures, derived
 * from exactly what was entered (workflow doc, `submitForChecking`). Anything
 * else - no valuation, a figure cleared by a property change, a run from a
 * retired calculation engine, a mismatch - means the figures must be entered
 * before the case moves on.
 */
export async function verifyCurrentValuation(
  tx: TransactionClient,
  caseId: string,
): Promise<boolean> {
  const valuation = await tx.valuation.findFirst({
    where: { caseId, isCurrent: true },
    select: { id: true, marketValue: true, forcedSaleValue: true },
  });
  if (!valuation || valuation.marketValue === null || valuation.forcedSaleValue === null) {
    return false;
  }

  const run = await tx.calculationRun.findFirst({
    where: { valuationId: valuation.id },
    orderBy: { performedAt: 'desc' },
  });
  if (!run || run.formulaVersion !== FORMULA_VERSION) return false;

  try {
    const entry = (run.inputSnapshot as unknown as { worksheet: ValuationEntry }).worksheet;
    const output = enteredOutput(entry);
    if (canonicalJson(output) !== canonicalJson(run.outputSnapshot)) return false;
    return (
      dec(valuation.marketValue.toString()).equals(output.marketValue) &&
      dec(valuation.forcedSaleValue.toString()).equals(output.forcedSaleValue)
    );
  } catch {
    return false;
  }
}
