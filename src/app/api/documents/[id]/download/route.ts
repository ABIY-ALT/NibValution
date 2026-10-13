import { NextResponse, type NextRequest } from 'next/server';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { downloadDocument } from '@/server/application/document-service';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Authorised document download.
 *
 * Every response is an attachment with `nosniff` and a restrictive CSP: a
 * stored file is never rendered in the browsing context, so an HTML or SVG
 * payload that somehow reached storage still cannot execute against this
 * origin. The URL carries a database id, never a storage key (rule 6).
 *
 * The one exception is `?view=1` on a JPEG or PNG - site photos shown in the
 * workspace and the report - which is served inline. The type is the sniffed
 * one stored at upload, and the sandbox CSP and `nosniff` still apply.
 */
const INLINE_TYPES = new Set(['image/jpeg', 'image/png']);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getRequestContext();

  try {
    const actor = await requireActor();
    const { id } = await context.params;

    const document = await downloadDocument(actor, id, ctx);

    // RFC 5987 encoding, so a non-ASCII filename survives without letting a
    // quote or newline break the header.
    const asciiName = document.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    const encodedName = encodeURIComponent(document.filename);
    const disposition =
      request.nextUrl.searchParams.get('view') === '1' && INLINE_TYPES.has(document.mimeType)
        ? 'inline'
        : 'attachment';

    return new NextResponse(new Uint8Array(document.bytes), {
      status: 200,
      headers: {
        'Content-Type': document.mimeType,
        'Content-Length': String(document.bytes.length),
        'Content-Disposition': `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(error.toProblem(ctx.correlationId), { status: error.status });
    }
    logger.error({ err: error, correlationId: ctx.correlationId }, 'Document download failed');
    return NextResponse.json({ code: 'INTERNAL', detail: 'Download failed.' }, { status: 500 });
  }
}
