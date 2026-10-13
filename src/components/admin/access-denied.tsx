import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * A deliberate refusal, not a crash.
 *
 * Authorisation is asserted in the service layer, where it throws - that is the
 * real boundary and it stays. But a user who reaches a page they may not use
 * should be told so plainly rather than shown a server error, which reads as a
 * broken system and buries a genuine fault in the noise.
 *
 * The message names the permission required but reveals nothing about the
 * records behind the page.
 */
export function AccessDenied({
  permission,
  what = 'this page',
}: {
  permission: string;
  what?: string;
}) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" aria-hidden />
        <AlertTitle>You do not have access to {what}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            It requires the <span className="font-mono text-xs">{permission}</span> permission,
            which none of your roles currently grants. If you believe this is wrong, ask a system
            administrator to review your roles.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
