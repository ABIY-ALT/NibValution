'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRequestContext, requireActor, requireSession } from '@/server/application/actor';
import { createCase, performTransition } from '@/server/application/case-service';
import { reauthenticate } from '@/server/application/auth-service';
import { createCaseSchema, transitionSchema } from '@/lib/validation/case';
import { getNumberConfig } from '@/server/application/configuration-service';
import { hasRecentReauthentication } from '@/server/infrastructure/auth/session';
import type { WorkflowAction } from '@/server/domain/workflow/transitions';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Request-intake and workflow server actions.
 *
 * Thin by design: parse, resolve the actor, delegate. Every rule that matters
 * lives below this layer, so the same operation behaves identically whether it
 * arrives here or through a future REST route.
 */

export type CaseFormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

function collectFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export async function createCaseAction(
  _prev: CaseFormState,
  formData: FormData,
): Promise<CaseFormState> {
  const parsed = createCaseSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const actor = await requireActor();
  const ctx = await getRequestContext();

  let created: { id: string; caseNumber: string };
  try {
    created = await createCase(actor, parsed.data, ctx);
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, message: error.safeDetail ?? error.message };
    }
    logger.error({ err: error, correlationId: ctx.correlationId }, 'Case creation failed');
    return { ok: false, message: 'The request could not be created. Please try again.' };
  }

  revalidatePath('/requests');
  // redirect() signals by throwing, so it sits outside the try/catch above.
  redirect(`/requests/${created.id}?created=1`);
}

export async function transitionAction(
  _prev: CaseFormState,
  formData: FormData,
): Promise<CaseFormState> {
  const parsed = transitionSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const session = await requireSession();
  const ctx = await getRequestContext();

  // Signing requires a recent password re-entry (section 19). A password sent
  // with the action is checked here first, so the signer confirms who they
  // are in the same step as signing; a wrong one stops the action outright.
  const password = formData.get('password');
  let reauthenticatedNow = false;
  if (typeof password === 'string' && password.length > 0) {
    try {
      await reauthenticate(session.actor.id, session.sessionId, password, ctx);
      reauthenticatedNow = true;
    } catch (error) {
      if (isAppError(error)) return { ok: false, message: error.safeDetail ?? error.message };
      throw error;
    }
  }

  // The re-authentication window is configuration.
  const reauthWindow = await getNumberConfig('signature.reauth_window_seconds', 300);
  const reauthenticatedWithinWindow =
    reauthenticatedNow || hasRecentReauthentication(session.reauthenticatedAt, reauthWindow);

  try {
    await performTransition(
      session.actor,
      {
        caseId: parsed.data.caseId,
        action: parsed.data.action as WorkflowAction,
        expectedVersion: parsed.data.expectedVersion,
        comment: parsed.data.comment ?? null,
        reasonCode: parsed.data.reasonCode ?? null,
        assigneeId: parsed.data.assigneeId ?? null,
        reauthenticatedWithinWindow,
      },
      ctx,
    );
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, message: error.safeDetail ?? error.message };
    }
    logger.error(
      { err: error, correlationId: ctx.correlationId, action: parsed.data.action },
      'Workflow transition failed',
    );
    return { ok: false, message: 'The action could not be completed. Please try again.' };
  }

  revalidatePath(`/requests/${parsed.data.caseId}`);
  revalidatePath('/requests');
  revalidatePath('/tasks');
  revalidatePath('/dashboard');

  return { ok: true, message: 'Done.' };
}
