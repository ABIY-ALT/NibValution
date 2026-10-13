import { NextResponse, type NextRequest } from 'next/server';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { uploadDocument } from '@/server/application/document-service';
import { getNumberConfig } from '@/server/application/configuration-service';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import { isSameOriginRequest } from '@/lib/http/same-origin';
import { sitePhotoSchema } from '@/lib/validation/valuation';

/**
 * Document upload.
 *
 * A route handler rather than a server action because server actions carry a
 * body-size limit intended for form fields, and because this is the endpoint a
 * future integration would call.
 *
 * Authorisation, validation, scanning and auditing all live in the service; this
 * handler only unpacks the multipart body and maps failures to status codes.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getRequestContext();
  if (!isSameOriginRequest(request.headers, serverEnv.APP_URL)) {
    return NextResponse.json(
      { code: 'FORBIDDEN', detail: 'Cross-site requests are refused.' },
      { status: 403 },
    );
  }

  try {
    const actor = await requireActor();

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      return NextResponse.json(
        { code: 'BAD_REQUEST', detail: 'Expected a multipart/form-data upload.' },
        { status: 400 },
      );
    }

    // Reject an oversized body before reading it into memory.
    const maxFileBytes = await getNumberConfig('upload.max_file_bytes', 26_214_400);
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > maxFileBytes * 1.1) {
      return NextResponse.json(
        {
          code: 'PAYLOAD_TOO_LARGE',
          detail: `The upload exceeds the ${Math.floor(maxFileBytes / (1024 * 1024))} MB limit.`,
        },
        { status: 413 },
      );
    }

    const form = await request.formData();
    const caseId = String(form.get('caseId') ?? '');
    const categoryCode = String(form.get('categoryCode') ?? '');
    const description = form.get('description');
    const supersedesId = form.get('supersedesId');
    const files = form.getAll('file').filter((f): f is File => f instanceof File);

    if (!caseId || !categoryCode) {
      return NextResponse.json(
        { code: 'BAD_REQUEST', detail: 'A case and a document category are required.' },
        { status: 400 },
      );
    }
    if (files.length === 0) {
      return NextResponse.json(
        { code: 'BAD_REQUEST', detail: 'No file was supplied.' },
        { status: 400 },
      );
    }

    // A photo taken on a site visit names its visit and carries the phone's
    // position at the moment it was sent.
    let sitePhoto = null;
    if (form.has('siteVisitId')) {
      const field = (name: string) => {
        const value = form.get(name);
        return typeof value === 'string' ? value : undefined;
      };
      const parsed = sitePhotoSchema.safeParse({
        siteVisitId: field('siteVisitId'),
        latitude: field('latitude'),
        longitude: field('longitude'),
        accuracyMeters: field('accuracyMeters'),
      });
      if (!parsed.success) {
        return NextResponse.json(
          { code: 'BAD_REQUEST', detail: parsed.error.issues[0]?.message ?? 'Invalid site photo.' },
          { status: 400 },
        );
      }
      const { siteVisitId, latitude, longitude, accuracyMeters } = parsed.data;
      sitePhoto = {
        siteVisitId,
        position:
          latitude !== null && longitude !== null && accuracyMeters !== null
            ? { latitude, longitude, accuracyMeters }
            : null,
      };
    }

    // Each file is validated and scanned on its own, so one bad file in a
    // multi-file drop does not discard the good ones.
    const uploaded: unknown[] = [];
    const rejected: { filename: string; reason: string }[] = [];

    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      try {
        uploaded.push(
          await uploadDocument(
            actor,
            {
              caseId,
              categoryCode,
              filename: file.name,
              declaredMime: file.type,
              bytes,
              description: description ? String(description) : null,
              supersedesId: supersedesId ? String(supersedesId) : null,
              sitePhoto,
            },
            ctx,
          ),
        );
      } catch (error) {
        if (isAppError(error)) {
          rejected.push({ filename: file.name, reason: error.safeDetail ?? error.message });
        } else {
          logger.error({ err: error, correlationId: ctx.correlationId }, 'Upload failed');
          rejected.push({ filename: file.name, reason: 'The file could not be stored.' });
        }
      }
    }

    const status = uploaded.length === 0 ? 422 : 201;
    return NextResponse.json({ uploaded, rejected }, { status });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(error.toProblem(ctx.correlationId), { status: error.status });
    }
    logger.error({ err: error, correlationId: ctx.correlationId }, 'Unexpected upload failure');
    return NextResponse.json({ code: 'INTERNAL', detail: 'Upload failed.' }, { status: 500 });
  }
}
