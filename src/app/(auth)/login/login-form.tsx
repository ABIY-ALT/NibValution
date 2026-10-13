'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Eye, EyeOff, Lock, LogIn, User } from 'lucide-react';
import { loginAction, type FormState } from '@/server/actions/auth-actions';

const initialState: FormState = { ok: false };

/**
 * The credential fields.
 *
 * Styled directly rather than through the application's `Input` and `Button`:
 * those carry the in-application surface tokens, which sit on an opaque
 * `bg-surface`. This card is translucent over the honeycomb ground and needs
 * its own treatment on both themes, so the classes are explicit here rather
 * than fighting the shared components with overrides.
 *
 * The labels are visually hidden rather than absent: the leading icon carries
 * the meaning for a sighted user, and the label carries it for everyone else.
 */
const FIELD_CLASSES = [
  'w-full h-[54px] rounded-[14px] bg-nib-cream/70 border border-nib-brown-900/12 text-[14.5px] text-nib-brown-900',
  'placeholder:text-nib-brown-700/40',
  'focus:outline-none focus:border-nib-gold-500 focus:bg-white focus:ring-4 focus:ring-nib-gold-500/15 transition',
  'dark:bg-black/30 dark:border-nib-gold-400/25 dark:text-white',
  'dark:placeholder:text-nib-gold-100/30 dark:focus:border-nib-gold-400 dark:focus:bg-black/40',
  'aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-red-500/15',
].join(' ');

const ICON_CLASSES =
  'pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-nib-brown-700/55 dark:text-nib-gold-100/45';

function FieldError({ id, messages }: { id: string; messages?: string[] }) {
  if (!messages?.length) return null;
  return (
    <p id={id} className="mt-1.5 text-[11px] font-medium text-red-700 dark:text-red-300">
      {messages.join(' ')}
    </p>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-nib-gold-400 to-nib-gold-500 text-[14px] font-bold text-nib-brown-900 shadow-[0_14px_28px_-10px_rgba(216,154,22,0.75)] transition hover:from-nib-gold-400 hover:to-nib-gold-400 active:translate-y-px disabled:from-nib-gold-700/40 disabled:to-nib-gold-700/40 disabled:text-nib-brown-900/40 disabled:shadow-none"
    >
      <LogIn className="h-4 w-4" aria-hidden="true" />
      {pending ? 'Signing in…' : 'Sign In'}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      {state.message ? (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-3.5 py-3 text-left dark:border-red-400/30 dark:bg-red-950/50"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300"
            aria-hidden="true"
          />
          <p className="text-[12px] leading-relaxed text-red-800 dark:text-red-200">
            {state.message}
          </p>
        </div>
      ) : null}

      <form action={formAction} className="space-y-5" noValidate>
        <div>
          <label htmlFor="identifier" className="sr-only">
            Institutional email or employee ID
          </label>
          <div className="relative">
            <User className={ICON_CLASSES} aria-hidden="true" />
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="name@nibbank.com.et"
              className={`${FIELD_CLASSES} pl-12 pr-4`}
              aria-invalid={Boolean(state.fieldErrors?.identifier)}
              aria-describedby={state.fieldErrors?.identifier ? 'identifier-error' : undefined}
            />
          </div>
          <FieldError id="identifier-error" messages={state.fieldErrors?.identifier} />
        </div>

        <div>
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <div className="relative">
            <Lock className={ICON_CLASSES} aria-hidden="true" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              placeholder="••••••••••••"
              className={`${FIELD_CLASSES} pl-12 pr-12`}
              aria-invalid={Boolean(state.fieldErrors?.password)}
              aria-describedby={state.fieldErrors?.password ? 'password-error' : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-nib-brown-700/60 transition hover:bg-nib-brown-900/8 hover:text-nib-brown-900 dark:text-nib-gold-100/50 dark:hover:bg-white/10 dark:hover:text-white"
            >
              {showPassword ? (
                <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
          </div>
          <FieldError id="password-error" messages={state.fieldErrors?.password} />
        </div>

        <SubmitButton />
      </form>

      <p className="mt-4 text-[10.5px] leading-[1.5] text-nib-brown-700/65 dark:text-nib-gold-100/50">
        Your registered employee ID also works in place of the email address. Accounts are locked
        after repeated failed attempts — contact the system administrator for recovery.
      </p>
    </>
  );
}
