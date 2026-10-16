'use server';

import { revalidatePath } from 'next/cache';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { recordValuation } from '@/server/application/valuation-service';
import { valuationFiguresSchema } from '@/lib/validation/valuation';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The valuation server action: the assigned valuator's figures for a case.
 *
 * Thin by design, like the case actions: parse, resolve the actor, delegate.
 * Every rule - who may enter, in which status, within which limits - is
 * enforced by the service, so this behaves the same as any future API route.
 */

export type WorkspaceActionState = {
  ok: boolean;
  message?: string;
  /** Distinct validation messages, for a form that shows them as a list. */
  messages?: string[];
  fieldErrors?: Record<string, string[]>;
};

export async function recordValuationAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = valuationFiguresSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.') || 'form';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      message: 'Please correct the highlighted fields.',
      messages: [...new Set(parsed.error.issues.map((i) => i.message))],
      fieldErrors,
    };
  }

  const actor = await requireActor();
  const ctx = await getRequestContext();
  try {
    await recordValuation(actor, parsed.data, ctx);
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.safeDetail ?? error.message };
    logger.error(
      { err: error, correlationId: ctx.correlationId, caseId: parsed.data.caseId },
      'Valuation entry failed',
    );
    return { ok: false, message: 'That could not be saved. Please try again.' };
  }

  revalidatePath(`/requests/${parsed.data.caseId}`);
  revalidatePath('/dashboard');
  return { ok: true, message: 'Valuation saved.' };
}
