import { NextResponse, type NextRequest } from 'next/server';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { deleteDocument } from '@/server/application/document-service';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import { isSameOriginRequest } from '@/lib/http/same-origin';

/**
 * Soft-delete a document.
 *
 * The reason is mandatory and is recorded against the caller: a document on a
 * case is evidence, so removing it is a decision someone owns rather than an
 * erasure (rule 7). The bytes are retained.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getRequestContext();
  if (!isSameOriginRequest(request.headers, serverEnv.APP_URL)) {
    return NextResponse.json(
      { code: 'FORBIDDEN', detail: 'Cross-site requests are refused.' },
      { status: 403 },
    );
  }

  try {
    const actor = await requireActor();
    const { id } = await context.params;

    let reason = '';
    try {
      const body = (await request.json()) as { reason?: unknown };
      reason = typeof body.reason === 'string' ? body.reason : '';
    } catch {
      reason = '';
    }

    await deleteDocument(actor, id, reason, ctx);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(error.toProblem(ctx.correlationId), { status: error.status });
    }
    logger.error({ err: error, correlationId: ctx.correlationId }, 'Document delete failed');
    return NextResponse.json({ code: 'INTERNAL', detail: 'Delete failed.' }, { status: 500 });
  }
}
