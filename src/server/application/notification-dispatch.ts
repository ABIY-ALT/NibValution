import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { getMailer, getSmsSender } from '@/server/infrastructure/messaging';
import type { MessageSender } from '@/server/domain/ports/messaging';
import type { CaseStatus } from '@/server/domain/shared/enums';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Notification dispatch (spec section 23; roadmap Phase 7).
 *
 * Events are turned into messages by the `NotificationRule` table - which
 * roles hear about which event, on which channels - so who is told what is
 * configuration, not code. Dispatch runs after the workflow transaction has
 * committed and never throws: a mail server that is down must not undo an
 * approval, and a retried notification must not repeat a state change
 * (workflow doc, section 6).
 *
 * In-app messages land in the recipient's mailbox at once. Email and SMS are
 * recorded first, then sent, and the record keeps the outcome - so a message
 * the relay refused shows as failed rather than vanishing.
 */

export type CaseEvent =
  | 'CASE_REQUESTED'
  | 'CASE_ASSIGNED'
  | 'CASE_SUBMITTED_FOR_CHECKING'
  | 'CHECKER_ASSIGNED'
  | 'CASE_RETURNED'
  | 'COMMENT_ADDED'
  | 'CHECKING_COMPLETED'
  | 'MANAGER_APPROVAL_REQUIRED'
  | 'DIRECTOR_APPROVAL_REQUIRED'
  | 'SLA_APPROACHING'
  | 'SLA_BREACHED'
  | 'CASE_COMPLETED'
  | 'FINAL_REPORT_AVAILABLE';

/** The events a workflow transition raises. */
export function eventsForTransition(action: string, toStatus: CaseStatus): CaseEvent[] {
  const events: CaseEvent[] = [];
  switch (action) {
    case 'SUBMIT_REQUEST':
      events.push('CASE_REQUESTED');
      break;
    case 'ASSIGN_MAKER':
      events.push('CASE_ASSIGNED');
      break;
    case 'SUBMIT_FOR_CHECKING':
      events.push('CASE_SUBMITTED_FOR_CHECKING');
      break;
    case 'ASSIGN_CHECKER':
    case 'RESUBMIT':
      // Both put the case in front of its checker.
      events.push('CHECKER_ASSIGNED');
      break;
    case 'RETURN_FOR_CORRECTION':
    case 'REJECT':
      events.push('CASE_RETURNED');
      break;
    case 'ADD_CHECKER_COMMENT':
      events.push('COMMENT_ADDED');
      break;
    case 'COMPLETE_CHECKING':
      events.push('CHECKING_COMPLETED');
      break;
    case 'DELIVER':
      events.push('CASE_COMPLETED', 'FINAL_REPORT_AVAILABLE');
      break;
  }
  // Approval gates are reached by more than one action, so they follow the
  // status the case lands in.
  if (toStatus === 'PENDING_MANAGER_APPROVAL') events.push('MANAGER_APPROVAL_REQUIRED');
  if (toStatus === 'PENDING_DIRECTOR_APPROVAL') events.push('DIRECTOR_APPROVAL_REQUIRED');
  return events;
}

interface CaseFacts {
  id: string;
  caseNumber: string;
  applicantName: string;
  ownerName: string;
  makerId: string | null;
  checkerId: string | null;
  requestedById: string;
  departmentId: string;
  slaDueAt: Date | null;
}

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** Subject and body per event. Short: the message's job is to send people to the case. */
function compose(
  event: CaseEvent,
  c: CaseFacts,
  context: { action?: string; comment?: string | null },
): { subject: string; body: string } {
  const who = `${c.ownerName} (applicant ${c.applicantName})`;
  const note = context.comment ? `\n\n"${context.comment}"` : '';
  switch (event) {
    case 'CASE_REQUESTED':
      return {
        subject: `New valuation request ${c.caseNumber}`,
        body: `A request for ${who} is waiting to be assigned to a valuator.`,
      };
    case 'CASE_ASSIGNED':
      return {
        subject: `Case ${c.caseNumber} assigned to you`,
        body: `You are the valuator for ${who}. Start the valuation from the case page.`,
      };
    case 'CASE_SUBMITTED_FOR_CHECKING':
      return {
        subject: `Case ${c.caseNumber} is ready for a checker`,
        body: `The valuation of ${who} has been submitted and needs a checker assigned.`,
      };
    case 'CHECKER_ASSIGNED':
      return context.action === 'RESUBMIT'
        ? {
            subject: `Case ${c.caseNumber} resubmitted after correction`,
            body: `The valuator has corrected ${who} and sent it back for checking.${note}`,
          }
        : {
            subject: `Case ${c.caseNumber} assigned to you for checking`,
            body: `Review the valuation of ${who} in its valuation workspace.`,
          };
    case 'CASE_RETURNED':
      return {
        subject: `Case ${c.caseNumber} returned for correction`,
        body: `The valuation of ${who} has been sent back to you.${note}`,
      };
    case 'COMMENT_ADDED':
      return {
        subject: `Review comment on case ${c.caseNumber}`,
        body: `The checker has raised a comment on the valuation of ${who}.${note}`,
      };
    case 'CHECKING_COMPLETED':
      return {
        subject: `Case ${c.caseNumber} has been checked`,
        body: `Checking is complete; the valuator prepares the cover page and submits for approval.`,
      };
    case 'MANAGER_APPROVAL_REQUIRED':
    case 'DIRECTOR_APPROVAL_REQUIRED':
      return {
        subject: `Case ${c.caseNumber} awaits your approval`,
        body: `The valuation of ${who} is ready for your decision.`,
      };
    case 'SLA_APPROACHING':
      return {
        subject: `Case ${c.caseNumber} is close to its turnaround deadline`,
        body: `Due ${c.slaDueAt ? DATE.format(c.slaDueAt) : 'soon'}. ${who}.`,
      };
    case 'SLA_BREACHED':
      return {
        subject: `Case ${c.caseNumber} has passed its turnaround deadline`,
        body: `It was due ${c.slaDueAt ? DATE.format(c.slaDueAt) : 'earlier'} and is still open. ${who}.`,
      };
    case 'CASE_COMPLETED':
      return {
        subject: `Case ${c.caseNumber} completed`,
        body: `The valuation of ${who} is complete and has been delivered.`,
      };
    case 'FINAL_REPORT_AVAILABLE':
      return {
        subject: `Valuation report for ${c.caseNumber} is available`,
        body: `The signed valuation report and final letter for ${who} are ready on the case page.`,
      };
  }
}

type Recipient = { id: string; email: string; phone: string | null };

async function recipientsFor(role: string, c: CaseFacts): Promise<Recipient[]> {
  const select = { id: true, email: true, phone: true } as const;
  const byIds = (ids: (string | null)[]) => {
    const wanted = ids.filter((id): id is string => id !== null);
    return wanted.length === 0
      ? Promise.resolve([] as Recipient[])
      : prisma.user.findMany({ where: { id: { in: wanted }, isActive: true }, select });
  };
  switch (role) {
    case 'MAKER':
      return byIds([c.makerId]);
    case 'CHECKER':
      return byIds([c.checkerId]);
    case 'PROCESS_OWNER':
      return byIds([c.requestedById]);
    default:
      // Department roles: everyone holding the role in the owning department.
      return prisma.user.findMany({
        where: {
          isActive: true,
          departmentId: c.departmentId,
          roles: { some: { role: { code: role } } },
        },
        select,
      });
  }
}

async function deliver(
  sender: MessageSender,
  notificationId: string,
  to: string | null,
  subject: string,
  body: string,
): Promise<void> {
  try {
    if (!to) throw new Error('The recipient has no address for this channel.');
    await sender.send({ to, subject, text: body });
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
    });
  } catch (error) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
      },
    });
  }
}

/**
 * Notify everyone the rules name for these events on this case. Never throws;
 * a failure is logged and the workflow carries on.
 */
export async function dispatchCaseEvents(
  events: readonly CaseEvent[],
  caseId: string,
  context: {
    actorId?: string | null;
    action?: string;
    comment?: string | null;
  } = {},
): Promise<void> {
  if (events.length === 0) return;
  try {
    const [rules, row] = await Promise.all([
      prisma.notificationRule.findMany({
        where: { eventType: { in: [...events] }, isActive: true },
      }),
      prisma.valuationCase.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          caseNumber: true,
          applicantName: true,
          ownerName: true,
          makerId: true,
          checkerId: true,
          requestedById: true,
          departmentId: true,
          slaRecord: { select: { dueAt: true } },
        },
      }),
    ]);
    if (!row || rules.length === 0) return;
    const facts: CaseFacts = { ...row, slaDueAt: row.slaRecord?.dueAt ?? null };
    const link = `${serverEnv.APP_URL}/requests/${caseId}`;
    const sent = new Set<string>();

    for (const rule of rules) {
      const event = rule.eventType as CaseEvent;
      const roles = Array.isArray(rule.roles) ? (rule.roles as string[]) : [];
      const channels = Array.isArray(rule.channels) ? (rule.channels as string[]) : [];
      const { subject, body } = compose(event, facts, context);

      const recipients = (await Promise.all(roles.map((r) => recipientsFor(r, facts)))).flat();
      for (const recipient of recipients) {
        // Nobody is notified of their own action, and nobody twice.
        if (recipient.id === context.actorId) continue;
        for (const channel of channels) {
          const key = `${recipient.id}:${event}:${channel}`;
          if (sent.has(key)) continue;
          sent.add(key);

          const payload: Prisma.InputJsonValue = {
            caseNumber: facts.caseNumber,
            action: context.action ?? null,
            link,
          };
          if (channel === 'IN_APP') {
            await prisma.notification.create({
              data: {
                recipientId: recipient.id,
                caseId,
                eventType: event,
                channel: 'IN_APP',
                subject,
                body,
                payload,
                status: 'SENT',
                sentAt: new Date(),
              },
            });
          } else if (channel === 'EMAIL' || channel === 'SMS') {
            const record = await prisma.notification.create({
              data: {
                recipientId: recipient.id,
                caseId,
                eventType: event,
                channel,
                subject,
                body,
                payload,
              },
            });
            const text = `${body}\n\nOpen the case: ${link}`;
            await deliver(
              channel === 'EMAIL' ? getMailer() : getSmsSender(),
              record.id,
              channel === 'EMAIL' ? recipient.email : recipient.phone,
              `[NIB Valuation] ${subject}`,
              channel === 'EMAIL' ? text : `${subject}. ${link}`,
            );
          }
        }
      }
    }
  } catch (error) {
    logger.error({ err: error, caseId, events }, 'Notification dispatch failed');
  }
}
