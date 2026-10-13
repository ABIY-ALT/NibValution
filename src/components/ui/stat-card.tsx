import Link from 'next/link';
import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The figure tile used at the top of every page that leads with numbers.
 *
 * One shape, one set of tones, defined once: the dashboard, the registries, the
 * notification centre and the reports all previously drew their own, which is
 * why the same "count of things" looked like four different components.
 *
 * The tinted icon plate leads, the label names the figure beneath it, and the
 * figure carries the weight - so a row of tiles scans down each column as
 * "what, then how many".
 */
export type StatTone = 'default' | 'brand' | 'good' | 'warning' | 'danger' | 'info';

const TONES: Record<StatTone, { icon: string; value: string }> = {
  default: { icon: 'bg-surface-3 text-ink-2', value: 'text-ink' },
  brand: {
    icon: 'bg-nib-gold-100 text-nib-gold-700 dark:bg-nib-gold-500/15 dark:text-nib-gold-400',
    value: 'text-ink',
  },
  good: { icon: 'bg-st-done-bg text-st-done', value: 'text-st-done' },
  warning: { icon: 'bg-st-review-bg text-st-review', value: 'text-st-review' },
  danger: { icon: 'bg-st-late-bg text-st-late', value: 'text-st-late' },
  info: { icon: 'bg-st-info-bg text-st-info', value: 'text-st-info' },
};

/**
 * A change against a named period. Colour follows whether the movement is good
 * news, not its direction: more completions is green, more overdue cases red.
 */
export interface StatDelta {
  label: string;
  direction: 'up' | 'down' | 'flat';
  good: boolean;
}

export function DeltaText({ delta, className }: { delta: StatDelta; className?: string }) {
  const Arrow = delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[12.5px] font-semibold',
        delta.direction === 'flat' ? 'text-ink-3' : delta.good ? 'text-st-done' : 'text-st-late',
        className,
      )}
    >
      {Arrow ? <Arrow className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {Arrow ? <span className="sr-only">{delta.direction === 'up' ? 'Up' : 'Down'}</span> : null}
      {delta.label}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  icon: LucideIcon;
  tone?: StatTone;
  /** Renders the whole tile as a link. Omit for a figure with nowhere to go. */
  href?: string;
  /** A short unit shown after the figure at reduced weight, e.g. `m²`. */
  unit?: string;
  delta?: StatDelta;
  className?: string;
}

export function StatCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = 'default',
  href,
  unit,
  delta,
  className,
}: StatCardProps) {
  const styles = TONES[tone];

  const inner = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-(--radius-control)',
          'transition-transform duration-200 group-hover:scale-105',
          styles.icon,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>

      <p className="mt-4 truncate text-[13px] font-medium text-ink-2">{label}</p>
      <p className={cn('mt-1 text-[26px] font-bold leading-tight tracking-tight', styles.value)}>
        {value}
        {unit ? <span className="ml-1 text-[13px] font-semibold text-ink-3">{unit}</span> : null}
      </p>

      {delta ? <DeltaText delta={delta} className="mt-1.5" /> : null}
      {caption ? (
        <p className={cn('truncate text-[12px] text-ink-3', delta ? 'mt-0.5' : 'mt-1.5')}>
          {caption}
        </p>
      ) : null}
    </>
  );

  const shell = cn(
    'group block rounded-(--radius-card) border border-transparent bg-surface p-5 shadow-card dark:border-line',
    'transition-[box-shadow,border-color] duration-200',
    href && 'hover:shadow-raised dark:hover:border-nib-gold-500/45',
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {inner}
      </Link>
    );
  }
  return <div className={shell}>{inner}</div>;
}

/**
 * The grid a row of tiles sits in. Capped at four across: the eight-across row
 * this replaces gave each tile about 100px, which a currency figure overflows.
 */
export function StatGrid({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-6', className)}
      {...props}
    />
  );
}
