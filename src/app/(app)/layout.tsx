import { redirect } from 'next/navigation';
import { getSession } from '@/server/application/actor';
import { logoutAction } from '@/server/actions/auth-actions';
import { loadNavBadges } from '@/server/application/case-service';
import { loadHeaderProfile } from '@/server/application/profile-service';
import { loadNotificationFeed } from '@/server/application/notification-service';
import { ShellProvider, Sidebar } from '@/components/navigation/sidebar';
import { upcomingItems, visibleSections } from '@/components/navigation/nav-config';
import { AppHeader } from '@/components/layout/app-header';
import { GroundRelief } from '@/components/layout/hex-relief';
import { scheduleSlaSweep } from '@/server/application/sla-service';
import { ROLE_LABELS } from '@/server/domain/shared/enums';

/**
 * The authenticated application shell: a light navigation rail on the left,
 * and a header that floats as its own card above the scrolling content,
 * carrying search, the notification bell and the account menu.
 *
 * Two gates run here before any page renders - an unauthenticated visitor goes
 * to the login page, and a user on an initial or expired password is held at
 * the change-password page. Neither replaces the per-action authorisation
 * checks; this layout only decides what is worth rendering.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.mustChangePassword) redirect('/change-password?required=1');

  const { actor } = session;

  // Keeps SLA states current between scheduled sweeps: at most every five
  // minutes, in the background, never delaying the page.
  scheduleSlaSweep();

  const [badges, profile, feed] = await Promise.all([
    loadNavBadges(actor),
    loadHeaderProfile(actor),
    // The bell and the Notification Centre read the same feed, so the number on
    // the badge is the number of items the panel can actually show.
    loadNotificationFeed(actor, { limit: 6 }),
  ]);

  const sections = visibleSections(actor.permissions);
  const upcoming = upcomingItems(actor.permissions);
  const roleLabels = actor.roles.map((role) => ROLE_LABELS[role] ?? role).join(' · ');

  const initials =
    actor.fullName
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'NB';

  return (
    <ShellProvider>
      <div className="flex h-screen overflow-hidden bg-app print:block print:h-auto print:overflow-visible print:bg-white">
        <Sidebar sections={sections} upcoming={upcoming} badges={badges} />

        {/* Deliberately not a stacking context: a dialog rendered inside the
            page must reach the root one to cover the rail. The ground goes
            first, and the header band and the page after it are positioned,
            so both paint over it. */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible">
          <GroundRelief />

          {/* Outside the scroll container, so the page scrolls beneath the
              header rather than taking it along. Positioned so the header's
              menus and shadow paint over the page below.

              The gutter beside the rail is the same 24px as the gap between
              cards, and the content fills the column rather than centring in a
              capped width - centring split any spare width either side, so the
              gap to the rail grew on a wide screen or a zoomed-out page. */}
          <div className="no-print relative z-30 shrink-0 px-4 pt-3 sm:px-6 sm:pt-4">
            <AppHeader
              signOut={logoutAction}
              notices={feed.notices}
              user={{
                fullName: actor.fullName,
                email: profile.email,
                roleLabels,
                initials,
                organisation: profile.organisation,
                unreadCount: feed.unreadCount,
              }}
            />
          </div>

          {/* Transparent, so the ground shows through; the shell supplies the colour. */}
          <main className="relative flex-1 overflow-y-auto print:overflow-visible print:bg-white">
            <div className="page-enter w-full px-4 py-6 sm:px-6 lg:py-8 print:p-0">{children}</div>
          </main>
        </div>
      </div>
    </ShellProvider>
  );
}
