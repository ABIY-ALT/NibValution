'use client';

import { startTransition, useActionState, useState } from 'react';
import { AlertCircle, KeyRound } from 'lucide-react';
import { setPasswordFromLinkAction, type FormState } from '@/server/actions/auth-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NewPasswordFields, newPasswordReady } from '@/components/auth/new-password-fields';
import type { PasswordRules } from '@/components/auth/password-checklist';

const initialState: FormState = { ok: false };

/**
 * The new password, twice, with the policy ticking off as it is typed. The
 * token rides along hidden; the server checks it again. Submitted from
 * `onSubmit` so a refused password stays in the fields beside the message.
 */
export function SetPasswordForm({
  token,
  rules,
  submitLabel,
}: {
  token: string;
  rules: PasswordRules;
  submitLabel: string;
}) {
  const [state, dispatch, pending] = useActionState(setPasswordFromLinkAction, initialState);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const problems = [
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
      <input type="hidden" name="token" value={token} />

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

      <NewPasswordFields
        rules={rules}
        password={password}
        confirm={confirm}
        onPassword={setPassword}
        onConfirm={setConfirm}
        errors={state.fieldErrors}
        autoFocus
      />

      <Button
        type="submit"
        className="w-full"
        disabled={pending || !newPasswordReady(password, confirm, rules)}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
