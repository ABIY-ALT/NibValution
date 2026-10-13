import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DeltaText, type StatDelta } from '@/components/ui/stat-card';
import { AreaChart, ColumnChart, Gauge } from '@/components/dashboard/charts';
import type { DashboardTrends, TrendPoint } from '@/server/application/dashboard-service';
import { cn } from '@/lib/utils';

/**
 * The dashboard's lead panels: a greeting that states the position, the week
 * in two small charts, the year's volume beside the viewer's own queue, and the
 * two figure tiles that need more than a number.
 */

const total = (points: TrendPoint[]) => points.reduce((sum, p) => sum + p.count, 0);

/** This week against the week before, as the tile's delta line. */
export function weekOnWeek(current: number, prior: number): StatDelta {
  if (current === prior) return { label: 'No change', direction: 'flat', good: true };
  if (prior === 0) return { label: `+${current}`, direction: 'up', good: true };
  const change = Math.abs(((current - prior) / prior) * 100);
  return {
    label: `${change >= 10 ? Math.round(change) : change.toFixed(1)}%`,
    direction: current > prior ? 'up' : 'down',
    good: current > prior,
  };
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

/** A house and a tower under a gold seal: property, valued and approved. */
function ValuationIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 150" aria-hidden="true" className={className}>
      <ellipse
        cx="90"
        cy="143"
        rx="74"
        ry="6"
        className="fill-nib-brown-900/10 dark:fill-black/40"
      />

      {/* Tower */}
      <rect
        x="92"
        y="24"
        width="54"
        height="119"
        rx="3"
        className="fill-nib-gold-200 dark:fill-nib-brown-700"
      />
      {[0, 1, 2, 3, 4, 5].map((row) =>
        [0, 1, 2].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={100 + col * 14}
            y={34 + row * 16}
            width="9"
            height="9"
            rx="1.5"
            className="fill-white/85 dark:fill-nib-brown-900/60"
          />
        )),
      )}

      {/* House */}
      <rect
        x="76"
        y="54"
        width="9"
        height="20"
        className="fill-nib-brown-700 dark:fill-nib-brown-600"
      />
      <rect
        x="30"
        y="82"
        width="64"
        height="61"
        className="fill-nib-gold-100 dark:fill-nib-brown-800"
      />
      <path d="M20 86 L62 52 L104 86 Z" className="fill-nib-brown-700 dark:fill-nib-brown-600" />
      <rect x="38" y="95" width="14" height="13" rx="1.5" className="fill-nib-gold-400" />
      <rect x="72" y="95" width="14" height="13" rx="1.5" className="fill-nib-gold-400" />
      <rect
        x="54"
        y="110"
        width="16"
        height="33"
        rx="2"
        className="fill-nib-brown-700 dark:fill-nib-brown-600"
      />
      <circle cx="66" cy="127" r="1.4" className="fill-nib-gold-400" />

      {/* Seal */}
      <path
        d="M133 118 L125 146 L133 141 L138 149 L144 122 Z"
        className="fill-nib-brown-700 dark:fill-nib-brown-600"
      />
      <path
        d="M151 118 L159 146 L151 141 L146 149 L140 122 Z"
        className="fill-nib-brown-800 dark:fill-nib-brown-700"
      />
      <circle cx="142" cy="110" r="20" className="fill-nib-gold-500" />
      <circle
        cx="142"
        cy="110"
        r="15"
        fill="none"
        strokeWidth="1.5"
        strokeDasharray="2 2.5"
        className="stroke-nib-gold-100"
      />
      <path
        d="M133.5 110.5 L139.5 116.5 L151 104"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-nib-brown-900"
      />

      {/* Glints */}
      <path
        d="M78 22 L79.6 27.4 L85 29 L79.6 30.6 L78 36 L76.4 30.6 L71 29 L76.4 27.4 Z"
        className="fill-nib-gold-400"
      />
      <path
        d="M160 58 L161 61 L164 62 L161 63 L160 66 L159 63 L156 62 L159 61 Z"
        className="fill-nib-gold-500"
      />
    </svg>
  );
}

export function WelcomeCard({
  firstName,
  total: caseTotal,
  awaitingAction,
  overdue,
  returned,
  actions,
}: {
  firstName: string;
  total: number;
  awaitingAction: number;
  overdue: number;
  returned: number;
  actions: React.ReactNode;
}) {
  return (
    <Card className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col p-6">
        <h1 className="text-[20px] font-semibold leading-snug tracking-tight text-ink">
          Good day, {firstName}
        </h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
          {caseTotal === 0 ? (
            'No valuation cases are currently within your scope.'
          ) : (
            <>
              <strong className="font-semibold text-ink">{caseTotal}</strong>{' '}
              {caseTotal === 1 ? 'case' : 'cases'} in your scope,{' '}
              <strong className="font-semibold text-ink">{overdue}</strong> past the turnaround
              standard and <strong className="font-semibold text-ink">{returned}</strong> back for
              correction.
            </>
          )}
        </p>

        <p className="mt-5 text-[32px] font-bold leading-none tracking-tight text-nib-gold-800 dark:text-nib-gold-400">
          {awaitingAction}
        </p>
        <p className="mt-1.5 text-[13px] text-ink-2">
          {awaitingAction === 1 ? 'case is' : 'cases are'} waiting on someone to act
        </p>

        <div className="mt-auto flex flex-wrap gap-2 pt-6">{actions}</div>
      </div>

      <div className="hidden w-44 shrink-0 items-end pb-3 pr-6 pt-6 sm:flex">
        <ValuationIllustration className="w-full" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

function WeekPanel({
  title,
  figure,
  delta,
  children,
  className,
}: {
  title: string;
  figure: number;
  delta: StatDelta;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-w-0 flex-col p-6', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-section font-semibold tracking-tight text-ink">{title}</h2>
        <span className="shrink-0 text-[12px] text-ink-3">Last 7 days</span>
      </div>
      <div className="mt-auto flex items-end gap-5 pt-8">
        <div className="shrink-0">
          <p className="text-[30px] font-bold leading-none tracking-tight text-ink">{figure}</p>
          <DeltaText delta={delta} className="mt-2.5" />
          <p className="mt-0.5 text-[11.5px] text-ink-3">vs prior 7 days</p>
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

export function WeekCard({ trends }: { trends: DashboardTrends }) {
  const requested = total(trends.requestsByDay);
  const completed = total(trends.completionsByDay);

  return (
    <Card className="grid h-full sm:grid-cols-2">
      <WeekPanel
        title="New Requests"
        figure={requested}
        delta={weekOnWeek(requested, trends.requestsPriorWeek)}
      >
        <ColumnChart
          points={trends.requestsByDay}
          unit={['request', 'requests']}
          label="Requests received per day, last 7 days"
        />
      </WeekPanel>
      <WeekPanel
        title="Completed"
        figure={completed}
        delta={weekOnWeek(completed, trends.completionsPriorWeek)}
        className="border-t border-line sm:border-l sm:border-t-0"
      >
        <AreaChart
          points={trends.completionsByDay}
          unit={['case completed', 'cases completed']}
          label="Cases completed per day, last 7 days"
        />
      </WeekPanel>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The year, and the viewer's queue
// ---------------------------------------------------------------------------

export interface QueueItem {
  label: string;
  value: number;
  icon: LucideIcon;
  /** The icon plate's colour; `default` for a figure that needs nothing. */
  tone: 'brand' | 'warning' | 'danger' | 'default';
  href?: string;
}

const QUEUE_TONES: Record<QueueItem['tone'], string> = {
  brand: 'text-nib-gold-700 dark:text-nib-gold-400',
  warning: 'text-st-review',
  danger: 'text-st-late',
  default: 'text-ink-3',
};

function QueueRow({ item }: { item: QueueItem }) {
  const Icon = item.icon;
  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-(--radius-control) bg-surface shadow-card',
          QUEUE_TONES[item.tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink-3">{item.label}</span>
        <span className="block text-[20px] font-semibold leading-tight text-ink">{item.value}</span>
      </span>
    </>
  );
  const shell = 'flex items-center gap-3 rounded-(--radius-control) bg-surface-2 p-3.5';

  return (
    <li>
      {item.href ? (
        <Link href={item.href} className={cn(shell, 'transition-colors hover:bg-surface-3')}>
          {body}
        </Link>
      ) : (
        <div className={shell}>{body}</div>
      )}
    </li>
  );
}

export function VolumeCard({ trends, queue }: { trends: DashboardTrends; queue: QueueItem[] }) {
  const yearTotal = total(trends.requestsByMonth);
  const average = yearTotal / 12;

  return (
    <Card className="grid h-full lg:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="min-w-0 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="text-section font-semibold tracking-tight text-ink">Case Volume</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">Requests received, last 12 months</p>
          </div>
          <p className="text-[13px] text-ink-3">
            <span className="font-semibold text-ink">{yearTotal}</span> in total · monthly avg.{' '}
            <span className="font-semibold text-ink">
              {average >= 10 ? Math.round(average) : average.toFixed(1)}
            </span>
          </p>
        </div>
        <AreaChart
          axis
          points={trends.requestsByMonth}
          unit={['request', 'requests']}
          label="Requests received per month, last 12 months"
          className="mt-6"
          plotClassName="h-56"
        />
      </section>

      <section className="border-t border-line p-6 lg:border-l lg:border-t-0">
        <h2 className="text-section font-semibold tracking-tight text-ink">Your Queue</h2>
        <p className="mt-0.5 text-[13px] text-ink-3">What is waiting on you now</p>
        <ul className="mt-5 space-y-3">
          {queue.map((item) => (
            <QueueRow key={item.label} item={item} />
          ))}
        </ul>
      </section>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Tiles with a picture
// ---------------------------------------------------------------------------

export function CompletedTile({
  completed,
  completedThisWeek,
  byMonth,
}: {
  completed: number;
  completedThisWeek: number;
  byMonth: TrendPoint[];
}) {
  return (
    <Card className="flex h-full flex-col p-5">
      <p className="text-[13px] font-medium text-ink-2">Completed</p>
      <p className="mt-1 text-[26px] font-bold leading-tight tracking-tight text-ink">
        {completed}
      </p>
      <p className="mt-0.5 truncate text-[12px] text-ink-3">
        {completedThisWeek} in the last 7 days
      </p>
      <ColumnChart
        points={byMonth.slice(-6)}
        unit={['case completed', 'cases completed']}
        label="Cases completed per month, last 6 months"
        className="mt-auto pt-4"
        plotClassName="h-14"
      />
    </Card>
  );
}

export function OnTrackTile({
  percent,
  tracked,
  late,
}: {
  percent: number | null;
  tracked: number;
  late: number;
}) {
  return (
    <Card className="flex h-full flex-col p-5">
      <p className="text-[13px] font-medium text-ink-2">Within turnaround</p>
      <div className="flex flex-1 items-center py-4">
        <Gauge
          percent={percent}
          label={
            percent === null
              ? 'No open cases are running against a turnaround standard'
              : `${percent}% of open cases are within their turnaround standard`
          }
        />
      </div>
      <p className="text-center text-[12px] text-ink-3">
        {tracked === 0 ? (
          'No open cases on the clock'
        ) : late === 0 ? (
          `All ${tracked} open ${tracked === 1 ? 'case is' : 'cases are'} on time`
        ) : (
          <Link
            href="/tasks/overdue"
            className="font-semibold text-st-late underline-offset-2 hover:underline"
          >
            {late} of {tracked} past the standard
          </Link>
        )}
      </p>
    </Card>
  );
}
