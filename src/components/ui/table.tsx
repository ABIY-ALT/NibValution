import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Data tables.
 *
 * A table is wrapped in its own elevated surface with a masthead, so a list of
 * cases reads as a register rather than as loose rows on the page background.
 * The wrapper owns the radius and clips the corners, which is why rows need no
 * rounding of their own.
 */
export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-(--radius-card) border border-transparent bg-surface shadow-card dark:border-line',
        className,
      )}
      {...props}
    />
  );
}

/** Masthead for a table: a title on the left, counts or actions on the right. */
export function TableBar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function TableTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'flex items-center gap-2 text-[13px] font-bold tracking-tight text-ink',
        className,
      )}
      {...props}
    />
  );
}

/** Horizontal scroll lives here, not on the wrapper, so the masthead stays put. */
export function TableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('w-full overflow-x-auto', className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom text-[13px]', className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-line bg-surface-2/70', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line', className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-150 hover:bg-nib-gold-100/25 dark:hover:bg-surface-2/70',
        className,
      )}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3.5 align-middle text-ink', className)} {...props} />;
}

/** Right-aligned, tabular-figure cell for monetary and numeric columns. */
export function TDNum({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'tabular px-4 py-3.5 text-right align-middle font-semibold text-ink',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The empty state. A blank table is a dead end; this gives it a shape, an
 * explanation and, where the caller supplies one, a way out.
 */
export function EmptyRow({
  colSpan,
  icon: Icon,
  title,
  children,
  action,
}: {
  colSpan: number;
  icon?: React.ComponentType<{ className?: string }>;
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16">
        <div className="mx-auto flex max-w-sm flex-col items-center text-center">
          {Icon ? (
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-3">
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          {title ? <p className="text-[13px] font-bold text-ink">{title}</p> : null}
          <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{children}</p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </td>
    </tr>
  );
}
