import Link from 'next/link';
import {
  Archive,
  Clock,
  FilePlus2,
  FileText,
  Inbox,
  ListChecks,
  Stamp,
  Undo2,
  Wallet,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import {
  DASHBOARD_TILES,
  loadDashboardDetail,
  loadDashboardSummary,
  loadDashboardTrends,
} from '@/server/application/dashboard-service';
import { AttentionPanel, Pipeline } from '@/components/dashboard/pipeline';
import {
  CompletedTile,
  OnTrackTile,
  VolumeCard,
  WeekCard,
  WelcomeCard,
  type QueueItem,
} from '@/components/dashboard/overview';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardBar, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCompact, formatCurrency } from '@/lib/money';
import { CASE_STATUS_LABELS, type CaseStatus } from '@/server/domain/shared/enums';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const actor = await requireActor();
  const [summary, detail, trends] = await Promise.all([
    loadDashboardSummary(actor),
    loadDashboardDetail(actor),
    loadDashboardTrends(actor),
  ]);

  const tiles = DASHBOARD_TILES[summary.kind];
  const counts = new Map(summary.byStatus.map((row) => [row.status, row.count]));
  const completed = counts.get('COMPLETED') ?? 0;
  const archived = counts.get('ARCHIVED') ?? 0;
  const pendingApproval =
    (counts.get('PENDING_MANAGER_APPROVAL') ?? 0) + (counts.get('PENDING_DIRECTOR_APPROVAL') ?? 0);
  const requestsThisWeek = trends.requestsByDay.reduce((sum, p) => sum + p.count, 0);

  const canApprove =
    actor.permissions.has(PERMISSIONS.APPROVAL_MANAGER) ||
    actor.permissions.has(PERMISSIONS.APPROVAL_DIRECTOR);
  const canCreate = actor.permissions.has(PERMISSIONS.CASE_CREATE);

  const firstName = actor.fullName.split(' ')[0] || actor.fullName;

  const queue: QueueItem[] = [
    {
      label: 'My open tasks',
      value: summary.openTasks,
      icon: ListChecks,
      tone: summary.openTasks > 0 ? 'brand' : 'default',
      href: '/tasks',
    },
    {
      label: 'Due within 24 hours',
      value: summary.dueSoon,
      icon: Clock,
      tone: summary.dueSoon > 0 ? 'warning' : 'default',
    },
    canApprove
      ? {
          label: 'Pending approval',
          value: pendingApproval,
          icon: Stamp,
          tone: pendingApproval > 0 ? 'warning' : 'default',
          href: '/tasks/approvals',
        }
      : {
          label: 'Returned for correction',
          value: summary.returned,
          icon: Undo2,
          tone: summary.returned > 0 ? 'danger' : 'default',
          href: '/tasks/returned',
        },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 2xl:grid-cols-12">
        <div className="2xl:col-span-5">
          <WelcomeCard
            firstName={firstName}
            total={summary.total}
            awaitingAction={detail.awaitingAction}
            overdue={summary.overdue}
            returned={summary.returned}
            actions={
              <>
                {canCreate ? (
                  <Button asChild size="sm">
                    <Link href="/requests/new">
                      <FilePlus2 aria-hidden="true" />
                      New request
                    </Link>
                  </Button>
                ) : null}
                <Button asChild size="sm" variant={canCreate ? 'outline' : 'default'}>
                  <Link href="/requests">
                    <FileText aria-hidden="true" />
                    All cases
                  </Link>
                </Button>
              </>
            }
          />
        </div>
        <div className="2xl:col-span-7">
          <WeekCard trends={trends} />
        </div>
      </div>

      <div className="grid gap-6 2xl:grid-cols-12">
        <section
          aria-label="Key figures"
          className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4 2xl:col-span-5 2xl:grid-cols-2"
        >
          <StatCard
            label="Total cases"
            value={summary.total}
            icon={Inbox}
            tone="brand"
            href="/requests"
            delta={{
              label: `${requestsThisWeek} new this week`,
              direction: requestsThisWeek > 0 ? 'up' : 'flat',
              good: true,
            }}
          />
          <CompletedTile
            completed={completed}
            completedThisWeek={detail.completedThisWeek}
            byMonth={trends.completionsByMonth}
          />
          <OnTrackTile
            percent={detail.slaOnTrackPercent}
            tracked={detail.slaTracked}
            late={detail.slaLate}
          />
          <StatCard
            label="Value in scope"
            value={formatCompact(detail.totalValue)}
            unit="ETB"
            caption={`${formatCurrency(detail.totalValue)} · ${archived} archived`}
            icon={Wallet}
            tone="brand"
          />
        </section>
        <div className="2xl:col-span-7">
          <VolumeCard trends={trends} queue={queue} />
        </div>
      </div>

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Pipeline stages={detail.pipeline} />
        </div>
        <AttentionPanel items={detail.attention} />
      </section>

      {tiles.length > 0 ? (
        <Card className="overflow-hidden">
          <CardBar>
            <div className="min-w-0">
              <CardTitle>Cases by Status</CardTitle>
              <CardDescription className="mt-0.5">
                Counts cover only the cases you are authorised to see, so they reconcile exactly
                with your case list.
              </CardDescription>
            </div>
          </CardBar>
          <CardContent className="pt-6">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {tiles.map((status) => {
                const count = counts.get(status as CaseStatus) ?? 0;
                return (
                  <Link
                    key={status}
                    href={`/requests?status=${status}`}
                    className="group rounded-(--radius-control) border border-transparent bg-surface-2 px-3.5 py-3 transition-[background-color,border-color] duration-200 hover:border-nib-gold-500/40 hover:bg-nib-gold-500/10"
                  >
                    <dt className="truncate text-[12px] text-ink-3">
                      {CASE_STATUS_LABELS[status as CaseStatus]}
                    </dt>
                    <dd className="mt-1 text-xl font-bold leading-tight text-ink">{count}</dd>
                  </Link>
                );
              })}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {summary.kind === 'ADMIN' ? (
        <Alert variant="info">
          <Archive aria-hidden="true" />
          <AlertTitle>Administrator account — full access</AlertTitle>
          <AlertDescription>
            You can reach and act on every case in every unit, in any workflow role. Each action is
            recorded against the ADMIN role, so an override is visible in the case timeline rather
            than indistinguishable from ordinary work. You still cannot approve a case you
            personally valued or checked.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
