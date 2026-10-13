'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, KeyRound } from 'lucide-react';
import { changePasswordAction, type FormState } from '@/server/actions/auth-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

const initialState: FormState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      <KeyRound className="h-4 w-4" aria-hidden="true" />
      {pending ? 'Updating…' : 'Change password'}
    </Button>
  );
}

/**
 * Changing a password.
 *
 * Three fields and a button, and nothing else. The policy the server enforces
 * is no longer previewed here as a live checklist: the rules are stated by the
 * server when a password falls short, which is the only moment the reader needs
 * them, and a form that narrates its own requirements while being filled in is
 * a busier screen for a task done twice a year.
 *
 * The failure alert stays. It is the only thing on this form that is not
 * decoration - without it a rejected password change is silent, and the user is
 * left to guess whether anything happened.
 */
export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            {state.message}
            {state.fieldErrors?.newPassword ? (
              <ul className="mt-1 list-disc pl-4">
                {state.fieldErrors.newPassword.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {state.fieldErrors?.confirmPassword ? (
              <ul className="mt-1 list-disc pl-4">
                {state.fieldErrors.confirmPassword.map((problem) => (
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
          className="h-10"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword" required className="text-[12px] font-semibold">
          New password
        </Label>
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          className="h-10"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword" required className="text-[12px] font-semibold">
          Confirm new password
        </Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          className="h-10"
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
        />
      </div>

      <SubmitButton />
    </form>
  );
}
