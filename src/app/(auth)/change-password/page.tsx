import { redirect } from 'next/navigation';
import { getSession } from '@/server/application/actor';
import { loadPasswordPolicy } from '@/server/application/auth-service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from '@/components/auth/change-password-form';

/**
 * The forced change-password screen: where a user whose password must be
 * replaced (an initial or expired one) is held before reaching the system.
 *
 * Someone already inside the system changes their password from the pop-up in
 * the account menu instead, so this page is only ever the gate.
 */
export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.mustChangePassword) redirect('/dashboard');

  const policy = await loadPasswordPolicy();

  return (
    <Card className="w-full rounded-2xl border border-line bg-surface/95 shadow-overlay backdrop-blur-md">
      <CardHeader className="pb-2 text-center">
        <CardTitle className="text-lg font-bold text-ink">Change Password</CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          Your password must be changed before you continue.
        </p>
      </CardHeader>
      <CardContent className="pt-2">
        <ChangePasswordForm
          rules={{
            minLength: policy.minLength,
            requireComplexity: policy.requireComplexity,
            historyDepth: policy.historyDepth,
          }}
        />
      </CardContent>
    </Card>
  );
}
