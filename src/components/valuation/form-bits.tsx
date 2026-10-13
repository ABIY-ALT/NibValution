'use client';

import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WorkspaceActionState } from '@/server/actions/valuation-actions';

export const INITIAL_STATE: WorkspaceActionState = { ok: false };

/** The outcome of a workspace action: its message, and any validation messages. */
export function ActionMessage({ state }: { state: WorkspaceActionState }) {
  if (!state.message) return null;
  return (
    <Alert variant={state.ok ? 'success' : 'destructive'}>
      {state.ok ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
      <AlertDescription>
        <p>{state.message}</p>
        {!state.ok && state.messages && state.messages.length > 1 ? (
          <ul className="mt-1 list-disc pl-4">
            {state.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Field-list forms
// ---------------------------------------------------------------------------

export interface FieldSpec {
  name: string;
  label: string;
  kind?: 'text' | 'number' | 'select' | 'textarea' | 'date';
  options?: readonly { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Columns spanned in the three-column grid. */
  span?: 1 | 2 | 3;
  /** Adds a unit after the label, e.g. `m²`. */
  unit?: string;
}

/**
 * The fields of a registration form, laid out on a three-column grid with each
 * field's validation message beneath it. Values come from `defaults`, so the
 * same spec serves "add" and "edit".
 */
export function SpecFields({
  fields,
  defaults,
  state,
  idPrefix,
}: {
  fields: readonly FieldSpec[];
  defaults: Record<string, string | number | null | undefined>;
  state: WorkspaceActionState;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const error = state.fieldErrors?.[field.name]?.[0];
        const value = defaults[field.name];
        const common = {
          id,
          name: field.name,
          required: field.required,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? `${id}-error` : undefined,
          defaultValue: value === null || value === undefined ? '' : String(value),
        };
        return (
          <div
            key={field.name}
            className={cn(
              'min-w-0 space-y-1.5',
              field.span === 2 && 'sm:col-span-2',
              field.span === 3 && 'sm:col-span-2 lg:col-span-3',
            )}
          >
            <label htmlFor={id} className="block text-[12px] font-semibold text-ink-2">
              {field.label}
              {field.unit ? <span className="font-normal text-ink-3"> ({field.unit})</span> : null}
              {field.required ? <span className="text-st-late"> *</span> : null}
            </label>
            {field.kind === 'select' ? (
              <Select {...common}>
                {field.required ? null : <option value="">—</option>}
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : field.kind === 'textarea' ? (
              <Textarea {...common} rows={2} placeholder={field.placeholder} />
            ) : (
              <Input
                {...common}
                type={field.kind === 'date' ? 'date' : 'text'}
                inputMode={field.kind === 'number' ? 'decimal' : undefined}
                placeholder={field.placeholder}
              />
            )}
            {error ? (
              <p id={`${id}-error`} className="text-[11.5px] font-semibold text-st-late">
                {error}
              </p>
            ) : field.hint ? (
              <p className="text-[11.5px] text-ink-3">{field.hint}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
