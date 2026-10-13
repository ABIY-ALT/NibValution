'use client';

import { useId, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { etb } from './labels';

/** Small pieces shared by the civil worksheet and its building editor. */

export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-line pt-5 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
        {aside ? <div className="text-[12px] text-ink-3">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Labelled({
  label,
  htmlFor,
  children,
  className,
  hint,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11.5px] leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}

/**
 * A titled group that renders its body only while open. A building's
 * component list runs to a hundred or more inputs; drawing only the groups in
 * use keeps typing in the form immediate.
 */
export function Disclosure({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="rounded-(--radius-control) border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[12.5px] font-semibold text-ink hover:bg-surface-2/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-ink-3 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="truncate">{title}</span>
        </span>
        {badge ? (
          <span className="shrink-0 text-[11.5px] font-medium text-ink-3">{badge}</span>
        ) : null}
      </button>
      {open ? (
        <div id={id} className="border-t border-line px-3 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A percentage box, narrow enough to sit several to a row. */
export function PercentInput({
  value,
  onChange,
  label,
  placeholder,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <span className="relative block w-24 shrink-0">
      <Input
        aria-label={label}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        className="h-9 pr-7 text-right"
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-3">
        %
      </span>
    </span>
  );
}

/** The options of a rate list, declared once and shared by every row that picks from it. */
export function ItemOptions({ id, names }: { id: string; names: readonly string[] }) {
  return (
    <datalist id={id}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Rows of work, each picked from one of the guideline's rate lists by typing
 * part of its name, with a quantity - and, for a property under construction,
 * how far the work is built.
 */
export function WorkRows<T extends { item: string; quantity: string; completion: string }>({
  idPrefix,
  listId,
  items,
  rows,
  blank,
  onChange,
  addLabel,
  showCompletion,
  hint,
  renderExtra,
  hideQuantity,
}: {
  idPrefix: string;
  listId: string;
  items: readonly { name: string; rate: number }[];
  rows: readonly T[];
  blank: () => T;
  onChange: (rows: T[]) => void;
  addLabel: string;
  showCompletion: boolean;
  /** What to say under a row about the picked item, beyond its rate. */
  hint?: (row: T) => string | null;
  /** Further fields for a row, e.g. a description or a pool's dimensions. */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void, id: string) => React.ReactNode;
  /** Rows that need no quantity (a lump sum, a pool priced from its size). */
  hideQuantity?: (row: T) => boolean;
}) {
  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const id = `${idPrefix}-${index}`;
        const update = (patch: Partial<T>) =>
          onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
        const picked = items.find((i) => sameName(i.name, row.item));
        const note = hint?.(row) ?? (picked ? `ETB ${etb(String(picked.rate))} per unit` : null);
        const noQuantity = hideQuantity?.(row) ?? false;
        return (
          <div key={index} className="rounded-(--radius-control) border border-line p-3">
            <div className="flex flex-wrap items-end gap-3">
              <Labelled label="Work" htmlFor={`${id}-item`} className="min-w-[14rem] flex-[3]">
                <Input
                  id={`${id}-item`}
                  list={listId}
                  value={row.item}
                  placeholder="Type to search the guideline's list"
                  autoComplete="off"
                  onChange={(e) => update({ item: e.target.value } as Partial<T>)}
                />
              </Labelled>
              {noQuantity ? null : (
                <Labelled label="Quantity" htmlFor={`${id}-qty`} className="w-28">
                  <Input
                    id={`${id}-qty`}
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => update({ quantity: e.target.value } as Partial<T>)}
                  />
                </Labelled>
              )}
              {showCompletion ? (
                <div className="space-y-1.5">
                  <span className="block text-[12px] font-semibold text-ink-2">Built</span>
                  <PercentInput
                    label={`Completion of ${row.item || `row ${index + 1}`}`}
                    value={row.completion}
                    placeholder="100"
                    onChange={(completion) => update({ completion } as Partial<T>)}
                  />
                </div>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                <Trash2 className="text-st-late" aria-hidden="true" />
                <span className="sr-only">Remove row {index + 1}</span>
              </Button>
            </div>
            {renderExtra ? <div className="mt-3">{renderExtra(row, update, id)}</div> : null}
            {note ? <p className="mt-2 text-[11.5px] text-ink-3">{note}</p> : null}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange([...rows, blank()])}
      >
        <Plus aria-hidden="true" />
        {addLabel}
      </Button>
    </div>
  );
}
