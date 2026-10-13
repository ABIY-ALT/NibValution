'use client';

import { startTransition, useActionState, useState } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import { changePasswordAction, type FormState } from '@/server/actions/auth-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { NewPasswordFields, newPasswordReady } from './new-password-fields';
import type { PasswordRules } from './password-checklist';

const initialState: FormState = { ok: false };

/**
 * Changing a password: the current one, the new one twice, and the policy
 * ticking off as it is typed.
 *
 * Shared by the pop-up in the account menu and the forced change at sign-in.
 * On success the server ends the session and sends the user to the sign-in
 * page, where they sign in with the new password.
 *
 * Submitted from `onSubmit` rather than `<form action>`, because React clears
 * a form after its action and these fields are controlled: a refused password
 * would otherwise vanish from under the message explaining why.
 */
export function ChangePasswordForm({
  rules,
  onCancel,
}: {
  rules: PasswordRules;
  onCancel?: () => void;
}) {
  const [state, dispatch, pending] = useActionState(changePasswordAction, initialState);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const ready = current.length > 0 && newPasswordReady(password, confirm, rules);
  const problems = [
    ...(state.fieldErrors?.currentPassword ?? []),
    ...(state.fieldErrors?.newPassword ?? []),
    ...(state.fieldErrors?.confirmPassword ?? []),
  ];

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => dispatch(formData));
      }}
    >
      {state.message ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            {state.message}
            {problems.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="currentPassword" required className="text-[12px] font-semibold">
          Current password
        </Label>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
          autoFocus
          className="h-10"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          aria-invalid={Boolean(state.fieldErrors?.currentPassword)}
        />
      </div>

      <NewPasswordFields
        rules={rules}
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
        errors={state.fieldErrors}
      />

      <p className="text-[11px] leading-relaxed text-ink-3">
        After the change you are signed out everywhere and sign in again with the new password.
      </p>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || !ready} className={onCancel ? '' : 'w-full'}>
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {pending ? 'Updating…' : 'Change password'}
        </Button>
      </div>
    </form>
  );
}
