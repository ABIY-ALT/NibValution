'use client';

import { useState } from 'react';
import { ShieldCheck, UserPlus } from 'lucide-react';
import { createUserAction, type LinkResult } from '@/server/actions/admin-actions';
import { ResultBanner } from '@/components/admin/create-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { RoleCode } from '@/server/domain/shared/enums';
import {
  PasswordLinkPanel,
  SendEmailCheckbox,
  UserDetailsFields,
  useFormAction,
  type UserFormOptions,
} from './user-form-parts';

const initial: LinkResult = { ok: false };

/**
 * Opening an account.
 *
 * The form carries no password field. The new user is emailed a link to set
 * their own, so the administrator never knows it; until they use it, the
 * account cannot be signed in to.
 */
export function AddUserDialog({
  options,
  roles,
  canAssignRoles,
}: {
  options: UserFormOptions;
  roles: { code: RoleCode; label: string }[];
  canAssignRoles: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A new key remounts the form, so "Add another" starts blank and the result
  // of the previous submission is gone with it.
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus aria-hidden="true" />
        Add user
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFormKey((key) => key + 1);
        }}
      >
        <DialogContent className="max-w-2xl">
          <AddUserForm
            key={formKey}
            options={options}
            roles={roles}
            canAssignRoles={canAssignRoles}
            onAnother={() => setFormKey((key) => key + 1)}
            onDone={() => {
              setOpen(false);
              setFormKey((key) => key + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddUserForm({
  options,
  roles,
  canAssignRoles,
  onAnother,
  onDone,
}: {
  options: UserFormOptions;
  roles: { code: RoleCode; label: string }[];
  canAssignRoles: boolean;
  onAnother: () => void;
  onDone: () => void;
}) {
  const [state, onSubmit, pending] = useFormAction(createUserAction, initial);
  const created = state.ok && state.done === true;

  return (
    <form onSubmit={onSubmit} noValidate className="contents">
      <DialogHeader>
        <DialogTitle>Add a user</DialogTitle>
        <DialogDescription>
          The new user is emailed a link to set their own password. Until they use it, the account
          cannot be signed in to.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-5">
        <ResultBanner state={state} />

        {created ? (
          state.link ? (
            <PasswordLinkPanel link={state.link} />
          ) : null
        ) : (
          <>
            <UserDetailsFields idPrefix="new-user" options={options} errors={state.fieldErrors} />

            {canAssignRoles ? (
              <fieldset>
                <legend className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-ink">
                  <ShieldCheck className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
                  Roles
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {roles.map((role) => (
                    <label
                      key={role.code}
                      className="flex cursor-pointer items-center gap-2.5 rounded-(--radius-control) border border-line bg-surface px-3 py-2 text-[12.5px] transition-colors hover:border-nib-gold-500/40 hover:bg-surface-2"
                    >
                      <input
                        type="checkbox"
                        name="roles"
                        value={role.code}
                        className="h-4 w-4 shrink-0 rounded border-line-strong accent-nib-gold-500"
                      />
                      <span className="min-w-0 truncate">{role.label}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                  Roles can be changed later from the user&apos;s Roles tab.
                </p>
              </fieldset>
            ) : null}

            <SendEmailCheckbox id="new-user-send-email" />
          </>
        )}
      </DialogBody>

      <DialogFooter>
        {created ? (
          <>
            <Button type="button" variant="outline" onClick={onAnother}>
              <UserPlus aria-hidden="true" />
              Add another
            </Button>
            <Button type="button" onClick={onDone}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <UserPlus aria-hidden="true" />
              {pending ? 'Creating…' : 'Create user'}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}
