'use client';

import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, Lock, LogIn } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { LoginForm } from './login-form';

/** Matches the flip duration below; the focus hand-off waits for the landing. */
const FLIP_MS = 380;

/**
 * The left-hand card: a welcome on the front, credentials on the back.
 *
 * A true 3D flip rather than a content swap. Both faces occupy the same grid
 * cell, so the card is one size in both states by construction — there is no
 * height to keep in step by hand — and the face turned away is `inert`, so a
 * keyboard or screen reader never reaches the fields behind the welcome.
 */
export function LoginPanel({ notice }: { notice?: string }) {
  // Arriving with a notice (a password just set) means the next step is to
  // sign in, so the card opens on the form rather than the welcome.
  const [flipped, setFlipped] = useState(Boolean(notice));
  const startRef = useRef<HTMLButtonElement>(null);

  const flipToForm = useCallback(() => {
    setFlipped(true);
    // The field is on the face turning towards the viewer. Focusing it before
    // the card lands points the browser at something still facing away.
    window.setTimeout(() => document.getElementById('identifier')?.focus(), FLIP_MS);
  }, []);

  const flipToWelcome = useCallback(() => {
    setFlipped(false);
    window.setTimeout(() => startRef.current?.focus(), FLIP_MS);
  }, []);

  return (
    <div className="w-full [perspective:1600px]">
      <div
        className={cn(
          'grid h-full w-full transition-transform ease-[cubic-bezier(0.2,0.7,0.3,1)] [transform-style:preserve-3d]',
          'duration-[380ms]',
          flipped && '[transform:rotateY(180deg)]',
        )}
      >
        {/* Front */}
        <div className={cn(FACE_CLASSES, 'px-7 sm:px-11')} inert={flipped}>
          <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-tight text-nib-brown-900 sm:text-[48px] dark:text-white">
            Property
            <br />
            Valuation
            <br />
            <span className="text-nib-gold-500 dark:text-nib-gold-400">System</span>
          </h1>

          <p className="mt-6 max-w-[38ch] text-[14px] leading-relaxed text-nib-brown-700/80 dark:text-nib-gold-100/70">
            Making every valuation request simpler, faster and easier to follow.
          </p>

          <button
            ref={startRef}
            type="button"
            onClick={flipToForm}
            className="mt-9 inline-flex h-[54px] w-fit items-center justify-center gap-2.5 rounded-[14px] bg-gradient-to-b from-nib-gold-400 to-nib-gold-500 px-8 text-[14px] font-bold text-nib-brown-900 shadow-[0_14px_28px_-10px_rgba(216,154,22,0.75)] transition hover:from-nib-gold-400 hover:to-nib-gold-400 active:translate-y-px"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Click here to login
          </button>
        </div>

        {/* Back */}
        <div
          className={cn(FACE_CLASSES, 'px-7 sm:px-11', '[transform:rotateY(180deg)]')}
          inert={!flipped}
        >
          <div className="mb-6 flex items-center gap-3">
            <button
              type="button"
              onClick={flipToWelcome}
              aria-label="Back"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-nib-brown-900/12 text-nib-brown-800 transition hover:bg-nib-brown-900/5 dark:border-nib-gold-400/25 dark:text-nib-gold-100 dark:hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-nib-gold-700 dark:text-nib-gold-400">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              Staff sign in
            </p>
          </div>

          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-nib-brown-900 dark:text-white">
            Welcome back
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-nib-brown-700/75 dark:text-nib-gold-100/65">
            Sign in with your NIB work account to reach the Property Valuation System.
          </p>

          <hr className="my-5 border-nib-brown-900/10 dark:border-nib-gold-400/20" />

          {notice ? (
            <Alert variant="success" className="mb-4">
              <CheckCircle2 aria-hidden="true" />
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}

          <LoginForm />
        </div>
      </div>
    </div>
  );
}

/**
 * Both faces are the same box in the same grid cell, so the card cannot change
 * size when it turns. `backface-visibility` is what keeps the face pointing
 * away from being read through the front of the card.
 */
const FACE_CLASSES = [
  'col-start-1 row-start-1 flex w-full flex-col justify-center py-10',
  'rounded-[28px] border border-nib-brown-900/8 bg-white/90 backdrop-blur-xl',
  'shadow-[0_28px_70px_-24px_rgba(58,28,5,0.4)] md:min-h-[470px]',
  'dark:border-nib-gold-400/20 dark:bg-nib-brown-900/80 dark:shadow-[0_28px_70px_-24px_rgba(0,0,0,0.8)]',
  '[backface-visibility:hidden] [-webkit-backface-visibility:hidden]',
].join(' ');
