import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { checkPasswordLink, loadPasswordPolicy } from '@/server/application/auth-service';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SetPasswordForm } from './set-password-form';

// A link's validity is decided at the moment it is opened, never from a cache.
export const dynamic = 'force-dynamic';

const CARD_CLASSES = 'rounded-2xl border border-line bg-surface/95 shadow-overlay backdrop-blur-md';

/**
 * Where an emailed set-up or reset link lands.
 *
 * Public: the link is the credential. A link that is unknown, used, expired or
 * belongs to a deactivated account gets one message for all four, so the page
 * cannot be used to learn which of them it was.
 */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { token = '' } = await searchParams;
  const link = await checkPasswordLink(token);

  if (!link) {
    return (
      <Card className={CARD_CLASSES}>
        <CardHeader className="pb-2 text-center">
          <CardTitle className="text-lg font-bold text-ink">Link no longer valid</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              This link has expired or has already been used. Ask your administrator to send a new
              one.
            </AlertDescription>
          </Alert>
          <Link
            href="/login"
            className="block text-center text-[13px] font-semibold text-nib-gold-700 underline-offset-2 hover:underline dark:text-nib-gold-400"
          >
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  const policy = await loadPasswordPolicy();

  return (
    <Card className={CARD_CLASSES}>
      <CardHeader className="pb-2 text-center">
        <CardTitle className="text-lg font-bold text-ink">
          {link.purpose === 'SETUP' ? 'Set Up Your Password' : 'Reset Your Password'}
        </CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          Hello {link.fullName}. Choose a password for{' '}
          <strong className="font-semibold text-ink-2">{link.email}</strong>.
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        <SetPasswordForm
          token={token}
          rules={{
            minLength: policy.minLength,
            requireComplexity: policy.requireComplexity,
            historyDepth: policy.historyDepth,
          }}
          submitLabel={link.purpose === 'SETUP' ? 'Set password' : 'Reset password'}
        />
      </CardContent>
    </Card>
  );
}
