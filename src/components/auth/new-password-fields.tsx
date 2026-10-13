'use client';

import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { PasswordChecklist, passwordChecks, type PasswordRules } from './password-checklist';

/** True once every rule the checklist shows is met. */
export function newPasswordReady(password: string, confirm: string, rules: PasswordRules): boolean {
  return passwordChecks(password, confirm, rules).every((check) => check.met);
}

/**
 * "New password", "Confirm new password" and the live policy checklist - the
 * same three pieces wherever a password is chosen: the change-password pop-up,
 * the forced change at sign-in, and the emailed set-up or reset link.
 */
export function NewPasswordFields({
  rules,
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
  autoFocus,
}: {
  rules: PasswordRules;
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  errors?: Record<string, string[]>;
  autoFocus?: boolean;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="newPassword" required className="text-[12px] font-semibold">
          New password
        </Label>
        <PasswordInput
          id="newPassword"
          name="newPassword"
          autoComplete="new-password"
          required
          autoFocus={autoFocus}
          className="h-10"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
          aria-invalid={Boolean(errors?.newPassword)}
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
          value={confirm}
          onChange={(event) => onConfirm(event.target.value)}
          aria-invalid={Boolean(errors?.confirmPassword)}
        />
      </div>

      <PasswordChecklist password={password} confirm={confirm} rules={rules} />
    </>
  );
}
