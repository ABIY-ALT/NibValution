'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, Building2, FileText, Send, User, UserSquare } from 'lucide-react';
import { createCaseAction, type CaseFormState } from '@/server/actions/case-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardBar, CardContent, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const initialState: CaseFormState = { ok: false };

export interface RequestTypeOption {
  code: string;
  name: string;
  description: string | null;
  requiresPriorCase: boolean;
}

/** The requesting unit: chosen by the raiser, or fixed to their own branch or district. */
export type RequestingUnitOptions =
  | {
      choose: true;
      ownUnit: null;
      units: { id: string; name: string; type: 'BRANCH' | 'DISTRICT' | 'HEAD_OFFICE_UNIT' }[];
    }
  | { choose: false; ownUnit: string; units: never[] };

const UNIT_GROUPS = [
  { type: 'BRANCH', label: 'Branches' },
  { type: 'DISTRICT', label: 'Districts' },
  { type: 'HEAD_OFFICE_UNIT', label: 'Head office departments and units' },
] as const;

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full">
      <Send aria-hidden="true" />
      {pending ? 'Creating…' : 'Create request'}
    </Button>
  );
}

function Field({
  name,
  label,
  required,
  errors,
  children,
  hint,
  className,
}: {
  name: string;
  label: string;
  required?: boolean;
  errors?: string[];
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label
        htmlFor={name}
        required={required}
        className="text-[11px] font-bold uppercase tracking-wider text-ink-3"
      >
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[11px] leading-relaxed text-ink-3">{hint}</p> : null}
      {errors?.length ? (
        <p id={`${name}-error`} className="text-[11px] font-semibold text-st-late">
          {errors.join(' ')}
        </p>
      ) : null}
    </div>
  );
}

/** One section of the form, so all four carry the same masthead treatment. */
function Section({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: typeof User;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardBar>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-[18px] w-[18px] text-nib-gold-600" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardBar>
      <CardContent className={cn('grid gap-5 pt-6', className)}>{children}</CardContent>
    </Card>
  );
}

/**
 * The request-intake form.
 *
 * Valuation Department staff raise a request on behalf of the branch or
 * department asking for it, so they choose that requesting unit here; a raiser
 * who sits in a branch or district files under their own unit, which the
 * server enforces. Case number, status and department are derived on the
 * server - accepting them here would let a case open directly in an approved
 * state.
 */
export function RequestForm({
  requestTypes,
  requesting,
}: {
  requestTypes: RequestTypeOption[];
  requesting: RequestingUnitOptions;
}) {
  const [state, formAction] = useActionState(createCaseAction, initialState);
  const [typeCode, setTypeCode] = useState(requestTypes[0]?.code ?? '');

  const selected = requestTypes.find((t) => t.code === typeCode);
  const needsPriorCase = selected?.requiresPriorCase ?? false;
  const err = state.fieldErrors;

  // The fields fill the page's width; on a wide screen the submit panel stands
  // beside them and stays in view, and on a narrow one it follows the last
  // section, where the reader finishes.
  return (
    <form
      action={formAction}
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]"
      noValidate
    >
      <div className="min-w-0 space-y-6">
        {state.message ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}

        <Section title="Request" icon={FileText} className="sm:grid-cols-2">
          {requesting.choose ? (
            <Field
              name="requestingOrgId"
              label="Requesting branch / department"
              required
              errors={err?.requestingOrgId}
              hint="The branch or department asking for this valuation. It is recorded on the case and its documents."
              className="sm:col-span-2"
            >
              <Select id="requestingOrgId" name="requestingOrgId" required defaultValue="">
                <option value="" disabled>
                  — Choose the requester —
                </option>
                {UNIT_GROUPS.map((group) => {
                  const items = requesting.units.filter((u) => u.type === group.type);
                  return items.length > 0 ? (
                    <optgroup key={group.type} label={group.label}>
                      {items.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </Select>
            </Field>
          ) : (
            <p className="rounded-(--radius-control) border border-line bg-surface-2/60 px-3.5 py-2.5 text-[12.5px] text-ink-2 sm:col-span-2">
              Requesting unit: <span className="font-semibold text-ink">{requesting.ownUnit}</span>
            </p>
          )}

          <Field name="requestTypeCode" label="Request type" required errors={err?.requestTypeCode}>
            <Select
              id="requestTypeCode"
              name="requestTypeCode"
              required
              value={typeCode}
              onChange={(e) => setTypeCode(e.target.value)}
            >
              {requestTypes.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field name="discipline" label="Discipline" required errors={err?.discipline}>
            <Select id="discipline" name="discipline" required defaultValue="CIVIL">
              <option value="CIVIL">Civil — land and buildings</option>
              <option value="MECHANICAL">Mechanical — plant, machinery and vehicles</option>
            </Select>
          </Field>

          {selected?.description ? (
            <p className="-mt-2 rounded-(--radius-control) border border-line bg-surface-2/60 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-ink-2 sm:col-span-2">
              {selected.description}
            </p>
          ) : null}

          {needsPriorCase ? (
            <Field
              name="priorCaseNumber"
              label="Earlier case number"
              required
              errors={err?.priorCaseNumber}
              hint="A re-estimation, appeal or progress request must reference the case it follows, so the lineage stays auditable."
              className="sm:col-span-2"
            >
              <Input
                id="priorCaseNumber"
                name="priorCaseNumber"
                placeholder="PV-2026-000001"
                required
              />
            </Field>
          ) : null}
        </Section>

        <Section title="Applicant" icon={User} className="sm:grid-cols-3">
          <Field name="applicantName" label="Applicant name" required errors={err?.applicantName}>
            <Input id="applicantName" name="applicantName" required />
          </Field>
          <Field name="applicantPhone" label="Telephone" errors={err?.applicantPhone}>
            <Input id="applicantPhone" name="applicantPhone" inputMode="tel" />
          </Field>
          <Field name="applicantTin" label="TIN" errors={err?.applicantTin}>
            <Input id="applicantTin" name="applicantTin" />
          </Field>
        </Section>

        <Section title="Property owner" icon={UserSquare} className="sm:grid-cols-3">
          <Field name="ownerName" label="Owner name" required errors={err?.ownerName}>
            <Input id="ownerName" name="ownerName" required />
          </Field>
          <Field name="ownerPhone" label="Telephone" errors={err?.ownerPhone}>
            <Input id="ownerPhone" name="ownerPhone" inputMode="tel" />
          </Field>
          <Field name="ownerIdNumber" label="Identification number" errors={err?.ownerIdNumber}>
            <Input id="ownerIdNumber" name="ownerIdNumber" />
          </Field>
        </Section>

        <Section title="Context" icon={Building2}>
          <Field
            name="purpose"
            label="Purpose of the valuation"
            errors={err?.purpose}
            hint="For example: new credit facility, facility review, foreclosure."
          >
            <Input id="purpose" name="purpose" />
          </Field>
          <Field name="remarks" label="Remarks" errors={err?.remarks}>
            <textarea
              id="remarks"
              name="remarks"
              rows={4}
              className={cn(
                'w-full rounded-(--radius-control) border border-line bg-surface px-3.5 py-2.5',
                'text-[13px] text-ink shadow-card placeholder:text-ink-3/70',
                'transition-[border-color,box-shadow] duration-150 hover:border-line-strong',
                'focus-visible:border-nib-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nib-gold-500/25',
              )}
            />
          </Field>
        </Section>
      </div>

      <Card className="p-6 xl:sticky xl:top-0">
        <h2 className="text-section font-semibold tracking-tight text-ink">Create the request</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          Check the details, then create the case. Nothing is sent to the department yet.
        </p>

        <div className="mt-5">
          <Submit />
        </div>

        <ol className="mt-6 space-y-4 border-t border-line pt-5">
          {NEXT_STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-nib-gold-500/15 text-[11px] font-bold text-nib-gold-800 dark:text-nib-gold-400">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{step.title}</span>
                <span className="block text-[12px] leading-relaxed text-ink-3">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </form>
  );
}

const NEXT_STEPS = [
  {
    title: 'Saved as a draft',
    body: 'The case number and the receiving department are set automatically.',
  },
  {
    title: 'Attach documents',
    body: 'Supporting documents are added to the draft next.',
  },
  {
    title: 'Submit to the department',
    body: 'The case reaches the Property Valuation Department only when you submit it.',
  },
] as const;
