'use client';

import { useActionState } from 'react';
import { recordValuationAction } from '@/server/actions/valuation-actions';
import {
  ActionMessage,
  INITIAL_STATE,
  SpecFields,
  SubmitButton,
  type FieldSpec,
} from './form-bits';

const FIELDS: FieldSpec[] = [
  { name: 'valuationDate', label: 'Valuation date', kind: 'date', required: true },
  {
    name: 'marketValue',
    label: 'Market value',
    unit: 'ETB',
    kind: 'number',
    required: true,
    placeholder: 'e.g. 12500000',
  },
  {
    name: 'forcedSaleValue',
    label: 'Forced-sale value',
    unit: 'ETB',
    kind: 'number',
    required: true,
    hint: 'No more than the market value.',
  },
  { name: 'remarks', label: 'Remarks', kind: 'textarea' },
];

/**
 * The valuator's figures for the case. Saving stores them as entered, with a
 * record of the entry, and they become the case's value for approval routing.
 */
export function ValuationFiguresForm({
  caseId,
  defaults,
  editable,
}: {
  caseId: string;
  defaults: Record<string, string | null>;
  editable: boolean;
}) {
  const [state, formAction] = useActionState(recordValuationAction, INITIAL_STATE);
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="caseId" value={caseId} />
      <ActionMessage state={state} />
      <fieldset disabled={!editable} className="min-w-0 disabled:opacity-80">
        <SpecFields fields={FIELDS} defaults={defaults} state={state} idPrefix="figures" />
      </fieldset>
      {editable ? <SubmitButton className="w-full">Save valuation</SubmitButton> : null}
    </form>
  );
}
