import Link from 'next/link';
import {
  BarChart3,
  Building2,
  Coins,
  FileStack,
  Layers,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { FilterBar, Pagination } from '@/components/layout/list-controls';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import {
  loadReport,
  loadReportOptions,
  type ReportFilter,
} from '@/server/application/report-service';
import { reportFilterSchema } from '@/lib/validation/report';
import { Card, CardBar, CardContent, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/workflow/status-badge';
import {
  EmptyRow,
  TBody,
  TD,
  TDNum,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import { CASE_STATUSES, CASE_STATUS_LABELS, type CaseStatus } from '@/server/domain/shared/enums';
import { ExportPanel } from './export-panel';

export const dynamic = 'force-dynamic';

/** Tiles abbreviate; the register shows the exact amount to the minor unit. */
const COMPACT_BASE = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const MONEY = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

function compact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return COMPACT_BASE.format(value);
}

/** A labelled proportion bar, used for every breakdown on the page. */
function Bar({
  label,
  count,
  total,
  meta,
}: {
  label: string;
  count: number;
  total: number;
  meta?: string;
}) {
  const percent = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[12px]">
        <span className="min-w-0 truncate font-semibold text-ink">{label}</span>
        <span className="tabular shrink-0 text-ink-3">
          {meta ? `${meta} · ` : ''}
          {count.toLocaleString()} · {percent}%
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-nib-gold-500 to-nib-gold-400 transition-all duration-500"
          style={{ width: `${count > 0 ? Math.max(percent, 3) : 0}%` }}
        />
      </div>
    </li>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  if (
    !actor.permissions.has(PERMISSIONS.REPORT_OPERATIONAL) &&
    !actor.permissions.has(PERMISSIONS.REPORT_PERFORMANCE)
  ) {
    return <AccessDenied permission="report:operational" what="departmental reports" />;
  }

  const raw = await searchParams;
  const parsed = reportFilterSchema.safeParse(raw);
  const filter: ReportFilter = parsed.success ? parsed.data : {};

  const [report, options] = await Promise.all([
    loadReport(actor, filter),
    loadReportOptions(actor),
  ]);

  const isFiltered = Boolean(
    filter.from ||
    filter.to ||
    filter.status ||
    filter.discipline ||
    filter.orgId ||
    filter.requestTypeCode ||
    filter.valuedOnly,
  );

  // The export and the pager both need the live filter as a query string.
  const queryOf = (overrides: Record<string, string | undefined> = {}) => {
    const next = new URLSearchParams();
    const merged: Record<string, unknown> = { ...filter, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || value === '' || value === false) continue;
      next.set(key, value === true ? '1' : String(value));
    }
    return next.toString();
  };

  const currentQuery = queryOf({ page: undefined });
  const buildHref = (page: number) => {
    const q = queryOf({ page: String(page) });
    return q ? `/reports?${q}` : '/reports';
  };

  const { summary } = report;
  const coverage = summary.cases > 0 ? Math.round((summary.valued / summary.cases) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Monitoring"
        title="Reports & Valuation Analytics"
        subtitle="Operational volume, appraised collateral value and branch throughput. Every figure below is computed over the filtered set, so the headline totals, the breakdowns and the export all reconcile."
        actions={
          <Badge variant="brand" size="lg">
            {summary.cases.toLocaleString()} {isFiltered ? 'matching' : 'cases'}
          </Badge>
        }
      />

      <FilterBar clearHref={isFiltered ? '/reports' : undefined}>
        <Field label="Raised from" htmlFor="from" className="w-full sm:w-40">
          <Input id="from" name="from" type="date" defaultValue={filter.from ?? ''} />
        </Field>
        <Field label="Raised to" htmlFor="to" className="w-full sm:w-40">
          <Input id="to" name="to" type="date" defaultValue={filter.to ?? ''} />
        </Field>

        <Field label="Requesting unit" htmlFor="orgId" className="w-full sm:w-56">
          <Select id="orgId" name="orgId" defaultValue={filter.orgId ?? ''}>
            <option value="">All units</option>
            {options.organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Discipline" htmlFor="discipline" className="w-full sm:w-40">
          <Select id="discipline" name="discipline" defaultValue={filter.discipline ?? ''}>
            <option value="">Both</option>
            <option value="CIVIL">Civil</option>
            <option value="MECHANICAL">Mechanical</option>
          </Select>
        </Field>

        <Field label="Status" htmlFor="status" className="w-full sm:w-52">
          <Select id="status" name="status" defaultValue={filter.status ?? ''}>
            <option value="">All statuses</option>
            {CASE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CASE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Request type" htmlFor="requestTypeCode" className="w-full sm:w-52">
          <Select
            id="requestTypeCode"
            name="requestTypeCode"
            defaultValue={filter.requestTypeCode ?? ''}
          >
            <option value="">All types</option>
            {options.requestTypes.map((type) => (
              <option key={type.code} value={type.code}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex h-10 cursor-pointer items-center gap-2.5 self-end rounded-(--radius-control) border border-line bg-surface px-3.5 text-[12.5px] transition-colors hover:border-line-strong hover:bg-surface-2">
          <input
            type="checkbox"
            name="valuedOnly"
            value="1"
            defaultChecked={filter.valuedOnly}
            className="h-4 w-4 shrink-0 rounded border-line-strong accent-nib-gold-500"
          />
          Valued cases only
        </label>
      </FilterBar>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-ink-3">
          Showing{' '}
          <span className="tabular font-semibold text-ink-2">
            {report.rows.length.toLocaleString()}
          </span>{' '}
          of{' '}
          <span className="tabular font-semibold text-ink-2">{summary.cases.toLocaleString()}</span>{' '}
          cases within your reporting scope.
        </p>
        <ExportPanel query={currentQuery} rowCount={summary.cases} />
      </div>

      <StatGrid>
        <StatCard
          label="Cases in scope"
          value={summary.cases.toLocaleString()}
          caption={`${summary.valued.toLocaleString()} carry a final value`}
          icon={FileStack}
          tone="brand"
        />
        <StatCard
          label="Market value"
          value={compact(summary.marketValue)}
          unit="ETB"
          caption="Sum of final values"
          icon={Wallet}
          tone="good"
        />
        <StatCard
          label="Forced sale value"
          value={compact(summary.forcedSaleValue)}
          unit="ETB"
          caption="Discounted collateral base"
          icon={TrendingUp}
        />
        <StatCard
          label="Average case value"
          value={compact(summary.averageValue)}
          unit="ETB"
          caption={`Largest ${compact(summary.largestValue)}`}
          icon={Coins}
        />
      </StatGrid>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="overflow-hidden">
          <CardBar>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
              By status
            </CardTitle>
          </CardBar>
          <CardContent className="pt-6">
            {report.byStatus.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-3">Nothing in scope.</p>
            ) : (
              <ul className="space-y-3.5">
                {report.byStatus.map((row) => (
                  <Bar
                    key={row.status}
                    label={CASE_STATUS_LABELS[row.status] ?? row.status}
                    count={row.count}
                    total={summary.cases}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardBar>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
              By requesting unit
            </CardTitle>
          </CardBar>
          <CardContent className="pt-6">
            {report.byOrg.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-ink-3">Nothing in scope.</p>
            ) : (
              <ul className="space-y-3.5">
                {report.byOrg.slice(0, 10).map((row) => (
                  <Bar
                    key={row.id ?? row.name}
                    label={row.name}
                    count={row.count}
                    total={summary.cases}
                    meta={row.value > 0 ? `${compact(row.value)} ETB` : undefined}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
                Valuation coverage
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <p className="tabular text-[32px] font-extrabold leading-none text-ink">
                {coverage}
                <span className="text-lg text-ink-3">%</span>
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                {summary.valued.toLocaleString()} of {summary.cases.toLocaleString()} cases carry a
                final value. {summary.unvalued.toLocaleString()} are still in progress or were
                closed without one.
              </p>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full border border-line bg-surface-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-st-done to-st-done/70 transition-all duration-500"
                  style={{ width: `${coverage}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
                By discipline
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              {report.byDiscipline.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-3">Nothing in scope.</p>
              ) : (
                <ul className="space-y-3.5">
                  {report.byDiscipline.map((row) => (
                    <Bar
                      key={row.discipline}
                      label={row.discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}
                      count={row.count}
                      total={summary.cases}
                      meta={row.value > 0 ? `${compact(row.value)} ETB` : undefined}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {report.byType.length > 0 ? (
        <Card className="overflow-hidden">
          <CardBar>
            <CardTitle className="flex items-center gap-2">
              <FileStack className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
              By request type
            </CardTitle>
          </CardBar>
          <CardContent className="pt-6">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {report.byType.map((row) => (
                <div
                  key={row.id ?? row.name}
                  className="rounded-(--radius-control) border border-line bg-surface-2/50 px-3.5 py-3"
                >
                  <dt className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">
                    {row.name}
                  </dt>
                  <dd className="tabular mt-1.5 text-xl font-extrabold leading-none text-ink">
                    {row.count.toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <TableWrap>
        <TableBar>
          <TableTitle>
            <FileStack className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Case register
          </TableTitle>
          <Badge variant="default">
            Page {report.page} of {report.pageCount}
          </Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Case number</TH>
                <TH>Requesting unit</TH>
                <TH>Type</TH>
                <TH>Discipline</TH>
                <TH>Status</TH>
                <TH className="text-right">Market value (ETB)</TH>
                <TH className="text-right">Forced sale (ETB)</TH>
                <TH className="text-right">Raised</TH>
              </TR>
            </THead>
            <TBody>
              {report.rows.length === 0 ? (
                <EmptyRow
                  colSpan={8}
                  icon={BarChart3}
                  title={isFiltered ? 'No cases match' : 'Nothing to report on yet'}
                >
                  {isFiltered
                    ? 'No cases match these filters. Try widening the date range or clearing the status.'
                    : 'No valuation records are available within your reporting scope.'}
                </EmptyRow>
              ) : (
                report.rows.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Link
                        href={`/requests/${row.id}`}
                        className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                      >
                        {row.caseNumber}
                      </Link>
                      <span className="block text-[11px] text-ink-3">{row.ownerName}</span>
                    </TD>
                    <TD className="text-[12px] text-ink-2">{row.requestingOrg?.name ?? '—'}</TD>
                    <TD className="text-[12px]">{row.requestType?.name ?? '—'}</TD>
                    <TD>
                      <Badge variant="brand" size="sm">
                        {row.discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}
                      </Badge>
                    </TD>
                    <TD>
                      <StatusBadge status={row.status as CaseStatus} />
                    </TD>
                    <TDNum className="text-[12px]">
                      {row.finalValue ? MONEY.format(Number(row.finalValue)) : '—'}
                    </TDNum>
                    <TDNum className="text-[12px] font-normal text-ink-2">
                      {row.forcedSaleValue ? MONEY.format(Number(row.forcedSaleValue)) : '—'}
                    </TDNum>
                    <TDNum className="text-[12px] font-normal text-ink-2">
                      {DATE.format(row.createdAt)}
                    </TDNum>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={report.page}
        pageCount={report.pageCount}
        total={report.total}
        noun="cases"
        buildHref={buildHref}
      />
    </div>
  );
}
