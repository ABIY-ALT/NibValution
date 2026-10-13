import { redirect } from 'next/navigation';
import { getSession } from '@/server/application/actor';
import { LoginPanel } from './login-panel';

/**
 * The credential card, held in the left half of the pre-authentication split.
 * The card itself is a client component because it welcomes the user before it
 * asks for a password; this page stays on the server to keep the
 * already-signed-in redirect out of the browser.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // An already-authenticated user has no business on the login page.
  const session = await getSession();
  if (session) {
    redirect(session.mustChangePassword ? '/change-password?required=1' : '/dashboard');
  }

  const params = await searchParams;
  const notice =
    params['password-set'] === '1'
      ? 'Your password has been set. Sign in with your email address and new password.'
      : params['password-changed'] === '1'
        ? 'Your password has been changed. Sign in again with your new password.'
        : undefined;

  return <LoginPanel notice={notice} />;
}
