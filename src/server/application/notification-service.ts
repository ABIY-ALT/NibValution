import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import { caseScopeFilter } from './dashboard-service';

/**
 * The notification feed.
 *
 * The bell and the Notification Centre used to disagree: the bell counted work
 * in trouble (overdue SLA records and cases sent back), while the page listed
 * rows from the `notifications` table, which nothing in the application writes
 * yet. So the bell reported nine items and the page reported none, and both
 * were telling the truth about different things.
 *
 * One source now answers both. It merges the stored mailbox — the rows the
 * dispatcher will write once it exists — with notices derived from live case
 * state. A derived notice is not a record of something that happened; it is the
 * standing fact that a case needs this person, and it stops being true the
 * moment the work moves on. That is why it has no read flag: there is nothing
 * to dismiss, only work to do.
 */

/**
 * Which cases may raise a notice for this actor.
 *
 * Deliberately *not* `caseScopeFilter`. That filter answers "what may this
 * person read", and for an administrator the answer is everything — which
 * turned every breached SLA in the bank into a personal alert and put thirty
 * notices on an account that owed work on none of them. A notification claims
 * something needs *you*, so it has to follow responsibility, not visibility.
 *
 * Oversight of every breach is a reporting question and keeps its home on the
 * SLA report, which is scoped by visibility as before.
 */
function responsibilityFilter(actor: Actor): Prisma.ValuationCaseWhereInput {
  const clauses: Prisma.ValuationCaseWhereInput[] = [
    { makerId: actor.id },
    { checkerId: actor.id },
    { makerManagerId: actor.id },
    { checkerManagerId: actor.id },
    { requestedById: actor.id },
  ];

  // A director signs for the department and is never named on the case, so the
  // only thing that makes one theirs is a case standing at their gate.
  if (actor.departmentId && actor.permissions.has(PERMISSIONS.APPROVAL_DIRECTOR)) {
    clauses.push({
      departmentId: actor.departmentId,
      status: 'PENDING_DIRECTOR_APPROVAL',
    });
  }

  return { OR: clauses };
}

export type NoticeTone = 'alert' | 'action' | 'info';

export interface FeedNotice {
  /** Stable within a render; derived ids are prefixed by their source. */
  id: string;
  source: 'MAILBOX' | 'LIVE';
  eventType: string;
  channel: 'IN_APP' | 'EMAIL';
  tone: NoticeTone;
  subject: string;
  body: string;
  /** ISO-8601. The feed crosses into a client component, so no Date objects. */
  at: string;
  unread: boolean;
  href: string | null;
  caseNumber: string | null;
  applicantName: string | null;
}

export interface NotificationFeed {
  notices: FeedNotice[];
  unreadCount: number;
  totalCount: number;
  mailboxCount: number;
  /** Dispatched messages still unread — the only thing "mark as read" can act on. */
  mailboxUnread: number;
  liveCount: number;
}

/**
 * How many rows to pull from each source. The feed is a summary, not an export:
 * beyond this the badge reads "9+" and the page says what it is showing, which
 * is cheaper and more honest than counting a mailbox nobody will read to the
 * end.
 */
const PER_SOURCE = 25;

const DAY_STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/** Stage labels read as a sentence, not as an enum. */
function humanStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase();
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export async function loadNotificationFeed(
  actor: Actor,
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationFeed> {
  const { limit = 25, unreadOnly = false } = options;
  // Notices follow responsibility; the unassigned-task branch below is the one
  // place visibility still applies, because work open to your role is yours to
  // pick up whether or not your name is on it yet.
  const mine = responsibilityFilter(actor);
  const roleVisible = caseScopeFilter(actor);
  const now = new Date();

  const [mailbox, mailboxCount, mailboxUnread, overdue, returned, approvals, tasks] =
    await Promise.all([
      prisma.notification.findMany({
        where: { recipientId: actor.id, ...(unreadOnly ? { readAt: null } : {}) },
        include: { case: { select: { id: true, caseNumber: true, applicantName: true } } },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
      }),
      prisma.notification.count({ where: { recipientId: actor.id } }),
      prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),

      prisma.slaRecord.findMany({
        where: { case: mine, status: 'BREACHED' },
        include: {
          case: { select: { id: true, caseNumber: true, applicantName: true, status: true } },
        },
        orderBy: { dueAt: 'asc' },
        take: PER_SOURCE,
      }),

      prisma.valuationCase.findMany({
        where: { AND: [mine, { status: 'RETURNED_FOR_CORRECTION' }] },
        select: {
          id: true,
          caseNumber: true,
          applicantName: true,
          remarks: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: PER_SOURCE,
      }),

      prisma.valuationCase.findMany({
        where: {
          AND: [
            mine,
            { status: { in: ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL'] } },
          ],
        },
        select: {
          id: true,
          caseNumber: true,
          applicantName: true,
          status: true,
          submittedAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: PER_SOURCE,
      }),

      prisma.workflowTask.findMany({
        where: {
          completedAt: null,
          OR: [
            { assigneeId: actor.id },
            { assigneeId: null, roleCode: { in: [...actor.roles] }, case: roleVisible },
          ],
        },
        include: {
          case: { select: { id: true, caseNumber: true, applicantName: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: PER_SOURCE,
      }),
    ]);

  const notices: FeedNotice[] = [];

  for (const n of mailbox) {
    notices.push({
      id: `mailbox:${n.id}`,
      source: 'MAILBOX',
      eventType: n.eventType,
      channel: n.channel === 'EMAIL' ? 'EMAIL' : 'IN_APP',
      tone: n.eventType.includes('SLA') || n.eventType.includes('WARNING') ? 'alert' : 'info',
      subject: n.subject,
      body: n.body,
      at: n.createdAt.toISOString(),
      unread: n.readAt === null,
      href: n.case ? `/requests/${n.case.id}` : null,
      caseNumber: n.case?.caseNumber ?? null,
      applicantName: n.case?.applicantName ?? null,
    });
  }

  for (const record of overdue) {
    const late = daysBetween(record.dueAt, now);
    notices.push({
      id: `sla:${record.id}`,
      source: 'LIVE',
      eventType: 'SLA_BREACH',
      channel: 'IN_APP',
      tone: 'alert',
      subject: `SLA breached — case ${record.case.caseNumber}`,
      body: `Due ${DAY_STAMP.format(record.dueAt)}${late > 0 ? `, ${late} day${late === 1 ? '' : 's'} ago` : ''}. The case is still at ${humanStatus(record.case.status)}.`,
      // The breach is the event; it is current as long as the case is open.
      at: record.dueAt.toISOString(),
      unread: true,
      href: `/requests/${record.case.id}`,
      caseNumber: record.case.caseNumber,
      applicantName: record.case.applicantName,
    });
  }

  for (const c of returned) {
    notices.push({
      id: `returned:${c.id}`,
      source: 'LIVE',
      eventType: 'RETURNED_FOR_CORRECTION',
      channel: 'IN_APP',
      tone: 'action',
      subject: `Returned for correction — case ${c.caseNumber}`,
      body: c.remarks?.trim()
        ? `Sent back with remarks: ${c.remarks.trim()}`
        : 'Sent back for correction. Open the case to see what the reviewer asked for.',
      at: c.updatedAt.toISOString(),
      unread: true,
      href: `/requests/${c.id}`,
      caseNumber: c.caseNumber,
      applicantName: c.applicantName,
    });
  }

  for (const c of approvals) {
    const level = c.status === 'PENDING_DIRECTOR_APPROVAL' ? 'Director' : 'Manager';
    notices.push({
      id: `approval:${c.id}`,
      source: 'LIVE',
      eventType: 'APPROVAL_PENDING',
      channel: 'IN_APP',
      tone: 'action',
      subject: `Awaiting ${level.toLowerCase()} approval — case ${c.caseNumber}`,
      body: `${level} sign-off is outstanding${c.submittedAt ? `, submitted ${DAY_STAMP.format(c.submittedAt)}` : ''}.`,
      at: (c.submittedAt ?? c.updatedAt).toISOString(),
      unread: true,
      href: `/requests/${c.id}`,
      caseNumber: c.caseNumber,
      applicantName: c.applicantName,
    });
  }

  for (const task of tasks) {
    notices.push({
      id: `task:${task.id}`,
      source: 'LIVE',
      eventType: 'TASK_OPEN',
      channel: 'IN_APP',
      tone: 'info',
      subject: `${task.assigneeId ? 'Assigned to you' : 'Open for your role'} — case ${task.case.caseNumber}`,
      body: `${humanStatus(task.taskType)} is open at ${humanStatus(task.case.status)}.`,
      at: task.createdAt.toISOString(),
      unread: true,
      href: `/requests/${task.case.id}`,
      caseNumber: task.case.caseNumber,
      applicantName: task.case.applicantName,
    });
  }

  // Alerts first, then anything needing a decision, then the rest — each group
  // newest first. A breached SLA under a week-old assignment reads as noise.
  const TONE_ORDER: Record<NoticeTone, number> = { alert: 0, action: 1, info: 2 };
  notices.sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || Date.parse(b.at) - Date.parse(a.at),
  );

  const liveCount = notices.length - mailbox.length;
  const visible = unreadOnly ? notices.filter((n) => n.unread) : notices;

  return {
    notices: visible.slice(0, limit),
    // Derived notices are always outstanding, so they count as unread.
    unreadCount: mailboxUnread + liveCount,
    totalCount: mailboxCount + liveCount,
    mailboxCount,
    mailboxUnread,
    liveCount,
  };
}

/**
 * Marks the dispatched messages in this actor mailbox as read.
 *
 * Live alerts are deliberately untouched: they are not messages someone sent,
 * they are work still standing open, and a read flag would only hide them.
 */
export async function markMailboxRead(actor: Actor): Promise<number> {
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: actor.id, readAt: null },
    data: { readAt: new Date(), status: 'SENT' },
  });
  return count;
}
