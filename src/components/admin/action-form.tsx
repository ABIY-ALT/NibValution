'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, type ButtonProps } from '@/components/ui/button';
import type { ActionResult } from '@/server/actions/admin-actions';
import { cn } from '@/lib/utils';

const initialState: ActionResult = { ok: true };

function Submit({
  label,
  pendingLabel,
  variant,
  size = 'sm',
  confirm,
}: {
  label: string;
  pendingLabel?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size={size}
      variant={variant}
      disabled={pending}
      // Confirmation on consequential administrative actions (spec section 30).
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? (pendingLabel ?? 'Working...') : label}
    </Button>
  );
}

/**
 * A small form bound to one server action, with inline result feedback.
 *
 * Used for the single-purpose administrative controls - activate, unlock,
 * enable, disable - where a full page form would be heavier than the change
 * warrants.
 */
export function ActionForm({
  action,
  label,
  pendingLabel,
  variant,
  size,
  confirm,
  hidden,
  className,
  children,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  confirm?: string;
  hidden?: Record<string, string>;
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className={cn('inline-flex flex-col gap-1', className)}>
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <div className="flex items-center gap-2">
        <Submit
          label={label}
          pendingLabel={pendingLabel}
          variant={variant}
          size={size}
          confirm={confirm}
        />
        {state.message ? (
          <span
            role="status"
            className={cn('text-[11px] font-semibold', state.ok ? 'text-st-done' : 'text-st-late')}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
