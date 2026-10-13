import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { caseScopeFilter } from './dashboard-service';
import { assertPermission, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { ReportFilterInput, ExportColumnKey } from '@/lib/validation/report';
import type { CaseStatus } from '@/server/domain/shared/enums';

/**
 * Operational and value reporting.
 *
 * Two properties matter more than anything else on this page.
 *
 * **The figures must reconcile.** Every headline, every breakdown and every
 * exported row is computed from one `where` clause built in `reportWhere`. The
 * previous page mixed a `_count` over the whole table with percentages derived
 * from a 200-row sample, so the same screen could state two different totals.
 * Aggregation happens in the database, over the filtered set, always.
 *
 * **The export cannot see more than the screen.** The CSV endpoint calls the
 * same builder with the same actor, so a downloaded file is exactly the report
 * the user was looking at. `caseScopeFilter` is applied here — the same
 * predicate the case list and dashboard use — which for an oversight role
 * (`case:read_all`) or an administrator returns an empty filter and therefore
 * the whole bank, and for a branch user returns only their own unit's work.
 * Bulk export is precisely where an unscoped query stops being a display bug
 * and becomes a data leak, so it is scoped at the source rather than trusted to
 * the caller.
 */

/**
 * Every field is optional. Zod's transforms make the parsed output type
 * total (`valuedOnly` always resolves to a boolean), but callers that have no
 * filter at all — an unparseable query string, or an internal call — must be
 * able to pass an empty object.
 */
export type ReportFilter = Partial<ReportFilterInput> & { pageSize?: number };

/** End of the given UTC day, so `to` is inclusive of the whole date. */
function endOfDay(date: string): Date {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value;
}

function reportWhere(actor: Actor, filter: ReportFilter): Prisma.ValuationCaseWhereInput {
  const createdAt: Prisma.DateTimeFilter = {};
  if (filter.from) createdAt.gte = new Date(`${filter.from}T00:00:00.000Z`);
  if (filter.to) createdAt.lt = endOfDay(filter.to);

  return {
    AND: [
      caseScopeFilter(actor),
      filter.from || filter.to ? { createdAt } : {},
      filter.status ? { status: filter.status } : {},
      filter.discipline ? { discipline: filter.discipline } : {},
      filter.orgId ? { requestingOrgId: filter.orgId } : {},
      filter.requestTypeCode ? { requestType: { code: filter.requestTypeCode } } : {},
      filter.valuedOnly ? { finalValue: { not: null } } : {},
    ],
  };
}

const ROW_SELECT = {
  id: true,
  caseNumber: true,
  status: true,
  discipline: true,
  currency: true,
  finalValue: true,
  forcedSaleValue: true,
  applicantName: true,
  ownerName: true,
  createdAt: true,
  requestedAt: true,
  approvedAt: true,
  completedAt: true,
  requestType: { select: { code: true, name: true } },
  requestingOrg: { select: { id: true, code: true, name: true } },
  department: { select: { name: true } },
  maker: { select: { fullName: true } },
  checker: { select: { fullName: true } },
  slaRecord: { select: { status: true, dueAt: true, elapsedWorkingDays: true } },
} as const;

export type ReportRow = Prisma.ValuationCaseGetPayload<{ select: typeof ROW_SELECT }>;

/**
 * The report: headline figures, breakdowns, and one page of rows.
 *
 * Counts and sums are separate queries rather than a scan, so the totals stay
 * correct however many cases match — they never describe only the page.
 */
export async function loadReport(actor: Actor, filter: ReportFilter) {
  assertPermission(actor, PERMISSIONS.REPORT_OPERATIONAL);

  const where = reportWhere(actor, filter);
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filter.pageSize ?? 50));

  const [rows, total, totals, byStatus, byDiscipline, byOrg, byType, valuedCount] =
    await Promise.all([
      prisma.valuationCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: ROW_SELECT,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.valuationCase.count({ where }),
      prisma.valuationCase.aggregate({
        where,
        _sum: { finalValue: true, forcedSaleValue: true },
        _avg: { finalValue: true },
        _max: { finalValue: true },
      }),
      prisma.valuationCase.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.valuationCase.groupBy({
        by: ['discipline'],
        where,
        _count: { _all: true },
        _sum: { finalValue: true },
      }),
      prisma.valuationCase.groupBy({
        by: ['requestingOrgId'],
        where,
        _count: { _all: true },
        _sum: { finalValue: true },
      }),
      prisma.valuationCase.groupBy({
        by: ['requestTypeId'],
        where,
        _count: { _all: true },
      }),
      prisma.valuationCase.count({ where: { AND: [where, { finalValue: { not: null } }] } }),
    ]);

  // groupBy returns ids; the names are resolved in one further query each
  // rather than by including a relation per row.
  const orgIds = byOrg.map((o) => o.requestingOrgId).filter(Boolean) as string[];
  const typeIds = byType.map((t) => t.requestTypeId).filter(Boolean) as string[];

  const [orgs, types] = await Promise.all([
    orgIds.length
      ? prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
    typeIds.length
      ? prisma.requestType.findMany({
          where: { id: { in: typeIds } },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  const num = (value: Prisma.Decimal | null) => (value ? Number(value) : 0);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),

    summary: {
      cases: total,
      valued: valuedCount,
      unvalued: total - valuedCount,
      marketValue: num(totals._sum.finalValue),
      forcedSaleValue: num(totals._sum.forcedSaleValue),
      averageValue: num(totals._avg.finalValue),
      largestValue: num(totals._max.finalValue),
    },

    byStatus: byStatus
      .map((r) => ({ status: r.status as CaseStatus, count: r._count._all }))
      .sort((a, b) => b.count - a.count),

    byDiscipline: byDiscipline.map((r) => ({
      discipline: r.discipline,
      count: r._count._all,
      value: num(r._sum.finalValue),
    })),

    byOrg: byOrg
      .map((r) => ({
        id: r.requestingOrgId,
        name: orgName.get(r.requestingOrgId ?? '') ?? 'Unassigned',
        count: r._count._all,
        value: num(r._sum.finalValue),
      }))
      .sort((a, b) => b.count - a.count),

    byType: byType
      .map((r) => ({
        id: r.requestTypeId,
        name: typeName.get(r.requestTypeId ?? '') ?? 'Unknown',
        count: r._count._all,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

export type ReportResult = Awaited<ReturnType<typeof loadReport>>;

/** The filter controls' option lists, scoped to what the actor may report on. */
export async function loadReportOptions(actor: Actor) {
  assertPermission(actor, PERMISSIONS.REPORT_OPERATIONAL);

  const [organizations, requestTypes] = await Promise.all([
    prisma.organization.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, type: true },
    }),
    prisma.requestType.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { code: true, name: true },
    }),
  ]);

  return { organizations, requestTypes };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const UTC_DATE = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: 'UTC' });

function stamp(value: Date | null): string {
  return value ? UTC_DATE.format(value) : '';
}

/** One row rendered as the chosen columns, in the chosen order. */
function cellsFor(row: ReportRow, columns: readonly ExportColumnKey[]): string[] {
  const values: Record<ExportColumnKey, string> = {
    caseNumber: row.caseNumber,
    status: row.status,
    discipline: row.discipline,
    requestType: row.requestType?.name ?? '',
    requestingOrg: row.requestingOrg?.name ?? '',
    department: row.department?.name ?? '',
    applicantName: row.applicantName,
    ownerName: row.ownerName,
    maker: row.maker?.fullName ?? '',
    checker: row.checker?.fullName ?? '',
    // Emitted unformatted so the column arrives in Excel as a number, not text.
    finalValue: row.finalValue ? row.finalValue.toString() : '',
    forcedSaleValue: row.forcedSaleValue ? row.forcedSaleValue.toString() : '',
    currency: row.currency ?? '',
    createdAt: stamp(row.createdAt),
    requestedAt: stamp(row.requestedAt),
    approvedAt: stamp(row.approvedAt),
    completedAt: stamp(row.completedAt),
    slaStatus: row.slaRecord?.status ?? '',
    slaDueAt: stamp(row.slaRecord?.dueAt ?? null),
    elapsedWorkingDays: row.slaRecord?.elapsedWorkingDays
      ? row.slaRecord.elapsedWorkingDays.toString()
      : '',
  };

  return columns.map((key) => values[key]);
}

/**
 * Escape one CSV field.
 *
 * Beyond RFC 4180 quoting, a field that begins with `=`, `+`, `-` or `@` is
 * prefixed with a tab. Those are formula leaders: a spreadsheet opening the
 * file would otherwise evaluate a value that came from a user-supplied name or
 * remark. This is CSV injection, and an export of applicant names is exactly
 * where it lands.
 */
function escapeCsv(value: string, delimiter: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
  const needsQuotes =
    guarded.includes(delimiter) ||
    guarded.includes('"') ||
    guarded.includes('\n') ||
    guarded.includes('\r');
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export interface CsvOptions {
  columns: readonly ExportColumnKey[];
  headers: readonly string[];
  delimiter: string;
  bom: boolean;
}

/**
 * Stream the whole filtered set as CSV.
 *
 * Rows are fetched in batches and yielded as they are encoded, so an export of
 * a large result set never holds every case in memory at once and the browser
 * starts receiving the file immediately.
 */
export async function* streamReportCsv(
  actor: Actor,
  filter: ReportFilter,
  options: CsvOptions,
): AsyncGenerator<string> {
  assertPermission(actor, PERMISSIONS.REPORT_OPERATIONAL);

  const where = reportWhere(actor, filter);
  const line = (cells: string[]) =>
    `${cells.map((c) => escapeCsv(c, options.delimiter)).join(options.delimiter)}\r\n`;

  if (options.bom) yield '﻿';
  yield line([...options.headers]);

  const batchSize = 500;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.valuationCase.findMany({
      where,
      orderBy: { id: 'asc' },
      select: ROW_SELECT,
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;

    let chunk = '';
    for (const row of batch) chunk += line(cellsFor(row, options.columns));
    yield chunk;

    if (batch.length < batchSize) break;
    cursor = batch[batch.length - 1]!.id;
  }
}

/** How many rows an export would contain, so the UI can say so before it runs. */
export async function countReportRows(actor: Actor, filter: ReportFilter): Promise<number> {
  assertPermission(actor, PERMISSIONS.REPORT_OPERATIONAL);
  return prisma.valuationCase.count({ where: reportWhere(actor, filter) });
}
