import { prisma, withTransaction } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import {
  assertCaseAccess,
  assertPermission,
  canAccessCase,
  type Actor,
} from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { CaseStatus } from '@/server/domain/shared/enums';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import type {
  RaiseCommentInput,
  ReplyCommentInput,
  ResolveCommentInput,
} from '@/lib/validation/review';
import { getNumberConfig } from './configuration-service';
import { performTransition, type RequestContextInput } from './case-service';
import { dispatchCaseEvents } from './notification-dispatch';

/**
 * The checker's review (spec section 33; roadmap Phase 4).
 *
 * The checker raises comments, each tagged with the part of the valuation it
 * concerns. The first comment of a review moves the case from CHECKING to
 * COMMENTED through the workflow engine; later ones are added while it stays
 * there. Maker and checker reply in the comment's thread, and only the checker
 * marks it resolved - the one who raised a doubt is the one who says it is
 * settled. Checking cannot complete while any comment is open.
 */

/** While the case is in the checking loop, the thread stays open for replies. */
const REVIEW_STATUSES = new Set<CaseStatus>(['CHECKING', 'COMMENTED', 'RETURNED_FOR_CORRECTION']);

async function loadSubject(caseId: string) {
  const subject = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      version: true,
      requestingOrgId: true,
      departmentId: true,
      requestedById: true,
      makerId: true,
      checkerId: true,
    },
  });
  if (!subject) throw new NotFoundError('The requested case was not found.');
  return subject;
}

export interface ReviewReply {
  id: string;
  body: string;
  author: string;
  authorIsChecker: boolean;
  createdAt: Date;
}

export interface ReviewThread extends ReviewReply {
  section: string;
  isResolved: boolean;
  resolvedAt: Date | null;
  replies: ReviewReply[];
}

export interface ReviewState {
  threads: ReviewThread[];
  open: number;
  canRaise: boolean;
  canReply: boolean;
  canResolve: boolean;
}

/** The review threads on a case, oldest first, with what this actor may do. */
export async function loadReview(actor: Actor, caseId: string): Promise<ReviewState | null> {
  const subject = await loadSubject(caseId);
  if (!canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ)) return null;

  const rows = await prisma.comment.findMany({
    where: { caseId, parentId: null },
    orderBy: { createdAt: 'asc' },
    include: {
      author: { select: { id: true, fullName: true } },
      replies: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, fullName: true } } },
      },
    },
  });

  const status = subject.status as CaseStatus;
  const isChecker = canAccessCase(actor, subject, PERMISSIONS.VALUATION_CHECK);
  const isMaker = canAccessCase(actor, subject, PERMISSIONS.VALUATION_EDIT);

  return {
    threads: rows.map((row) => ({
      id: row.id,
      body: row.body,
      author: row.author.fullName,
      authorIsChecker: row.author.id === subject.checkerId,
      createdAt: row.createdAt,
      section: row.section ?? 'GENERAL',
      isResolved: row.isResolved,
      resolvedAt: row.resolvedAt,
      replies: row.replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        author: reply.author.fullName,
        authorIsChecker: reply.author.id === subject.checkerId,
        createdAt: reply.createdAt,
      })),
    })),
    open: rows.filter((row) => !row.isResolved).length,
    canRaise: isChecker && (status === 'CHECKING' || status === 'COMMENTED'),
    canReply: (isChecker || isMaker) && REVIEW_STATUSES.has(status),
    canResolve: isChecker && REVIEW_STATUSES.has(status),
  };
}

/** Open review comments on a case, for the case page's summary. */
export async function countOpenComments(caseId: string): Promise<number> {
  return prisma.comment.count({ where: { caseId, parentId: null, isResolved: false } });
}

export async function raiseComment(
  actor: Actor,
  input: RaiseCommentInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_CHECK);
  const subject = await loadSubject(input.caseId);
  assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_CHECK);

  const minLength = await getNumberConfig('comment.min_length', 10);
  if (input.body.length < minLength) {
    throw new BusinessRuleError(
      'COMMENT_TOO_SHORT',
      `A review comment needs at least ${minLength} characters, so the valuator knows what to change.`,
    );
  }

  if (subject.status === 'CHECKING') {
    // The first comment is the CHECKING -> COMMENTED transition itself, so it
    // is recorded in the timeline and audited like any other.
    await performTransition(
      actor,
      {
        caseId: input.caseId,
        action: 'ADD_CHECKER_COMMENT',
        expectedVersion: subject.version,
        comment: input.body,
        commentSection: input.section,
      },
      ctx,
    );
    return;
  }

  if (subject.status !== 'COMMENTED') {
    throw new BusinessRuleError(
      'NOT_UNDER_REVIEW',
      'Comments are raised while the case is being checked.',
    );
  }

  await withTransaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        caseId: input.caseId,
        authorId: actor.id,
        section: input.section,
        body: input.body,
      },
    });
    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'COMMENT_ADDED',
      entity: 'Comment',
      entityId: comment.id,
      after: { caseId: input.caseId, section: input.section },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
  // The first comment notifies through its transition; later ones do so here.
  await dispatchCaseEvents(['COMMENT_ADDED'], input.caseId, {
    actorId: actor.id,
    comment: input.body,
  });
}

export async function replyToComment(
  actor: Actor,
  input: ReplyCommentInput,
  ctx: RequestContextInput,
): Promise<void> {
  const subject = await loadSubject(input.caseId);
  const isChecker = canAccessCase(actor, subject, PERMISSIONS.VALUATION_CHECK);
  const isMaker = canAccessCase(actor, subject, PERMISSIONS.VALUATION_EDIT);
  if (!isChecker && !isMaker) {
    // Distinguishes "cannot see" from "cannot do", as assertCaseAccess does.
    assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_CHECK);
  }
  if (!REVIEW_STATUSES.has(subject.status as CaseStatus)) {
    throw new BusinessRuleError(
      'NOT_UNDER_REVIEW',
      'Replies are added while the case is being checked or corrected.',
    );
  }

  await withTransaction(async (tx) => {
    const parent = await tx.comment.findUnique({
      where: { id: input.parentId },
      select: { caseId: true, parentId: true },
    });
    if (!parent || parent.caseId !== input.caseId || parent.parentId !== null) {
      throw new NotFoundError('That comment was not found on this case.');
    }

    const reply = await tx.comment.create({
      data: {
        caseId: input.caseId,
        authorId: actor.id,
        parentId: input.parentId,
        body: input.body,
      },
    });
    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'COMMENT_ADDED',
      entity: 'Comment',
      entityId: reply.id,
      after: { caseId: input.caseId, replyTo: input.parentId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

export async function setCommentResolved(
  actor: Actor,
  input: ResolveCommentInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_CHECK);
  const subject = await loadSubject(input.caseId);
  assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_CHECK);
  if (!REVIEW_STATUSES.has(subject.status as CaseStatus)) {
    throw new BusinessRuleError(
      'NOT_UNDER_REVIEW',
      'Comments are resolved while the case is being checked.',
    );
  }

  await withTransaction(async (tx) => {
    const comment = await tx.comment.findUnique({
      where: { id: input.commentId },
      select: { caseId: true, parentId: true, isResolved: true },
    });
    if (!comment || comment.caseId !== input.caseId || comment.parentId !== null) {
      throw new NotFoundError('That comment was not found on this case.');
    }
    if (comment.isResolved === input.resolved) return;

    await tx.comment.update({
      where: { id: input.commentId },
      data: { isResolved: input.resolved, resolvedAt: input.resolved ? new Date() : null },
    });
    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_UPDATED',
      entity: 'Comment',
      entityId: input.commentId,
      before: { isResolved: comment.isResolved },
      after: { isResolved: input.resolved, caseId: input.caseId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}
