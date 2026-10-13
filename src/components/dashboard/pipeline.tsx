import Link from 'next/link';
import { ArrowRight, CheckCircle2, Layers, TriangleAlert } from 'lucide-react';
import { Card, CardBar, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { PipelineStage } from '@/server/application/dashboard-service';

/**
 * Where cases currently sit, and how long they have been sitting there.
 *
 * The bar is scaled against the busiest stage rather than the total, so a
 * bottleneck is visible even when one stage dominates. The average age beside
 * it is the number a manager acts on: four cases held for 26 days is a
 * different problem from four held for two, and a count alone cannot say which.
 */
export function Pipeline({ stages }: { stages: PipelineStage[] }) {
  const busiest = Math.max(1, ...stages.map((s) => s.count));
  const total = stages.reduce((sum, s) => sum + s.count, 0);

  return (
    <Card className="overflow-hidden">
      <CardBar>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
            Valuation Pipeline
          </CardTitle>
          <CardDescription className="mt-0.5">
            Where cases currently sit, and how long they have been there.
          </CardDescription>
        </div>
      </CardBar>

      <CardContent className="pt-6">
        {total === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink-3">
            No cases are in progress. Stages will populate as requests are submitted.
          </p>
        ) : (
          <ol className="space-y-3">
            {stages.map((stage, index) => (
              <li key={stage.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="tabular flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-[11px] font-bold text-ink-2">
                  {index + 1}
                </span>

                <span className="w-40 shrink-0 truncate text-[13px] font-semibold text-ink">
                  {stage.label}
                </span>

                <span className="relative h-8 min-w-[8rem] flex-1 overflow-hidden rounded-(--radius-control) bg-surface-2">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 flex items-center rounded-(--radius-control) px-2.5 transition-all duration-500',
                      stage.overdue > 0
                        ? 'bg-gradient-to-r from-st-late/30 to-st-late/15'
                        : 'bg-gradient-to-r from-nib-gold-500/45 to-nib-gold-500/20',
                    )}
                    style={{
                      width: `${Math.max(stage.count > 0 ? 16 : 0, (stage.count / busiest) * 100)}%`,
                    }}
                  >
                    {stage.count > 0 ? (
                      <span className="tabular whitespace-nowrap text-[11px] font-bold text-ink">
                        {stage.count} {stage.count === 1 ? 'case' : 'cases'}
                      </span>
                    ) : null}
                  </span>
                </span>

                <span className="w-24 shrink-0 text-right">
                  {stage.count > 0 ? (
                    <>
                      <span className="tabular block text-[12px] font-semibold text-ink-2">
                        avg {stage.averageDays}d
                      </span>
                      {stage.overdue > 0 ? (
                        <span className="tabular block text-[11px] font-bold text-st-late">
                          {stage.overdue} overdue
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[12px] text-ink-3">—</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export function AttentionPanel({
  items,
}: {
  items: {
    id: string;
    caseNumber: string;
    title: string;
    holder: string;
    daysOverdue: number;
    dueAt: Date | null;
  }[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardBar>
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="h-[18px] w-[18px] text-st-late" aria-hidden="true" />
            Management Attention
          </CardTitle>
          <CardDescription className="mt-0.5">Past the turnaround standard.</CardDescription>
        </div>
        <Link
          href="/tasks/overdue"
          className="flex shrink-0 items-center gap-1 text-[12px] font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 dark:text-nib-gold-400"
        >
          All
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardBar>

      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-st-done-bg text-st-done">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-[13px] font-bold text-ink">Nothing is overdue</p>
            <p className="mt-1 text-[12px] text-ink-3">
              Every open case is within its turnaround standard.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li
                key={item.id}
                className="border-l-[3px] border-st-late/60 px-5 py-3.5 transition-colors hover:bg-st-late-bg/40"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/requests/${item.id}`}
                    className="text-[13px] font-bold text-ink hover:text-nib-gold-700 hover:underline dark:hover:text-nib-gold-400"
                  >
                    {item.caseNumber}
                  </Link>
                  <span className="tabular shrink-0 text-[11px] font-bold text-st-late">
                    {item.daysOverdue} {item.daysOverdue === 1 ? 'day' : 'days'} overdue
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12px] text-ink-2">{item.title}</p>
                <p className="text-[11px] text-ink-3">{item.holder}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
