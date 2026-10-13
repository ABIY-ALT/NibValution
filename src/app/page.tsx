import { redirect } from 'next/navigation';
import { getSession } from '@/server/application/actor';

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  redirect(session.mustChangePassword ? '/change-password?required=1' : '/dashboard');
}
