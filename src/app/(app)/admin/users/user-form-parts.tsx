'use client';

import { startTransition, useActionState, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { FormField } from '@/components/admin/create-form';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { DISCIPLINES, type Discipline } from '@/server/domain/shared/enums';

export interface UserFormOptions {
  organizations: { id: string; name: string; type: 'BRANCH' | 'DISTRICT' | 'HEAD_OFFICE_UNIT' }[];
  departments: { id: string; name: string }[];
}

export interface UserDetailsValues {
  employeeId: string;
  fullName: string;
  email: string;
  phone: string | null;
  organization: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  discipline: Discipline;
}

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  CIVIL: 'Civil',
  MECHANICAL: 'Mechanical',
  BOTH: 'Civil and mechanical',
  NONE: 'None — not a valuator',
};

const ORGANIZATION_GROUPS = [
  { type: 'HEAD_OFFICE_UNIT', label: 'Head office units' },
  { type: 'DISTRICT', label: 'Districts' },
  { type: 'BRANCH', label: 'Branches' },
] as const;

/**
 * Submit a form to a server action without React's automatic form reset.
 *
 * A `<form action>` is cleared once its action settles, which would wipe
 * everything the administrator typed whenever the server refuses one field (a
 * duplicate email, say). Dispatching from `onSubmit` keeps their input on
 * screen beside the error.
 */
export function useFormAction<S>(
  action: (prev: Awaited<S>, formData: FormData) => S | Promise<S>,
  initial: Awaited<S>,
): [Awaited<S>, (event: React.FormEvent<HTMLFormElement>) => void, boolean] {
  const [state, dispatch, pending] = useActionState(action, initial);
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
  return [state, onSubmit, pending];
}

/** The account fields shared by "Add user" and "Edit details". */
export function UserDetailsFields({
  idPrefix,
  options,
  values,
  errors,
}: {
  idPrefix: string;
  options: UserFormOptions;
  values?: UserDetailsValues;
  errors?: Record<string, string[]>;
}) {
  const id = (field: string) => `${idPrefix}-${field}`;

  // A user can sit in a unit or department that has since been switched off.
  // It is still offered here, so saving the form does not silently move them.
  const orgMissing =
    values?.organization && !options.organizations.some((o) => o.id === values.organization?.id);
  const deptMissing =
    values?.department && !options.departments.some((d) => d.id === values.department?.id);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField id={id('fullName')} label="Full name" required errors={errors?.fullName}>
        <Input
          id={id('fullName')}
          name="fullName"
          maxLength={120}
          autoComplete="off"
          defaultValue={values?.fullName}
          placeholder="Abebe Kebede"
          aria-invalid={Boolean(errors?.fullName)}
        />
      </FormField>

      <FormField
        id={id('employeeId')}
        label="Employee ID"
        required
        errors={errors?.employeeId}
        hint="Stored in capitals. Also accepted at sign-in."
      >
        <Input
          id={id('employeeId')}
          name="employeeId"
          maxLength={40}
          autoComplete="off"
          defaultValue={values?.employeeId}
          placeholder="NIB-01234"
          className="tabular uppercase"
          aria-invalid={Boolean(errors?.employeeId)}
        />
      </FormField>

      <FormField
        id={id('email')}
        label="Email"
        required
        errors={errors?.email}
        hint="The user signs in with this address."
      >
        <Input
          id={id('email')}
          name="email"
          type="email"
          maxLength={254}
          autoComplete="off"
          defaultValue={values?.email}
          placeholder="name@nibbank.com.et"
          aria-invalid={Boolean(errors?.email)}
        />
      </FormField>

      <FormField id={id('phone')} label="Phone" errors={errors?.phone} hint="Used for SMS alerts.">
        <Input
          id={id('phone')}
          name="phone"
          type="tel"
          maxLength={20}
          autoComplete="off"
          defaultValue={values?.phone ?? ''}
          placeholder="+251 911 234 567"
          aria-invalid={Boolean(errors?.phone)}
        />
      </FormField>

      <FormField id={id('organizationId')} label="Organisational unit" errors={errors?.organizationId}>
        <Select
          id={id('organizationId')}
          name="organizationId"
          defaultValue={values?.organization?.id ?? ''}
          aria-invalid={Boolean(errors?.organizationId)}
        >
          <option value="">— None —</option>
          {orgMissing && values?.organization ? (
            <option value={values.organization.id}>{values.organization.name} (inactive)</option>
          ) : null}
          {ORGANIZATION_GROUPS.map((group) => {
            const items = options.organizations.filter((o) => o.type === group.type);
            return items.length > 0 ? (
              <optgroup key={group.type} label={group.label}>
                {items.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </Select>
      </FormField>

      <FormField id={id('departmentId')} label="Department" errors={errors?.departmentId}>
        <Select
          id={id('departmentId')}
          name="departmentId"
          defaultValue={values?.department?.id ?? ''}
          aria-invalid={Boolean(errors?.departmentId)}
        >
          <option value="">— None —</option>
          {deptMissing && values?.department ? (
            <option value={values.department.id}>{values.department.name} (inactive)</option>
          ) : null}
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </FormField>

      <FormField
        id={id('discipline')}
        label="Discipline"
        required
        errors={errors?.discipline}
        hint="Assignment is filtered by discipline: a civil valuator is never given a mechanical case."
        className="sm:col-span-2"
      >
        <Select
          id={id('discipline')}
          name="discipline"
          defaultValue={values?.discipline ?? 'NONE'}
          aria-invalid={Boolean(errors?.discipline)}
        >
          {DISCIPLINES.map((d) => (
            <option key={d} value={d}>
              {DISCIPLINE_LABELS[d]}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}

/** "Email the link" - ticked by default wherever a set-up or reset link is issued. */
export function SendEmailCheckbox({ email, id }: { email?: string; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-[12.5px] text-ink-2">
      <input
        id={id}
        type="checkbox"
        name="sendEmail"
        value="true"
        defaultChecked
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-nib-gold-500"
      />
      <span>
        Email the link to {email ? <strong className="text-ink">{email}</strong> : 'the user'}
        <span className="block text-[11px] text-ink-3">
          Untick to get the link here instead, to pass on yourself.
        </span>
      </span>
    </label>
  );
}

/**
 * A set-up or reset link the email did not carry, for the administrator to
 * pass on. Shown once: only its hash is stored, so it cannot be shown again.
 */
export function PasswordLinkPanel({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an http origin, a browser policy); the
      // link is in the field to select by hand.
    }
  }

  return (
    <div className="rounded-(--radius-control) border border-nib-gold-500/40 bg-nib-gold-500/10 p-4">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
        <Link2 className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
        Password link
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          readOnly
          value={link}
          aria-label="Password link"
          onFocus={(event) => event.currentTarget.select()}
          className="tabular h-9 text-[12px]"
        />
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        Shown only now. Whoever opens it can set the password, so give it to the user alone.
      </p>
    </div>
  );
}
