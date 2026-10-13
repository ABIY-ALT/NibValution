import Link from 'next/link';
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The filter bar that sits above a register.
 *
 * Every list page previously built its own from raw inputs and `<select>`
 * elements, so the same three controls appeared at three different heights
 * with three different borders. One component means one filter bar.
 */
export function FilterBar({
  action,
  children,
  clearHref,
  className,
}: {
  /** The GET target. Omit to post back to the current route. */
  action?: string;
  children: React.ReactNode;
  /** When set, a Clear control is shown pointing at the unfiltered list. */
  clearHref?: string;
  className?: string;
}) {
  return (
    <form
      method="get"
      action={action}
      className={cn(
        'flex flex-wrap items-end gap-3 rounded-(--radius-card) border border-transparent bg-surface p-4 shadow-card dark:border-line',
        className,
      )}
    >
      {children}

      <div className="ml-auto flex items-center gap-2">
        <Button type="submit" variant="outline">
          <SlidersHorizontal aria-hidden="true" />
          Apply
        </Button>
        {clearHref ? (
          <Button asChild variant="ghost">
            <Link href={clearHref}>
              <X aria-hidden="true" />
              Clear
            </Link>
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A search input with its magnifier, sized to match the other filter controls. */
export function SearchField({
  id = 'search',
  name = 'search',
  label = 'Search',
  placeholder,
  defaultValue,
  className,
}: {
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-[16rem] flex-1', className)}>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-3"
      >
        {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <input
          id={id}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cn(
            'h-10 w-full rounded-(--radius-control) border border-line bg-surface pl-9 pr-3',
            'text-[13px] text-ink shadow-card placeholder:text-ink-3/70',
            'transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
            'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
          )}
        />
      </div>
    </div>
  );
}

/** Rows per page on every register, so one screen of work reads the same everywhere. */
export const LIST_PAGE_SIZE = 10;

/**
 * The page number from a `?page=` value. Anything missing or malformed reads as
 * the first page: a stale or hand-edited link should show the list, not fail.
 */
export function readPage(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : 1;
}

/**
 * A register's URL for a given page, carrying its filters along. Page 1 is the
 * bare URL, so the first page and an unpaged link are the same address.
 */
export function pageHref(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
  page: number,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  if (page > 1) query.set('page', String(page));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * The page numbers to offer: always the first and last, the current page and
 * its neighbours, and a gap wherever a run is skipped - `1 … 4 5 6 … 12`.
 */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const shown = new Set([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => shown.add(p));
  if (page >= pageCount - 2)
    [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => shown.add(p));
  const pages = [...shown].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);

  const out: (number | 'gap')[] = [];
  pages.forEach((p, i) => {
    const previous = pages[i - 1];
    if (previous !== undefined && p - previous > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

const PAGE_CELL =
  'flex h-9 min-w-9 items-center justify-center rounded-(--radius-control) px-2 text-[13px] font-medium';

/**
 * Page controls for a register: the range shown on the left, numbered pages on
 * the right.
 *
 * Previous and Next are rendered as inert marks when there is nowhere to go,
 * rather than as buttons neutralised with `pointer-events-none` — a disabled
 * control that is still in the tab order is a trap for keyboard users.
 */
export function Pagination({
  page,
  pageCount,
  total,
  noun = 'records',
  pageSize,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun?: string;
  /** With the page size, the summary names the rows shown: "11–20 of 35". */
  pageSize?: number;
  buildHref: (page: number) => string;
}) {
  if (total === 0) return null;

  const hasPrevious = page > 1;
  const hasNext = page < pageCount;
  const from = pageSize ? Math.min(total, (page - 1) * pageSize + 1) : null;
  const to = pageSize ? Math.min(total, page * pageSize) : null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 rounded-(--radius-card) border border-transparent bg-surface px-4 py-3 shadow-card dark:border-line"
    >
      <p className="text-[13px] text-ink-3">
        {from !== null && to !== null ? (
          <>
            Showing{' '}
            <span className="tabular font-semibold text-ink-2">
              {from}–{to}
            </span>{' '}
            of <span className="tabular font-semibold text-ink-2">{total}</span> {noun}
          </>
        ) : (
          <>
            Page <span className="tabular font-semibold text-ink-2">{page}</span> of{' '}
            <span className="tabular font-semibold text-ink-2">{pageCount}</span> ·{' '}
            <span className="tabular font-semibold text-ink-2">{total}</span> {noun}
          </>
        )}
      </p>

      {pageCount > 1 ? (
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            {hasPrevious ? (
              <Link
                href={buildHref(page - 1)}
                rel="prev"
                className={cn(
                  PAGE_CELL,
                  'bg-surface-2 text-ink-2 transition-colors hover:bg-nib-gold-500/15 hover:text-ink',
                )}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Previous page</span>
              </Link>
            ) : (
              <span className={cn(PAGE_CELL, 'bg-surface-2/60 text-ink-3/50')} aria-hidden="true">
                <ChevronLeft className="h-4 w-4" />
              </span>
            )}
          </li>

          {pageWindow(page, pageCount).map((entry, index) =>
            entry === 'gap' ? (
              <li key={`gap-${index}`} className={cn(PAGE_CELL, 'text-ink-3')} aria-hidden="true">
                …
              </li>
            ) : (
              <li key={entry}>
                {entry === page ? (
                  <span
                    aria-current="page"
                    className={cn(
                      PAGE_CELL,
                      'tabular bg-nib-gold-500 font-semibold text-nib-brown-900 shadow-brand',
                    )}
                  >
                    {entry}
                  </span>
                ) : (
                  <Link
                    href={buildHref(entry)}
                    aria-label={`Page ${entry}`}
                    className={cn(
                      PAGE_CELL,
                      'tabular bg-surface-2 text-ink-2 transition-colors hover:bg-nib-gold-500/15 hover:text-ink',
                    )}
                  >
                    {entry}
                  </Link>
                )}
              </li>
            ),
          )}

          <li>
            {hasNext ? (
              <Link
                href={buildHref(page + 1)}
                rel="next"
                className={cn(
                  PAGE_CELL,
                  'bg-surface-2 text-ink-2 transition-colors hover:bg-nib-gold-500/15 hover:text-ink',
                )}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Next page</span>
              </Link>
            ) : (
              <span className={cn(PAGE_CELL, 'bg-surface-2/60 text-ink-3/50')} aria-hidden="true">
                <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
