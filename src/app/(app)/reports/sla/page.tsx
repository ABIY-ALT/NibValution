import Link from 'next/link';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Gauge,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import {
  SLA_STATES,
  loadSlaReport,
  type SlaReport,
  type SlaStateFilter,
} from '@/server/application/sla-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { LIST_PAGE_SIZE, Pagination, pageHref, readPage } from '@/components/layout/list-controls';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { WEEKDAYS } from '@/lib/validation/sla';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import type { CaseStatus } from '@/server/domain/shared/enums';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const STATE_LABELS: Record<SlaStateFilter, string> = {
  GREEN: 'On track',
  WARNING: 'Approaching',
  BREACHED: 'Breached',
  PAUSED: 'Paused',
  CLOSED: 'Closed',
};

/** The policy's stage budgets, in workflow order, in the words the department uses. */
const STAGES: { key: string; label: string; note: string }[] = [
  { key: 'ASSIGNMENT', label: 'Intake & assignment', note: 'Maker allocated' },
  { key: 'VALUATION', label: 'Field & valuation', note: 'Maker assessment' },
  { key: 'CHECKING', label: 'Checking review', note: 'Checker validation' },
  { key: 'APPROVAL', label: 'Approval & letter', note: 'Threshold clearance' },
];

type Row = SlaReport['rows'][number];

function SlaBadge({ row }: { row: Row }) {
  if (row.status === 'CLOSED') {
    return row.breachedAt ? (
      <Badge variant="danger" size="sm">
        Closed late
      </Badge>
    ) : (
      <Badge variant="success" size="sm">
        Closed on time
      </Badge>
    );
  }
  const variant = {
    GREEN: 'success',
    WARNING: 'warning',
    BREACHED: 'danger',
    PAUSED: 'info',
  } as const;
  return (
    <Badge variant={variant[row.status]} size="sm">
      {STATE_LABELS[row.status]}
    </Badge>
  );
}

function days(value: unknown): string {
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default async function SlaTrackingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.REPORT_SLA)) {
    return <AccessDenied permission="report:sla" what="SLA performance analytics" />;
  }

  const params = await searchParams;
  const state = (SLA_STATES as readonly string[]).includes(params.state ?? '')
    ? (params.state as SlaStateFilter)
    : undefined;
  const report = await loadSlaReport(actor, {
    state,
    page: readPage(params.page),
    pageSize: LIST_PAGE_SIZE,
  });
  const { policy, counts } = report;
  const canConfigure = actor.permissions.has(PERMISSIONS.SLA_CONFIG);
  const allTotal = report.open + report.closed;
  const week = WEEKDAYS.filter((d) => policy?.workingDaysOfWeek.includes(d.day))
    .map((d) => d.short)
    .join(' · ');

  const filterTabs: { key: SlaStateFilter | undefined; label: string; count: number }[] = [
    { key: undefined, label: 'All', count: allTotal },
    ...SLA_STATES.map((s) => ({ key: s, label: STATE_LABELS[s], count: counts[s] })),
  ];

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Monitoring"
        title="SLA Performance & Turnaround"
        subtitle="Every case measured against the working-day policy: the clock starts when a request reaches the department, stops while it is back with the requester, and closes on completion."
        actions={
          <>
            <Badge variant="brand" size="lg">
              Standard policy: {policy?.totalWorkingDays ?? '—'}{' '}
              {policy?.countCalendarDays ? 'calendar' : 'working'} days
            </Badge>
            {canConfigure ? (
              <Button asChild variant="outline">
                <Link href="/admin/sla">
                  <CalendarDays aria-hidden="true" />
                  Calendar settings
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="On-time completion"
          value={report.compliancePercent === null ? '—' : `${report.compliancePercent}%`}
          caption={
            report.closed === 0
              ? 'No completed cases yet'
              : `${report.closed - report.closedLate} of ${report.closed} completed within the allowance`
          }
          icon={ShieldCheck}
          tone={
            report.compliancePercent === null
              ? 'default'
              : report.compliancePercent >= 80
                ? 'good'
                : report.compliancePercent >= 50
                  ? 'warning'
                  : 'danger'
          }
        />
        <StatCard
          label="On track"
          value={counts.GREEN}
          caption={
            counts.PAUSED > 0
              ? `Plus ${counts.PAUSED} paused with the requester`
              : 'Open, under the warning point'
          }
          icon={CheckCircle2}
          tone={counts.GREEN > 0 ? 'good' : 'default'}
        />
        <StatCard
          label="Approaching"
          value={counts.WARNING}
          caption={`Past ${policy?.warningPercent ?? 80}% of the allowance`}
          icon={Clock}
          tone={counts.WARNING > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Breached"
          value={counts.BREACHED}
          caption="Open and past the due date"
          icon={AlertTriangle}
          tone={counts.BREACHED > 0 ? 'danger' : 'default'}
        />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-1">
          <CardBar>
            <CardTitle className="flex items-center gap-3">
              <CardIcon icon={Gauge} />
              Active policy
            </CardTitle>
          </CardBar>
          <CardContent className="pt-5">
            {policy ? (
              <dl className="text-[12.5px]">
                {[
                  [
                    'Allowance',
                    `${policy.totalWorkingDays} ${policy.countCalendarDays ? 'calendar' : 'working'} days`,
                  ],
                  ['Warning point', `${policy.warningPercent}% used`],
                  ['Working week', policy.countCalendarDays ? 'Every day counts' : week],
                  ['Cases tracked', `${report.open} open · ${report.closed} closed`],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0"
                  >
                    <dt className="text-ink-3">{term}</dt>
                    <dd className="tabular text-right font-semibold text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-3">
                No active SLA policy is configured.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden lg:col-span-2">
          <CardBar>
            <CardTitle className="flex items-center gap-3">
              <CardIcon icon={Timer} />
              Stage budgets
            </CardTitle>
          </CardBar>
          <CardContent className="pt-5">
            <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {STAGES.map((stage, index) => {
                const budget = policy?.stageBudgets[stage.key];
                return (
                  <li
                    key={stage.key}
                    className="rounded-(--radius-control) border border-line bg-surface-2/50 p-4"
                  >
                    <span className="tabular mb-2 flex h-6 w-6 items-center justify-center rounded-full bg-nib-gold-500 text-[11px] font-bold text-nib-brown-900">
                      {index + 1}
                    </span>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-ink-3">
                      {stage.label}
                    </p>
                    <p className="tabular mt-1 text-lg font-extrabold leading-none text-ink">
                      {budget === undefined ? '—' : `${budget} ${budget === 1 ? 'day' : 'days'}`}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-3">{stage.note}</p>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>

      <nav aria-label="Filter by SLA state" className="flex flex-wrap gap-2">
        {filterTabs.map((tab) => {
          const active = tab.key === state;
          return (
            <Link
              key={tab.label}
              href={pageHref('/reports/sla', { state: tab.key }, 1)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors',
                active
                  ? 'border-nib-gold-500 bg-nib-gold-500 text-nib-brown-900 shadow-brand'
                  : 'border-line bg-surface text-ink-2 shadow-card hover:border-line-strong hover:text-ink',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'tabular rounded-full px-1.5 text-[11px]',
                  active ? 'bg-nib-brown-900/12' : 'bg-surface-2 text-ink-3',
                )}
              >
                {tab.count}
              </span>
            </Link>
          );
        })}
      </nav>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <Timer className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            SLA register{state ? ` — ${STATE_LABELS[state]}` : ''}
          </TableTitle>
          <Badge variant="default">{report.total} records</Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Case number</TH>
                <TH>Branch / unit</TH>
                <TH>Discipline</TH>
                <TH>Case status</TH>
                <TH className="text-right">Started</TH>
                <TH className="text-right">Due</TH>
                <TH className="text-right">Days used</TH>
                <TH className="text-center">SLA</TH>
                <TH className="text-right">
                  <span className="sr-only">Open</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {report.rows.length === 0 ? (
                <EmptyRow colSpan={9} icon={Timer} title="No SLA records here">
                  {state
                    ? 'No case is in this state at the moment.'
                    : 'Records start when a request is submitted to the department.'}
                </EmptyRow>
              ) : (
                report.rows.map((row) => {
                  const paused = Number(row.elapsedWorkingDays) - Number(row.netWorkingDays);
                  return (
                    <TR key={row.id}>
                      <TD>
                        <Link
                          href={`/requests/${row.case.id}`}
                          className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                        >
                          {row.case.caseNumber}
                        </Link>
                        <span className="block text-[11px] text-ink-3">
                          {row.case.applicantName}
                        </span>
                      </TD>
                      <TD className="text-[12px] text-ink-2">{row.case.requestingOrg.name}</TD>
                      <TD>
                        <Badge variant="brand" size="sm">
                          {row.case.discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}
                        </Badge>
                      </TD>
                      <TD>
                        <StatusBadge status={row.case.status as CaseStatus} />
                      </TD>
                      <TDNum className="text-[12px] font-normal text-ink-2">
                        {DATE.format(row.startedAt)}
                      </TDNum>
                      <TDNum className="text-[12px]">
                        {DATE.format(row.dueAt)}
                        {row.completedAt ? (
                          <span className="block text-[11px] font-normal text-ink-3">
                            done {DATE.format(row.completedAt)}
                          </span>
                        ) : null}
                      </TDNum>
                      <TDNum className="text-[12px]">
                        {days(row.netWorkingDays)} / {policy?.totalWorkingDays ?? '—'}
                        {paused > 0 ? (
                          <span className="block text-[11px] font-normal text-ink-3">
                            +{days(paused)} paused
                          </span>
                        ) : null}
                      </TDNum>
                      <TD className="text-center">
                        <SlaBadge row={row} />
                      </TD>
                      <TD className="text-right">
                        <Button asChild variant="ghost" size="icon-sm">
                          <Link
                            href={`/requests/${row.case.id}`}
                            aria-label={`Open case ${row.case.caseNumber}`}
                          >
                            <ExternalLink aria-hidden="true" />
                          </Link>
                        </Button>
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={report.page}
        pageCount={report.pageCount}
        total={report.total}
        pageSize={report.pageSize}
        noun="records"
        buildHref={(page) => pageHref('/reports/sla', { state }, page)}
      />
    </div>
  );
}
