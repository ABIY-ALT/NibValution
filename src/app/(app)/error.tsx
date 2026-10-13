'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Safety net for anything that throws inside the authenticated shell.
 *
 * Authorisation refusals are handled where they occur and render a clear
 * explanation, so reaching this boundary means something genuinely unexpected
 * happened. It shows the digest rather than the message: Next redacts server
 * error messages in production precisely so an internal fault cannot leak
 * database or path detail to a user, and the digest is what ties the screen to
 * the server log entry.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has already logged this with its correlation id; this records
    // that the user actually saw the failure.
    console.error('Unhandled application error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert variant="destructive">
        <AlertOctagon className="h-4 w-4" aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            The page could not be displayed. Nothing has been changed by this request. If it keeps
            happening, quote the reference below to the system administrator.
          </p>
          {error.digest ? <p className="font-mono text-xs">Reference: {error.digest}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={reset}>
              Try again
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
