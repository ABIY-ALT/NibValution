'use client';

import { useActionState, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { WorkspaceActionState } from '@/server/actions/valuation-actions';
import {
  ActionMessage,
  INITIAL_STATE,
  SpecFields,
  SubmitButton,
  type FieldSpec,
} from './form-bits';

type WorkspaceAction = (
  prev: WorkspaceActionState,
  formData: FormData,
) => Promise<WorkspaceActionState>;

/**
 * An add-or-edit dialog for one registered item - a building, a vehicle, a
 * machine. The form lives inside the dialog content, which unmounts on close,
 * so every opening starts from the item's saved values rather than from the
 * last attempt's errors.
 */
export function EntityDialog({
  title,
  description,
  trigger,
  action,
  hidden,
  fields,
  defaults,
  submitLabel,
}: {
  title: string;
  description?: string;
  trigger: React.ReactNode;
  action: WorkspaceAction;
  hidden: Record<string, string>;
  fields: readonly FieldSpec[];
  defaults: Record<string, string | number | null | undefined>;
  submitLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogForm
          title={title}
          description={description}
          action={action}
          hidden={hidden}
          fields={fields}
          defaults={defaults}
          submitLabel={submitLabel}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({
  title,
  description,
  action,
  hidden,
  fields,
  defaults,
  submitLabel,
  onSaved,
}: {
  title: string;
  description?: string;
  action: WorkspaceAction;
  hidden: Record<string, string>;
  fields: readonly FieldSpec[];
  defaults: Record<string, string | number | null | undefined>;
  submitLabel: string;
  onSaved: () => void;
}) {
  const [state, formAction] = useActionState(
    async (prev: WorkspaceActionState, formData: FormData) => {
      const next = await action(prev, formData);
      if (next.ok) onSaved();
      return next;
    },
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      <DialogBody className="space-y-4">
        {Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {state.ok ? null : <ActionMessage state={state} />}
        <SpecFields fields={fields} defaults={defaults} state={state} idPrefix={title} />
      </DialogBody>
      <DialogFooter>
        <SubmitButton>{submitLabel}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

/** A remove control that asks first, and reports a refusal in place. */
export function DeleteItemButton({
  action,
  hidden,
  label,
  confirmText,
}: {
  action: WorkspaceAction;
  hidden: Record<string, string>;
  label: string;
  confirmText: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        title={label}
        onClick={(event) => {
          if (!window.confirm(confirmText)) event.preventDefault();
        }}
      >
        <Trash2 className="text-st-late" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </Button>
      {!state.ok && state.message ? (
        <span role="alert" className="text-[11.5px] font-semibold text-st-late">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
