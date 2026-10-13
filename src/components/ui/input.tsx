import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Text entry. Matched to the 40px control height so an input and the button
 * beside it sit on one line without either being nudged.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-(--radius-control) border border-line bg-surface px-3.5',
        'text-[13px] text-ink shadow-card transition-[border-color,box-shadow,background-color] duration-150',
        'placeholder:text-ink-3/70',
        'hover:border-line-strong',
        'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
        'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
        'aria-[invalid=true]:border-st-late aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-st-late/20',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/**
 * Multi-line entry, matched to `Input` so a description field sitting beneath a
 * name field does not read as a different kind of control.
 */
export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'flex w-full rounded-(--radius-control) border border-line bg-surface px-3.5 py-2.5',
        'text-[13px] leading-relaxed text-ink shadow-card',
        'transition-[border-color,box-shadow,background-color] duration-150',
        'placeholder:text-ink-3/70',
        'hover:border-line-strong',
        'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
        'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
        'aria-[invalid=true]:border-st-late aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-st-late/20',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/**
 * The native select, styled to match `Input` exactly — the two sit side by side
 * in every filter bar, and a select that renders a browser default beside a
 * styled input is the single most common way a form looks unfinished.
 */
export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full appearance-none rounded-(--radius-control) border border-line bg-surface',
        'py-0 pl-3.5 pr-9 text-[13px] text-ink shadow-card',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-line-strong',
        'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
        'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60',
        // Chevron drawn as a background image so the control needs no wrapper.
        "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238A7862' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")]",
        'bg-[length:16px_16px] bg-[position:right_0.75rem_center] bg-no-repeat',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

/** A field label paired with its control, with consistent spacing. */
export function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-bold uppercase tracking-wider text-ink-3"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-ink-3">{hint}</p> : null}
    </div>
  );
}
