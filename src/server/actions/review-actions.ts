'use server';

import { revalidatePath } from 'next/cache';
import { getRequestContext, requireActor } from '@/server/application/actor';
import {
  raiseComment,
  replyToComment,
  setCommentResolved,
} from '@/server/application/review-service';
import {
  raiseCommentSchema,
  replyCommentSchema,
  resolveCommentSchema,
} from '@/lib/validation/review';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { WorkspaceActionState } from './valuation-actions';

/**
 * Review-comment server actions (Phase 4). Parse, resolve the actor, delegate:
 * who may comment, reply or resolve - and when - is decided by the service.
 */

async function run(
  caseId: string,
  label: string,
  operation: (ctx: Awaited<ReturnType<typeof getRequestContext>>) => Promise<void>,
  success: string,
): Promise<WorkspaceActionState> {
  const ctx = await getRequestContext();
  try {
    await operation(ctx);
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.safeDetail ?? error.message };
    logger.error({ err: error, correlationId: ctx.correlationId, caseId }, `${label} failed`);
    return { ok: false, message: 'That could not be saved. Please try again.' };
  }
  revalidatePath(`/requests/${caseId}/valuation`);
  revalidatePath(`/requests/${caseId}`);
  revalidatePath('/tasks');
  return { ok: true, message: success };
}

function invalid(messages: string[]): WorkspaceActionState {
  return { ok: false, message: messages[0] ?? 'Please check the comment.', messages };
}

export async function raiseCommentAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = raiseCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message));
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Review comment',
    (ctx) => raiseComment(actor, parsed.data, ctx),
    'Comment raised.',
  );
}

export async function replyCommentAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = replyCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message));
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Comment reply',
    (ctx) => replyToComment(actor, parsed.data, ctx),
    'Reply added.',
  );
}

export async function resolveCommentAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = resolveCommentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message));
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Comment resolution',
    (ctx) => setCommentResolved(actor, parsed.data, ctx),
    parsed.data.resolved ? 'Comment resolved.' : 'Comment reopened.',
  );
}
