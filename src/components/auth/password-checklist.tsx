'use client';

import { Check, Circle, History } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The password policy as the browser needs it; the server's settings, passed down. */
export interface PasswordRules {
  minLength: number;
  requireComplexity: boolean;
  historyDepth: number;
}

/**
 * Each rule against the password typed so far.
 *
 * The same tests `validatePasswordComplexity` applies on the server, so a box
 * that ticks here is a rule the server will accept. The server still decides:
 * this only saves a round trip.
 */
export function passwordChecks(
  password: string,
  confirm: string,
  rules: PasswordRules,
): { label: string; met: boolean }[] {
  const checks = [{ label: `At least ${rules.minLength} characters`, met: password.length >= rules.minLength }];
  if (rules.requireComplexity) {
    checks.push(
      { label: 'An upper-case letter (A–Z)', met: /[A-Z]/.test(password) },
      { label: 'A lower-case letter (a–z)', met: /[a-z]/.test(password) },
      { label: 'A digit (0–9)', met: /\d/.test(password) },
      { label: 'A symbol, such as # ! @ -', met: /[^A-Za-z0-9]/.test(password) },
    );
  }
  checks.push({ label: 'Both passwords match', met: confirm.length > 0 && password === confirm });
  return checks;
}

export function PasswordChecklist({
  password,
  confirm,
  rules,
}: {
  password: string;
  confirm: string;
  rules: PasswordRules;
}) {
  const checks = passwordChecks(password, confirm, rules);

  return (
    <div
      className="rounded-(--radius-control) border border-line bg-surface-2/60 px-3.5 py-3"
      aria-live="polite"
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
        Password policy
      </p>
      <ul className="space-y-1.5">
        {checks.map((check) => (
          <li
            key={check.label}
            className={cn(
              'flex items-center gap-2 text-[12px]',
              check.met ? 'font-semibold text-st-done' : 'text-ink-3',
            )}
          >
            {check.met ? (
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {check.label}
            <span className="sr-only">{check.met ? ' - done' : ' - not yet'}</span>
          </li>
        ))}
        {rules.historyDepth > 0 ? (
          <li className="flex items-center gap-2 text-[12px] text-ink-3">
            <History className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Not your current password or any of your last {rules.historyDepth}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
