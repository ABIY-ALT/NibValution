import Link from 'next/link';
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  ExternalLink,
  Inbox,
  Radio,
} from 'lucide-react';
import { revalidatePath } from 'next/cache';
import { requireActor } from '@/server/application/actor';
import { PageHero } from '@/components/layout/page-hero';
import { loadNotificationFeed, markMailboxRead } from '@/server/application/notification-service';
import { Card } from '@/components/ui/card';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

async function markAllAsReadAction() {
  'use server';
  const actor = await requireActor();
  await markMailboxRead(actor);
  revalidatePath('/notifications');
}

/** Dates render in one fixed zone so a notice does not shift with the server. */
const STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

const TONE_ICON = {
  alert: AlertTriangle,
  action: Clock,
  info: CheckCircle2,
} as const;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const actor = await requireActor();
  const { filter = 'all' } = await searchParams;
  const unreadOnly = filter === 'unread';

  const feed = await loadNotificationFeed(actor, { limit: 60, unreadOnly });

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Communications"
        title="Notification Centre"
        subtitle="Institutional messages, workflow stage transitions, SLA alerts and case assignment updates."
        actions={
          feed.mailboxUnread > 0 ? (
            <form action={markAllAsReadAction}>
              <Button type="submit" variant="outline">
                <CheckCheck aria-hidden="true" />
                Mark messages as read
              </Button>
            </form>
          ) : feed.unreadCount > 0 ? (
            // Live alerts cannot be marked read — they clear when the work moves
            // on — so say what is outstanding rather than offering a dead button.
            <Badge variant="warning" size="lg">
              {feed.unreadCount} outstanding
            </Badge>
          ) : (
            <Badge variant="success" size="lg">
              All caught up
            </Badge>
          )
        }
      />

      <StatGrid>
        <StatCard
          label="Total notices"
          value={feed.totalCount}
          caption="Messages and live alerts"
          icon={Bell}
          tone="brand"
        />
        <StatCard
          label="Outstanding"
          value={feed.unreadCount}
          caption="Pending your attention"
          icon={Clock}
          tone={feed.unreadCount > 0 ? 'warning' : 'good'}
        />
        <StatCard
          label="Live alerts"
          value={feed.liveCount}
          caption="Derived from open cases"
          icon={Radio}
        />
        <StatCard
          label="Messages"
          value={feed.mailboxCount}
          caption="Dispatched to your mailbox"
          icon={Inbox}
        />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant={!unreadOnly ? 'default' : 'outline'}>
          <Link href="/notifications?filter=all">All notices ({feed.totalCount})</Link>
        </Button>
        <Button asChild variant={unreadOnly ? 'default' : 'outline'}>
          <Link href="/notifications?filter=unread">Outstanding ({feed.unreadCount})</Link>
        </Button>
      </div>

      {feed.notices.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-16 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-3">
            <Bell className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="text-[15px] font-bold text-ink">No notifications right now</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-ink-3">
            {unreadOnly
              ? 'You have caught up with all your outstanding notices.'
              : 'Notices appear here as cases are assigned, returned, sent for approval or pass an SLA checkpoint.'}
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {feed.notices.map((notice) => {
            const Icon = TONE_ICON[notice.tone];

            return (
              <li key={notice.id}>
                <Card
                  className={cn(
                    'overflow-hidden border-l-4 p-5',
                    notice.tone === 'alert'
                      ? 'border-l-st-late bg-surface'
                      : notice.unread
                        ? 'border-l-nib-gold-500 bg-surface'
                        : 'border-l-line bg-surface-2/40 opacity-90',
                  )}
                >
                  <div className="flex items-start gap-4">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control)',
                        notice.tone === 'alert'
                          ? 'bg-st-late-bg text-st-late'
                          : notice.tone === 'action'
                            ? 'bg-st-review-bg text-st-review'
                            : 'bg-surface-3 text-ink-3',
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[13px] font-bold text-ink">{notice.subject}</h2>
                        {notice.unread ? (
                          <Badge variant="accent" size="sm">
                            {notice.source === 'LIVE' ? 'Open' : 'New'}
                          </Badge>
                        ) : null}
                        <Badge variant={notice.tone === 'alert' ? 'danger' : 'default'} size="sm">
                          {notice.eventType.replace(/_/g, ' ')}
                        </Badge>
                        <Badge variant={notice.source === 'LIVE' ? 'brand' : 'inactive'} size="sm">
                          {notice.source === 'LIVE'
                            ? 'Live alert'
                            : notice.channel === 'IN_APP'
                              ? 'In-app'
                              : 'Email'}
                        </Badge>
                        <span className="tabular ml-auto shrink-0 text-[11px] text-ink-3">
                          {STAMP.format(new Date(notice.at))}
                        </span>
                      </div>

                      <p className="mt-1.5 whitespace-pre-line text-[12.5px] leading-relaxed text-ink-2">
                        {notice.body}
                      </p>

                      {notice.href && notice.caseNumber ? (
                        <Link
                          href={notice.href}
                          className="mt-2.5 inline-flex items-center gap-1.5 text-[12px] font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                        >
                          Case {notice.caseNumber}
                          {notice.applicantName ? ` (${notice.applicantName})` : ''}
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {feed.liveCount > 0 ? (
        <p className="text-[11.5px] leading-relaxed text-ink-3">
          Live alerts are read from open cases rather than stored as messages, so they clear
          themselves when the work moves on — marking as read applies to dispatched messages only.
        </p>
      ) : null}
    </div>
  );
}
