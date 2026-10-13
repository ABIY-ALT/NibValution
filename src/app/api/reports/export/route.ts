import { type NextRequest, NextResponse } from 'next/server';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { countReportRows, streamReportCsv } from '@/server/application/report-service';
import {
  EXPORT_COLUMNS,
  exportOptionsSchema,
  reportFilterSchema,
  type ExportColumnKey,
} from '@/lib/validation/report';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { recordStandalone } from '@/server/infrastructure/audit/audit-service';

/**
 * Filtered CSV export of the valuation report.
 *
 * The filter is parsed from the same query string the report page uses, and
 * passed to the same service, so the file can only ever contain the rows the
 * screen was showing. Authorisation and organisational scope are applied inside
 * `streamReportCsv` rather than here — a second entry point must not be able to
 * reach data the first cannot.
 *
 * The response streams: a large export starts downloading immediately and never
 * materialises the whole file server-side.
 */
export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const ctx = await getRequestContext();

  try {
    const actor = await requireActor();
    const params = Object.fromEntries(request.nextUrl.searchParams);

    // A malformed filter narrows to nothing rather than failing the download;
    // the same leniency the report page applies to a stale bookmark.
    const parsedFilter = reportFilterSchema.safeParse(params);
    const filter = parsedFilter.success ? parsedFilter.data : {};

    const parsedOptions = exportOptionsSchema.safeParse(params);
    if (!parsedOptions.success) {
      return NextResponse.json({ error: 'Invalid export options.' }, { status: 400 });
    }
    const { columns, delimiter, bom } = parsedOptions.data;

    const labels = new Map(EXPORT_COLUMNS.map((c) => [c.key as ExportColumnKey, c.label]));
    const headers = columns.map((key) => labels.get(key) ?? key);

    // Exporting is a bulk read of collateral data. It is recorded against the
    // actor with the filter that produced it, so an unusual export is visible
    // in the audit trail rather than indistinguishable from browsing.
    const rowCount = await countReportRows(actor, filter);
    await recordStandalone({
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      correlationId: ctx.correlationId ?? null,
      action: 'REPORT_DOWNLOADED',
      entity: 'ValuationCase',
      entityId: null,
      before: null,
      after: { filter, columns, rowCount },
    });

    const encoder = new TextEncoder();
    const iterator = streamReportCsv(actor, filter, { columns, headers, delimiter, bom });

    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      },
      async cancel() {
        // The user navigated away mid-download; stop querying for more pages.
        await iterator.return?.(undefined);
      },
    });

    const stampedName = `nib-valuation-report-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${stampedName}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logger.error({ err: error, ...ctx }, 'Report export failed');
    return NextResponse.json({ error: 'The export could not be produced.' }, { status: 500 });
  }
}
