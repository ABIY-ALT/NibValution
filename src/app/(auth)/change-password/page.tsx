import { redirect } from 'next/navigation';
import { getSession } from '@/server/application/actor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangePasswordForm } from './change-password-form';

/**
 * The change-password screen.
 *
 * Deliberately bare: a heading, the three fields and the button. Everything the
 * card used to carry alongside them - the policy checklist, the initial-password
 * warning, the note about other sessions - has been removed. The rules are
 * still enforced by the server and stated when a password is refused; they no
 * longer occupy the screen while it is being filled in.
 */
export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <Card className="rounded-2xl border border-line bg-surface/95 shadow-overlay backdrop-blur-md">
      <CardHeader className="pb-2 text-center">
        <CardTitle className="text-lg font-bold text-ink">Change Password</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <ChangePasswordForm />
      </CardContent>
    </Card>
  );
}
