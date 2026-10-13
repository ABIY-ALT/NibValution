'use client';

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * The dashboard's charts, drawn directly in SVG and HTML rather than through a
 * charting library - there are three shapes, all single-series, and a library
 * would outweigh the rest of the dashboard.
 *
 * Every chart shares one reading model: the pointer or the arrow keys select a
 * point and a readout names it, so a keyboard user reaches the same figure a
 * mouse user hovers. A visually hidden table carries every value for screen
 * readers and for anyone who wants the numbers rather than the shape.
 *
 * Marks use `--color-chart`, a gold dark enough to read as data against both
 * surfaces; the brand gold is too faint for a 2px line on white.
 */

export interface ChartPoint {
  label: string;
  fullLabel: string;
  count: number;
}

/** Singular and plural nouns for the readout: `['request', 'requests']`. */
export type Unit = readonly [string, string];

function describe(point: ChartPoint, unit: Unit): string {
  return `${point.count} ${point.count === 1 ? unit[0] : unit[1]}`;
}

/**
 * Selection by pointer and keyboard. Every chart places its points at the
 * centre of equal bands, so the pointer selects the band it is over - by x
 * alone, because a reader aims at a day, never at a 2px line.
 */
function useCursor(length: number) {
  const [active, setActive] = useState<number | null>(null);
  const clamp = (i: number) => Math.min(length - 1, Math.max(0, i));

  const props = {
    tabIndex: 0,
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (length === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setActive(clamp(Math.floor(((event.clientX - rect.left) / rect.width) * length)));
    },
    onPointerLeave() {
      setActive(null);
    },
    onBlur() {
      setActive(null);
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (length === 0) return;
      const moves: Record<string, (current: number | null) => number> = {
        ArrowRight: (c) => (c === null ? 0 : clamp(c + 1)),
        ArrowLeft: (c) => (c === null ? length - 1 : clamp(c - 1)),
        Home: () => 0,
        End: () => length - 1,
      };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        setActive(move);
      } else if (event.key === 'Escape') {
        setActive(null);
      }
    },
  };

  return { active, props };
}

const FRAME =
  'relative outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/40 focus-visible:ring-offset-4 focus-visible:ring-offset-surface rounded-sm';

/** Where a readout sits: centred on its point, but never hanging off an edge. */
function anchor(xPercent: number): string {
  if (xPercent < 18) return 'translate-x-0';
  if (xPercent > 82) return '-translate-x-full';
  return '-translate-x-1/2';
}

function Readout({
  point,
  unit,
  style,
  xPercent,
}: {
  point: ChartPoint;
  unit: Unit;
  style: React.CSSProperties;
  xPercent: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn(
        'pointer-events-none absolute z-10 whitespace-nowrap rounded-(--radius-control) px-2.5 py-1.5 shadow-raised',
        'bg-nib-brown-900 text-white dark:bg-surface-3 dark:text-ink',
        anchor(xPercent),
      )}
    >
      <span className="block text-[12px] font-semibold">{describe(point, unit)}</span>
      <span className="block text-[11px] text-white/70 dark:text-ink-3">{point.fullLabel}</span>
    </div>
  );
}

function DataTable({
  caption,
  points,
  unit,
}: {
  caption: string;
  points: ChartPoint[];
  unit: Unit;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Period</th>
          <th scope="col">{unit[1]}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.fullLabel}>
            <th scope="row">{point.fullLabel}</th>
            <td>{point.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LiveReadout({ point, unit }: { point: ChartPoint | null; unit: Unit }) {
  return (
    <p aria-live="polite" className="sr-only">
      {point ? `${point.fullLabel}: ${describe(point, unit)}` : ''}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * One column per period. The latest period carries the full series colour and
 * the rest a lighter step, so "now" is found without reading a label. A period
 * with nothing in it keeps a hairline stub, so an empty day reads as zero
 * rather than as a missing column.
 */
export function ColumnChart({
  points,
  unit,
  label,
  className,
  plotClassName = 'h-24',
}: {
  points: ChartPoint[];
  unit: Unit;
  /** Names the chart for assistive technology, e.g. "Requests received, last 7 days". */
  label: string;
  className?: string;
  plotClassName?: string;
}) {
  const { active, props } = useCursor(points.length);
  const max = Math.max(1, ...points.map((p) => p.count));
  const last = points.length - 1;
  const selected = active === null ? null : (points[active] ?? null);

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={`${label}. Use the arrow keys to read each value.`}
        {...props}
        className={cn(FRAME, 'flex items-end gap-1', plotClassName)}
      >
        {points.map((point, i) => {
          const height = (point.count / max) * 100;
          const on = active === i;
          return (
            <div key={point.fullLabel} className="flex h-full flex-1 items-end justify-center">
              {point.count > 0 ? (
                <div
                  className={cn(
                    'w-full max-w-4 rounded-t-[4px] transition-[background-color,opacity] duration-150',
                    i === last ? 'bg-chart' : on ? 'bg-chart/55' : 'bg-chart/25',
                    i === last && on && 'opacity-85',
                  )}
                  style={{ height: `${height}%` }}
                />
              ) : (
                <div
                  className={cn(
                    'h-[3px] w-full max-w-4 rounded-full',
                    on ? 'bg-ink-3' : 'bg-line-strong',
                  )}
                />
              )}
            </div>
          );
        })}

        {selected && active !== null ? (
          <Readout
            point={selected}
            unit={unit}
            xPercent={((active + 0.5) / points.length) * 100}
            style={{
              left: `${((active + 0.5) / points.length) * 100}%`,
              bottom: `calc(${(selected.count / max) * 100}% + 8px)`,
            }}
          />
        ) : null}
      </div>

      <div className="mt-2 flex gap-1" aria-hidden="true">
        {points.map((point, i) => (
          <span
            key={point.fullLabel}
            className={cn(
              'flex-1 truncate text-center text-[11px]',
              active === i ? 'font-semibold text-ink' : 'text-ink-3',
            )}
          >
            {point.label}
          </span>
        ))}
      </div>

      <LiveReadout point={selected} unit={unit} />
      <DataTable caption={label} points={points} unit={unit} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

/** Round an axis top up to four clean integer steps: 0 / 5 / 10 / 15 / 20. */
function niceTop(value: number): number {
  const quarter = Math.max(1, value / 4);
  const magnitude = 10 ** Math.floor(Math.log10(quarter));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    const step = m * magnitude;
    if (Number.isInteger(step) && step >= quarter) return step * 4;
  }
  return Math.ceil(quarter) * 4;
}

/**
 * A monotone cubic through the points (Steffen's method, as d3's
 * `curveMonotoneX`), so the curve is smooth but never overshoots: it cannot
 * dip below zero between two quiet months or peak above the busiest one.
 */
function monotonePath(xs: number[], ys: number[]): string {
  const n = Math.min(xs.length, ys.length);
  const x = (i: number) => xs[i] ?? 0;
  const y = (i: number) => ys[i] ?? 0;
  if (n === 0) return '';
  if (n === 1) return `M${x(0)},${y(0)}`;
  if (n === 2) return `M${x(0)},${y(0)} L${x(1)},${y(1)}`;

  // Interior tangents: zero at a local extreme, otherwise bounded by the
  // gentler neighbouring slope.
  const t: number[] = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = x(i) - x(i - 1);
    const h1 = x(i + 1) - x(i);
    const s0 = (y(i) - y(i - 1)) / h0;
    const s1 = (y(i + 1) - y(i)) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] =
      (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) ||
      0;
  }
  // End tangents, from the end segment and the neighbouring tangent.
  t[0] = ((3 * (y(1) - y(0))) / (x(1) - x(0)) - (t[1] ?? 0)) / 2;
  t[n - 1] = ((3 * (y(n - 1) - y(n - 2))) / (x(n - 1) - x(n - 2)) - (t[n - 2] ?? 0)) / 2;

  let d = `M${x(0)},${y(0)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (x(i + 1) - x(i)) / 3;
    const c1 = `${x(i) + dx},${y(i) + dx * (t[i] ?? 0)}`;
    const c2 = `${x(i + 1) - dx},${y(i + 1) - dx * (t[i + 1] ?? 0)}`;
    d += ` C${c1} ${c2} ${x(i + 1)},${y(i + 1)}`;
  }
  return d;
}

/**
 * A smooth line over a light wash. With `axis`, it carries a zero-based y-axis
 * with hairline gridlines; without, it is a sparkline whose headroom keeps the
 * peak off the top edge.
 */
export function AreaChart({
  points,
  unit,
  label,
  axis = false,
  className,
  plotClassName = 'h-24',
}: {
  points: ChartPoint[];
  unit: Unit;
  label: string;
  axis?: boolean;
  className?: string;
  plotClassName?: string;
}) {
  const gradientId = useId();
  const { active, props } = useCursor(points.length);
  const max = Math.max(0, ...points.map((p) => p.count));
  const top = axis ? niceTop(max) : Math.max(1, max * 1.2);
  const ticks = axis ? [4, 3, 2, 1, 0].map((i) => (top / 4) * i) : [];

  // Points sit at the centre of equal bands, as columns would, so every period
  // label centres under its point without the end labels crowding their
  // neighbours.
  const n = points.length;
  const xs = points.map((_, i) => ((i + 0.5) / n) * 100);
  const ys = points.map((p) => 100 - (p.count / top) * 100);
  const line = monotonePath(xs, ys);
  const area = line ? `${line} L${xs[n - 1] ?? 100},100 L${xs[0] ?? 0},100 Z` : '';

  const selected = active === null ? null : (points[active] ?? null);
  const selectedX = active === null ? 0 : (xs[active] ?? 0);
  const selectedY = active === null ? 0 : (ys[active] ?? 0);

  return (
    <div className={cn('flex gap-3', className)}>
      {axis ? (
        <div className={cn('relative w-7 shrink-0', plotClassName)} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="tabular absolute right-0 -translate-y-1/2 text-[11px] text-ink-3"
              style={{ top: `${100 - (tick / top) * 100}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div
          role="group"
          aria-label={`${label}. Use the arrow keys to read each value.`}
          {...props}
          className={cn(FRAME, plotClassName)}
        >
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden="true"
              className="absolute inset-x-0 border-t border-line"
              style={{ top: `${100 - (tick / top) * 100}%` }}
            />
          ))}

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full overflow-visible"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--color-chart)" stopOpacity="0.2" />
                <stop offset="1" stopColor="var(--color-chart)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke="var(--color-chart)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {selected ? (
            <>
              <div
                aria-hidden="true"
                className="absolute inset-y-0 w-px bg-line-strong"
                style={{ left: `${selectedX}%` }}
              />
              <div
                aria-hidden="true"
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-chart ring-2 ring-surface"
                style={{ left: `${selectedX}%`, top: `${selectedY}%` }}
              />
              <Readout
                point={selected}
                unit={unit}
                xPercent={selectedX}
                style={{ left: `${selectedX}%`, bottom: `calc(${100 - selectedY}% + 12px)` }}
              />
            </>
          ) : null}
        </div>

        <div className="relative mt-2 h-4" aria-hidden="true">
          {points.map((point, i) => (
            <span
              key={point.fullLabel}
              className={cn(
                'absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px]',
                active === i ? 'font-semibold text-ink' : 'text-ink-3',
              )}
              style={{ left: `${xs[i] ?? 0}%` }}
            >
              {point.label}
            </span>
          ))}
        </div>
      </div>

      <LiveReadout point={selected} unit={unit} />
      <DataTable caption={label} points={points} unit={unit} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/**
 * A half-circle meter for a share, 0-100. The fill carries severity - series
 * gold when healthy, amber when slipping, red when failing - and the track is a
 * light step of the same colour, so the state reads across the whole arc.
 */
export function Gauge({
  percent,
  label,
  goodAt = 85,
  warnAt = 60,
}: {
  percent: number | null;
  label: string;
  goodAt?: number;
  warnAt?: number;
}) {
  const color =
    percent === null
      ? 'var(--color-line-strong)'
      : percent >= goodAt
        ? 'var(--color-chart)'
        : percent >= warnAt
          ? 'var(--color-st-review)'
          : 'var(--color-st-late)';
  const arc = 'M12,62 A48,48 0 0 1 108,62';

  return (
    <div className="relative mx-auto w-full max-w-[9.5rem]" role="img" aria-label={label}>
      <svg viewBox="0 0 120 68" className="block w-full" aria-hidden="true">
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeOpacity="0.16"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {percent !== null && percent > 0 ? (
          <path
            d={arc}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${Math.min(100, percent)} 100`}
          />
        ) : null}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 text-center text-[22px] font-bold leading-none text-ink"
      >
        {percent === null ? '—' : `${percent}%`}
      </span>
    </div>
  );
}
