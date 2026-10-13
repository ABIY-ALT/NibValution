'use client';

import * as React from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A password field with a reveal toggle.
 *
 * Showing the password is a genuine usability gain — most mistyped passwords
 * are caught by looking at them — so the control is a real button rather than
 * an icon glyph: it is focusable, reachable by keyboard, and announces its
 * state to a screen reader.
 *
 * The field always starts masked, and toggling never changes the submitted
 * value; only the input's `type` changes.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { showLockIcon?: boolean }
>(({ className, showLockIcon = true, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      {showLockIcon ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-3"
          aria-hidden="true"
        >
          <Lock className="h-4 w-4" />
        </div>
      ) : null}

      <Input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={cn(showLockIcon && 'pl-9', 'pr-10', className)}
        {...props}
      />

      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // Excluded from the tab order of a form being filled quickly; still
        // reachable, and the label says what it does either way.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-ink-3 transition-colors hover:text-ink focus-visible:text-ink"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
