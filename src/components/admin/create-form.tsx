'use client';

import * as React from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/server/actions/admin-actions';
import { deriveCode } from '@/lib/validation/admin';
import { cn } from '@/lib/utils';

/**
 * The pieces the two administration creation dialogs share.
 *
 * Both do the same three things - label a field, show what the server said
 * about it, and submit once - and doing them the same way is what keeps the two
 * forms looking like one system.
 */

export const initialActionState: ActionResult = { ok: false };

/**
 * A result the form can dismiss.
 *
 * `useActionState` has no reset, so after "Add another" the success banner and
 * any field errors would otherwise sit over a blank form describing the record
 * that was already saved. Acknowledging the current result hides it until the
 * next submission returns a new one.
 */
export function useAcknowledgeableResult(state: ActionResult): [ActionResult, () => void] {
  const [acknowledged, setAcknowledged] = React.useState<ActionResult | null>(null);
  const visible = state === acknowledged ? initialActionState : state;
  return [visible, () => setAcknowledged(state)];
}

/** A labelled field with its server-side error, if the last submission had one. */
export function FormField({
  id,
  label,
  required,
  hint,
  errors,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  errors?: string[];
  className?: string;
  children: React.ReactNode;
}) {
  const errorId = `${id}-error`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required} className="text-[12px] font-semibold">
        {label}
      </Label>
      {children}
      {errors?.length ? (
        <p id={errorId} role="alert" className="text-[11px] font-medium text-st-late">
          {errors.join(' ')}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The status control.
 *
 * A select rather than a checkbox: "Active / Disabled" states the two outcomes
 * in the same words the tables use, where an unticked box leaves the reader to
 * work out what the absence means.
 */
export function StatusSelect({ id, name = 'isActive' }: { id: string; name?: string }) {
  return (
    <select
      id={id}
      name={name}
      defaultValue="true"
      className={cn(
        'flex h-10 w-full appearance-none rounded-(--radius-control) border border-line bg-surface',
        'py-0 pl-3.5 pr-9 text-[13px] text-ink shadow-card',
        'transition-[border-color,box-shadow] duration-150',
        'hover:border-line-strong',
        'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
        "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%238A7862' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")]",
        'bg-[length:16px_16px] bg-[position:right_0.75rem_center] bg-no-repeat',
      )}
    >
      <option value="true">Active — offered on new work</option>
      <option value="false">Disabled — kept but not offered</option>
    </select>
  );
}

/**
 * The code preview.
 *
 * The code is derived from the name rather than typed, so the administrator is
 * shown what they are about to create: the identifier the permission matrix,
 * the seed and the audit trail will carry from here on.
 */
export function CodePreview({ name }: { name: string }) {
  const code = deriveCode(name);
  return (
    <>
      Stored as{' '}
      <span className="tabular font-semibold text-ink-2">{code.length > 0 ? code : '—'}</span>. The
      code is derived from the name and cannot be changed afterwards.
    </>
  );
}

/** The result banner. Success stays on screen so the outcome is not inferred. */
export function ResultBanner({ state }: { state: ActionResult }) {
  if (!state.message) return null;

  return state.ok ? (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  ) : (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <AlertDescription>{state.message}</AlertDescription>
    </Alert>
  );
}

/** A submit button that disables itself for the duration of the submission. */
export function SubmitButton({
  label,
  pendingLabel,
  icon,
  variant,
}: {
  label: string;
  pendingLabel: string;
  icon?: React.ReactNode;
  variant?: ButtonProps['variant'];
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {icon}
      {pending ? pendingLabel : label}
    </Button>
  );
}
