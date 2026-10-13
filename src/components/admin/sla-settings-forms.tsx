'use client';

import { useActionState } from 'react';
import { CalendarPlus, Save } from 'lucide-react';
import { addHolidayAction, updateSlaPolicyAction } from '@/server/actions/admin-actions';
import { Input, Select } from '@/components/ui/input';
import {
  FormField,
  ResultBanner,
  SubmitButton,
  initialActionState,
} from '@/components/admin/create-form';
import { WEEKDAYS } from '@/lib/validation/sla';
import { cn } from '@/lib/utils';

export interface SlaPolicyValues {
  totalWorkingDays: number;
  warningPercent: number;
  workingDaysOfWeek: number[];
  countCalendarDays: boolean;
}

/** The standard turnaround policy: the allowance, the warning point, the working week. */
export function SlaPolicyForm({ policy }: { policy: SlaPolicyValues }) {
  const [state, formAction] = useActionState(updateSlaPolicyAction, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      <ResultBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id="sla-total"
          label="Allowance (days)"
          required
          errors={errors.totalWorkingDays}
          hint="From the request reaching the department to completion."
        >
          <Input
            id="sla-total"
            name="totalWorkingDays"
            type="number"
            min={1}
            max={60}
            step={1}
            required
            defaultValue={policy.totalWorkingDays}
            aria-invalid={errors.totalWorkingDays ? true : undefined}
          />
        </FormField>

        <FormField
          id="sla-warning"
          label="Warning point (%)"
          required
          errors={errors.warningPercent}
          hint="A case turns amber, and its team is told, once this share is used."
        >
          <Input
            id="sla-warning"
            name="warningPercent"
            type="number"
            min={50}
            max={95}
            step={1}
            required
            defaultValue={policy.warningPercent}
            aria-invalid={errors.warningPercent ? true : undefined}
          />
        </FormField>
      </div>

      <FormField id="sla-count" label="Days are counted as" errors={errors.countCalendarDays}>
        <Select
          id="sla-count"
          name="countCalendarDays"
          defaultValue={policy.countCalendarDays ? 'true' : 'false'}
        >
          <option value="false">Working days — skip non-working days and holidays</option>
          <option value="true">Calendar days — every day counts</option>
        </Select>
      </FormField>

      <fieldset>
        <legend className="mb-1.5 text-[12px] font-semibold text-ink">Working week</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((weekday) => (
            <label
              key={weekday.day}
              className={cn(
                'relative flex h-10 min-w-12 cursor-pointer items-center justify-center rounded-(--radius-control) border border-line bg-surface px-3',
                'text-[13px] font-semibold text-ink-3 shadow-card transition-colors hover:border-line-strong',
                'has-checked:border-nib-gold-500 has-checked:bg-nib-gold-500/12 has-checked:text-nib-gold-800 dark:has-checked:text-nib-gold-300',
                'has-focus-visible:ring-2 has-focus-visible:ring-nib-gold-500/30',
              )}
            >
              <input
                type="checkbox"
                name="workingDaysOfWeek"
                value={weekday.day}
                defaultChecked={policy.workingDaysOfWeek.includes(weekday.day)}
                className="sr-only"
              />
              <span aria-hidden="true">{weekday.short}</span>
              <span className="sr-only">{weekday.label}</span>
            </label>
          ))}
        </div>
        {errors.workingDaysOfWeek?.length ? (
          <p role="alert" className="mt-1.5 text-[11px] font-medium text-st-late">
            {errors.workingDaysOfWeek.join(' ')}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
            Ignored when every calendar day counts.
          </p>
        )}
      </fieldset>

      <div className="flex justify-end border-t border-line pt-4">
        <SubmitButton
          label="Save policy"
          pendingLabel="Saving…"
          icon={<Save aria-hidden="true" />}
        />
      </div>
    </form>
  );
}

/** Add a public holiday: once, or on the same date every year. */
export function HolidayForm() {
  const [state, formAction] = useActionState(addHolidayAction, initialActionState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-4">
      <ResultBanner state={state} />

      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <FormField id="holiday-date" label="Date" required errors={errors.date}>
          <Input
            id="holiday-date"
            name="date"
            type="date"
            required
            aria-invalid={errors.date ? true : undefined}
          />
        </FormField>
        <FormField id="holiday-name" label="Holiday" required errors={errors.name}>
          <Input
            id="holiday-name"
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Meskel"
            aria-invalid={errors.name ? true : undefined}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField
          id="holiday-recurring"
          label="Repeats"
          errors={errors.isRecurring}
          className="min-w-[14rem] flex-1"
        >
          <Select id="holiday-recurring" name="isRecurring" defaultValue="false">
            <option value="false">This date only — e.g. Fasika, Eid</option>
            <option value="true">Every year on this date — e.g. Meskel</option>
          </Select>
        </FormField>
        <SubmitButton
          label="Add holiday"
          pendingLabel="Adding…"
          icon={<CalendarPlus aria-hidden="true" />}
          variant="outline"
        />
      </div>
    </form>
  );
}
