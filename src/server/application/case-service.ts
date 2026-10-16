import type { Prisma } from '@prisma/client';
import { prisma, withTransaction, type TransactionClient } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import { assertPermission, canAccessCase, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import {
  decideTransition,
  availableActions,
  type CaseSnapshot,
  type GuardContext,
  type TransitionRequest,
} from '@/server/domain/workflow/workflow-service';
import type { WorkflowAction } from '@/server/domain/workflow/transitions';
import { resolveRouting } from '@/server/domain/approval/routing';
import { caseScopeFilter } from './dashboard-service';
import { verifyCurrentValuation } from './valuation-state';
import { signApprovedValuation } from './signature-service';
import { assertReadyToDeliver, generateCoverPage, issueFinalLetter } from './case-document-service';
import {
  calendarFor,
  closeSla,
  openSlaRecord,
  pauseSla,
  refreshSla,
  resumeSla,
} from './sla-service';
import { dispatchCaseEvents, eventsForTransition } from './notification-dispatch';
import { addWorkingDays } from '@/server/domain/sla/sla-engine';
import { logger } from '@/lib/logger';
import {
  getNumberConfig,
  getStringConfig,
  loadApprovalThresholds,
  loadSlaPolicy,
} from './configuration-service';
import { BusinessRuleError, NotFoundError, assertUuid } from '@/lib/errors';
import type { CaseStatus, RoleCode } from '@/server/domain/shared/enums';

/**
 * Case lifecycle: creation, listing, and the persistence half of the workflow
 * engine.
 *
 * Every transition runs inside one transaction that also writes the workflow
 * history, moves the tasks, opens or closes the correction cycle and records
 * the audit entry (rule 11). If any part fails the whole thing rolls back, so
 * the audit trail can never disagree with the case.
 */

export interface RequestContextInput {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

// ---------------------------------------------------------------------------
// Case numbers
// ---------------------------------------------------------------------------

/**
 * Allocate the next case number for the year, inside the caller's transaction.
 *
 * The sequence row is updated with an atomic increment, so two concurrent
 * submissions cannot collide or leave a gap that would look to an auditor like
 * a deleted record.
 */
async function allocateCaseNumber(tx: TransactionClient, prefix: string): Promise<string> {
  const year = new Date().getUTCFullYear();

  const sequence = await tx.caseNumberSequence.upsert({
    where: { year },
    update: { lastValue: { increment: 1 } },
    create: { year, lastValue: 1 },
  });

  return `${prefix}-${year}-${String(sequence.lastValue).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Creating a request
// ---------------------------------------------------------------------------

export interface CreateCaseInput {
  requestTypeCode: string;
  discipline: 'CIVIL' | 'MECHANICAL';
  applicantName: string;
  applicantPhone?: string | null;
  applicantTin?: string | null;
  ownerName: string;
  ownerPhone?: string | null;
  ownerIdNumber?: string | null;
  purpose?: string | null;
  remarks?: string | null;
  priorCaseNumber?: string | null;
}

export async function createCase(
  actor: Actor,
  input: CreateCaseInput,
  ctx: RequestContextInput,
): Promise<{ id: string; caseNumber: string }> {
  assertPermission(actor, PERMISSIONS.CASE_CREATE);

  if (!actor.organizationId) {
    throw new BusinessRuleError(
      'NO_ORGANISATION',
      'Your account is not attached to a branch or unit, so it cannot raise a request. Ask an administrator to set your organisation.',
    );
  }

  const requestType = await prisma.requestType.findUnique({
    where: { code: input.requestTypeCode },
  });
  if (!requestType || !requestType.isActive) {
    throw new BusinessRuleError('UNKNOWN_REQUEST_TYPE', 'That request type is not available.');
  }

  // Re-estimation, appeal and progress requests only make sense against an
  // earlier case, and the link is what makes the lineage auditable.
  let priorCaseId: string | null = null;
  if (requestType.requiresPriorCase) {
    const reference = input.priorCaseNumber?.trim();
    if (!reference) {
      throw new BusinessRuleError(
        'PRIOR_CASE_REQUIRED',
        `A ${requestType.name} request must reference the earlier case it follows.`,
      );
    }
    const prior = await prisma.valuationCase.findUnique({
      where: { caseNumber: reference },
      select: {
        id: true,
        requestingOrgId: true,
        departmentId: true,
        requestedById: true,
        makerId: true,
        checkerId: true,
      },
    });
    if (!prior || !canAccessCase(actor, prior, PERMISSIONS.CASE_READ)) {
      // Same message whether it does not exist or is out of scope, so case
      // numbers cannot be probed from this form.
      throw new BusinessRuleError(
        'PRIOR_CASE_NOT_FOUND',
        `Case ${reference} was not found among the cases you can see.`,
      );
    }
    priorCaseId = prior.id;
  }

  // Which department handles the case follows the discipline.
  const departmentCode = input.discipline === 'MECHANICAL' ? 'PVD_MECH' : 'PVD';
  const department =
    (await prisma.department.findUnique({ where: { code: departmentCode } })) ??
    (await prisma.department.findFirst({ where: { isActive: true }, orderBy: { code: 'asc' } }));

  if (!department) {
    throw new BusinessRuleError(
      'NO_DEPARTMENT',
      'No valuation department is configured to receive requests.',
    );
  }

  const prefix = await getStringConfig('case.number_prefix', 'PV');

  return withTransaction(async (tx) => {
    const caseNumber = await allocateCaseNumber(tx, prefix);

    const created = await tx.valuationCase.create({
      data: {
        caseNumber,
        requestTypeId: requestType.id,
        discipline: input.discipline,
        status: 'DRAFT',
        requestingOrgId: actor.organizationId!,
        departmentId: department.id,
        requestedById: actor.id,
        applicantName: input.applicantName,
        applicantPhone: input.applicantPhone ?? null,
        applicantTin: input.applicantTin ?? null,
        ownerName: input.ownerName,
        ownerPhone: input.ownerPhone ?? null,
        ownerIdNumber: input.ownerIdNumber ?? null,
        purpose: input.purpose ?? null,
        remarks: input.remarks ?? null,
        priorCaseId,
      },
      select: { id: true, caseNumber: true },
    });

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_CREATED',
      entity: 'ValuationCase',
      entityId: created.id,
      after: {
        caseNumber: created.caseNumber,
        requestType: requestType.code,
        discipline: input.discipline,
        applicantName: input.applicantName,
        ownerName: input.ownerName,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });

    return created;
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface CaseListFilter {
  status?: CaseStatus;
  /** Several statuses at once, for the work-queue views. */
  statuses?: readonly CaseStatus[];
  discipline?: 'CIVIL' | 'MECHANICAL';
  requestTypeCode?: string;
  search?: string;
  /** Only cases whose SLA has passed its due date and is still open. */
  overdueOnly?: boolean;
  /** Only cases assigned to this actor as maker or checker. */
  mineOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listCases(actor: Actor, filter: CaseListFilter = {}) {
  assertPermission(actor, PERMISSIONS.CASE_READ);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filter.pageSize ?? 25));

  // The scope filter is composed from the actor, so a list can never show a
  // case its viewer could not open.
  const scope = caseScopeFilter(actor);

  const search = filter.search?.trim();
  const where: Prisma.ValuationCaseWhereInput = {
    AND: [
      scope,
      filter.status ? { status: filter.status } : {},
      filter.statuses && filter.statuses.length > 0 ? { status: { in: [...filter.statuses] } } : {},
      filter.overdueOnly ? { slaRecord: { is: { status: 'BREACHED' as const } } } : {},
      filter.mineOnly ? { OR: [{ makerId: actor.id }, { checkerId: actor.id }] } : {},
      filter.discipline ? { discipline: filter.discipline } : {},
      filter.requestTypeCode ? { requestType: { code: filter.requestTypeCode } } : {},
      search
        ? {
            // Section 24: a case is found by its number, its people, or the
            // property's own identifiers - LHC number, plate, chassis, serial.
            // Each has a trigram index, so partial matches stay fast.
            OR: [
              { caseNumber: { contains: search, mode: 'insensitive' } },
              { ownerName: { contains: search, mode: 'insensitive' } },
              { applicantName: { contains: search, mode: 'insensitive' } },
              { civilProperty: { lhcNumber: { contains: search, mode: 'insensitive' } } },
              {
                mechanicalProperty: {
                  vehicles: {
                    some: {
                      OR: [
                        { plateNumber: { contains: search, mode: 'insensitive' } },
                        { chassisNumber: { contains: search, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
              {
                mechanicalProperty: {
                  machinery: { some: { serialNumber: { contains: search, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {},
    ],
  };

  const [rows, total] = await Promise.all([
    prisma.valuationCase.findMany({
      where,
      // `id` breaks ties, so a case cannot appear on two pages or on none when
      // several were created in the same instant (a bulk import, a seed).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        caseNumber: true,
        status: true,
        discipline: true,
        applicantName: true,
        ownerName: true,
        finalValue: true,
        currency: true,
        createdAt: true,
        requestedAt: true,
        requestType: { select: { code: true, name: true } },
        requestingOrg: { select: { name: true } },
        maker: { select: { fullName: true } },
        checker: { select: { fullName: true } },
        slaRecord: { select: { status: true, dueAt: true } },
      },
    }),
    prisma.valuationCase.count({ where }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export type CaseListRow = Awaited<ReturnType<typeof listCases>>['rows'][number];

/** Load one case, refusing anything outside the caller's scope with a 404. */
export async function getCase(actor: Actor, caseId: string) {
  assertPermission(actor, PERMISSIONS.CASE_READ);
  assertUuid(caseId, 'The requested case was not found.');

  const record_ = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    include: {
      requestType: true,
      requestingOrg: { select: { name: true, code: true } },
      department: { select: { name: true } },
      requestedBy: { select: { fullName: true, employeeId: true } },
      maker: { select: { id: true, fullName: true } },
      checker: { select: { id: true, fullName: true } },
      priorCase: { select: { id: true, caseNumber: true } },
      slaRecord: true,
      history: {
        orderBy: { occurredAt: 'asc' },
        include: { actor: { select: { fullName: true } } },
      },
      corrections: {
        orderBy: { sequence: 'asc' },
        include: { returnedBy: { select: { fullName: true } } },
      },
      _count: { select: { documents: true, valuations: true } },
    },
  });

  if (!record_ || !canAccessCase(actor, record_, PERMISSIONS.CASE_READ)) {
    throw new NotFoundError('The requested case was not found.');
  }

  return record_;
}

/** Which actions this actor may take on this case right now. */
export function actionsFor(actor: Actor, snapshot: CaseSnapshot): readonly WorkflowAction[] {
  return availableActions(actor, snapshot);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Gather the evidence the guards need.
 *
 * Done in one place so the domain engine stays free of queries, and so the
 * cost of a transition is one predictable set of reads rather than a guard
 * reaching for the database mid-decision.
 */
async function buildGuardContext(
  tx: TransactionClient,
  caseId: string,
  discipline: 'CIVIL' | 'MECHANICAL',
  finalValue: string | null,
  reauthenticatedWithinWindow: boolean,
): Promise<GuardContext> {
  // One after another, not in parallel: a transaction is one connection, and
  // pg does not allow overlapping queries on a connection.
  const openCorrections = await tx.correctionCycle.count({ where: { caseId, resolvedAt: null } });
  const signedReport = await tx.report.findFirst({
    where: { caseId, isImmutable: true },
    select: { id: true },
  });
  // Only the categories that actually apply to this case. A civil case must
  // not be blocked for want of a vehicle ownership certificate.
  const mandatoryCategories = await tx.documentCategory.findMany({
    where: { isMandatory: true, isActive: true, OR: [{ discipline: null }, { discipline }] },
    select: { id: true },
  });
  const documents = await tx.propertyDocument.findMany({
    where: { caseId, deletedAt: null },
    select: { categoryId: true },
  });

  const present = new Set(documents.map((d) => d.categoryId));
  const hasRequiredDocuments = mandatoryCategories.every((c) => present.has(c.id));

  // Not merely "a figure exists": the figures must match the valuator's stored
  // entry, so a tampered or out-of-date figure cannot move on.
  const calculationComplete = await verifyCurrentValuation(tx, caseId);

  // Only approvals given since the case last came back from correction count:
  // a manager's sign-off on the figures before a rework says nothing about the
  // figures after it. The approval table is append-only, so earlier rounds stay
  // on record; they just stop counting.
  const lastReturn = await tx.correctionCycle.findFirst({
    where: { caseId },
    orderBy: { returnedAt: 'desc' },
    select: { returnedAt: true },
  });
  const approvals = await tx.approval.findMany({
    where: {
      caseId,
      decision: 'APPROVED',
      ...(lastReturn ? { decidedAt: { gt: lastReturn.returnedAt } } : {}),
    },
    orderBy: { chainPosition: 'asc' },
    select: { level: true },
  });

  const approvedRoles = approvals.map((a) => ROLE_FOR_LEVEL[a.level]);

  // The approval chain is resolved from the value actually being approved, and
  // from the thresholds in force — never from a constant.
  let approvalChain: readonly RoleCode[] = [];
  if (finalValue !== null) {
    const thresholds = await loadApprovalThresholds();
    approvalChain = resolveRouting(thresholds, finalValue).approvalChain;
  }

  const minCommentLength = await getNumberConfig('comment.min_length', 10);

  const retentionDays = await getNumberConfig('archive.retention_days_before_archive', 30);
  const completedAt = await tx.valuationCase.findUnique({
    where: { id: caseId },
    select: { completedAt: true },
  });
  const retentionElapsed =
    completedAt?.completedAt !== null && completedAt?.completedAt !== undefined
      ? Date.now() - completedAt.completedAt.getTime() >= retentionDays * 86_400_000
      : false;

  return {
    hasRequiredDocuments,
    calculationComplete,
    openCorrectionCount: openCorrections,
    hasSignedReport: signedReport !== null,
    reauthenticatedWithinWindow,
    retentionElapsed,
    approvedRoles,
    approvalChain,
    minCommentLength,
  };
}

export interface PerformTransitionInput extends TransitionRequest {
  caseId: string;
  reauthenticatedWithinWindow?: boolean;
  /** For ADD_CHECKER_COMMENT: the part of the valuation the comment is about. */
  commentSection?: string | null;
}

/** The current valuation's status as the case moves through checking. */
const VALUATION_STATUS_AFTER: Partial<
  Record<string, 'SUBMITTED' | 'UNDER_CHECK' | 'CHECKED' | 'DRAFT'>
> = {
  SUBMIT_FOR_CHECKING: 'SUBMITTED',
  ASSIGN_CHECKER: 'UNDER_CHECK',
  RESUBMIT: 'UNDER_CHECK',
  COMPLETE_CHECKING: 'CHECKED',
  RETURN_FOR_CORRECTION: 'DRAFT',
  REJECT: 'DRAFT',
};

/**
 * Apply a workflow transition.
 *
 * The case row is locked `FOR UPDATE` before anything is decided, so two
 * simultaneous callers serialise rather than racing (rules 12–14).
 */
export async function performTransition(
  actor: Actor,
  input: PerformTransitionInput,
  ctx: RequestContextInput,
): Promise<{ status: CaseStatus; version: number }> {
  const done = await withTransaction(async (tx) => {
    // Pessimistic lock. Prisma has no first-class FOR UPDATE, so this is raw.
    await tx.$queryRaw`SELECT id FROM valuation_cases WHERE id = ${input.caseId}::uuid FOR UPDATE`;

    const found = await tx.valuationCase.findUnique({
      where: { id: input.caseId },
      select: {
        id: true,
        caseNumber: true,
        status: true,
        version: true,
        discipline: true,
        finalValue: true,
        requestingOrgId: true,
        departmentId: true,
        requestedById: true,
        makerId: true,
        checkerId: true,
      },
    });

    if (!found) throw new NotFoundError('The requested case was not found.');
    if (found.discipline !== 'CIVIL' && found.discipline !== 'MECHANICAL') {
      throw new BusinessRuleError('BAD_DISCIPLINE', 'This case has no valid discipline.');
    }

    const snapshot: CaseSnapshot = {
      id: found.id,
      caseNumber: found.caseNumber,
      status: found.status,
      version: found.version,
      discipline: found.discipline,
      finalValue: found.finalValue?.toString() ?? null,
      requestingOrgId: found.requestingOrgId,
      departmentId: found.departmentId,
      requestedById: found.requestedById,
      makerId: found.makerId,
      checkerId: found.checkerId,
    };

    // Assignment targets are read here so the domain engine can check
    // discipline and activity without querying.
    let assigneeDiscipline: TransitionRequest['assigneeDiscipline'];
    let assigneeIsActive: boolean | undefined;
    if (input.assigneeId) {
      const assignee = await tx.user.findUnique({
        where: { id: input.assigneeId },
        select: { discipline: true, isActive: true, departmentId: true },
      });
      if (!assignee) {
        throw new BusinessRuleError('UNKNOWN_ASSIGNEE', 'That user was not found.');
      }
      assigneeDiscipline = assignee.discipline;
      assigneeIsActive = assignee.isActive;
    }

    const context = await buildGuardContext(
      tx,
      found.id,
      snapshot.discipline,
      snapshot.finalValue,
      input.reauthenticatedWithinWindow ?? false,
    );

    const outcome = decideTransition(
      actor,
      snapshot,
      { ...input, assigneeDiscipline, assigneeIsActive },
      context,
    );

    // --- Apply -------------------------------------------------------------
    const now = new Date();
    const milestone = milestoneFor(outcome.toStatus, now);

    const updated = await tx.valuationCase.update({
      where: { id: found.id },
      data: {
        status: outcome.toStatus,
        version: { increment: 1 },
        ...milestone,
        ...(outcome.definition.action === 'ASSIGN_MAKER'
          ? { makerId: input.assigneeId, makerManagerId: actor.id, assignedAt: now }
          : {}),
        ...(outcome.definition.action === 'ASSIGN_CHECKER'
          ? { checkerId: input.assigneeId, checkerManagerId: actor.id }
          : {}),
        ...(outcome.definition.action === 'CANCEL'
          ? { cancelledAt: now, cancelReason: outcome.comment }
          : {}),
      },
      select: { status: true, version: true },
    });

    // --- Workflow history (the case timeline, section 32) ------------------
    const previous = await tx.workflowHistory.findFirst({
      where: { caseId: found.id },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    const durationSeconds = previous
      ? Math.max(0, Math.round((now.getTime() - previous.occurredAt.getTime()) / 1000))
      : null;

    await tx.workflowHistory.create({
      data: {
        caseId: found.id,
        fromStatus: outcome.fromStatus,
        toStatus: outcome.toStatus,
        action: outcome.definition.action,
        actorId: actor.id,
        actorRole: outcome.actorRole,
        comment: outcome.comment,
        durationSeconds,
        correlationId: ctx.correlationId ?? null,
      },
    });

    // --- Tasks -------------------------------------------------------------
    // A return, rejection or cancellation ends the stage the case was in, so
    // every task open on it closes - the checker's review, a pending approval.
    // Leaving them open would strand work in a queue, and the resubmission
    // that reopens the checker's task would collide with the stale one.
    if (ENDS_OPEN_TASKS.has(outcome.definition.action)) {
      await tx.workflowTask.updateMany({
        where: { caseId: found.id, completedAt: null },
        data: { completedAt: now, completedById: actor.id },
      });
    }
    if (outcome.closesTask) {
      await tx.workflowTask.updateMany({
        where: { caseId: found.id, taskType: outcome.closesTask, completedAt: null },
        data: { completedAt: now, completedById: actor.id },
      });
    }
    if (outcome.opensTask) {
      const dueAt = await computeDueDate(now);
      await tx.workflowTask.create({
        data: {
          caseId: found.id,
          taskType: outcome.opensTask,
          assigneeId: outcome.opensTaskFor,
          roleCode: outcome.opensTaskFor ? null : roleForTask(outcome.opensTask),
          dueAt,
        },
      });
    }

    // --- Review comments (section 33) --------------------------------------
    // A review comment is recorded with the transition itself. The case page
    // no longer offers it; a checker returns the case with a comment instead.
    if (outcome.definition.action === 'ADD_CHECKER_COMMENT' && outcome.comment) {
      await tx.comment.create({
        data: {
          caseId: found.id,
          authorId: actor.id,
          section: input.commentSection ?? 'GENERAL',
          body: outcome.comment,
        },
      });
    }

    // --- Correction cycle (section 33) -------------------------------------
    if (outcome.opensCorrectionCycle) {
      const last = await tx.correctionCycle.findFirst({
        where: { caseId: found.id },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      // The sections the checker still has open comments on are what the
      // maker must look at; recording them makes the return specific.
      const open = await tx.comment.findMany({
        where: { caseId: found.id, parentId: null, isResolved: false },
        select: { section: true },
      });
      const flagged = [...new Set(open.map((c) => c.section ?? 'GENERAL'))];
      await tx.correctionCycle.create({
        data: {
          caseId: found.id,
          sequence: (last?.sequence ?? 0) + 1,
          returnedById: actor.id,
          returnedByRole: outcome.actorRole,
          previousStatus: outcome.fromStatus,
          reasonCode: input.reasonCode ?? 'CORRECTION_REQUIRED',
          comment: outcome.comment ?? '',
          flaggedSections: flagged.length > 0 ? flagged : undefined,
        },
      });
    }
    if (outcome.closesCorrectionCycle) {
      const open = await tx.correctionCycle.findFirst({
        where: { caseId: found.id, resolvedAt: null },
        orderBy: { sequence: 'desc' },
      });
      if (open) {
        await tx.correctionCycle.update({
          where: { id: open.id },
          data: {
            resolvedAt: now,
            resolutionNote: outcome.comment,
            reworkSeconds: Math.max(
              0,
              Math.round((now.getTime() - open.returnedAt.getTime()) / 1000),
            ),
          },
        });
      }
    }

    // --- Approval record (sections 17-18) ----------------------------------
    // Each decision is a personal accountability record, append-only in the
    // database, carrying the value it was taken on so a later revaluation
    // cannot rewrite what was approved.
    const approvalRecord = approvalRecordFor(outcome.definition.action, outcome.fromStatus);
    if (approvalRecord) {
      const role = ROLE_FOR_LEVEL[approvalRecord.level];
      const position = context.approvalChain.indexOf(role);
      await tx.approval.create({
        data: {
          caseId: found.id,
          level: approvalRecord.level,
          chainPosition: position >= 0 ? position + 1 : context.approvalChain.length + 1,
          approverId: actor.id,
          decision: approvalRecord.decision,
          comment: outcome.comment,
          valueAtDecision: snapshot.finalValue ?? '0',
        },
      });
    }

    // An approved valuation is frozen: the database then refuses any change to
    // it, and a correction can only ever create a new version (rule 9).
    if (outcome.toStatus === 'APPROVED') {
      await tx.valuation.updateMany({
        where: { caseId: found.id, isCurrent: true, frozenAt: null },
        data: { status: 'APPROVED', frozenAt: now },
      });
      const highest = context.approvalChain.includes('DIRECTOR')
        ? 'DIRECTOR'
        : context.approvalChain.includes('MAKER_MANAGER')
          ? 'MANAGER'
          : 'CHECKER';
      await tx.valuationCase.update({
        where: { id: found.id },
        data: { approvalLevel: highest },
      });
    }

    // --- Case documents (sections 15 and 18) --------------------------------
    // Each is a frozen snapshot taken inside this transaction, so it records
    // the case exactly as it stood at the moment of the decision.
    if (outcome.definition.action === 'SUBMIT_FOR_APPROVAL') {
      await generateCoverPage(tx, {
        caseId: found.id,
        actor,
        actorRole: outcome.actorRole,
        approvalChain: context.approvalChain,
        generatedAt: now,
      });
    }
    if (outcome.definition.action === 'GENERATE_FINAL_LETTER') {
      await issueFinalLetter(tx, {
        caseId: found.id,
        actor,
        actorRole: outcome.actorRole,
        issuedAt: now,
      });
    }
    if (outcome.definition.action === 'DELIVER') {
      await assertReadyToDeliver(tx, found.id);
    }

    // --- Signature (section 19) ---------------------------------------------
    if (outcome.definition.action === 'SIGN') {
      await signApprovedValuation(tx, {
        caseId: found.id,
        signer: actor,
        signerRole: outcome.actorRole,
        signedAt: now,
      });
    }

    // --- Valuation status ---------------------------------------------------
    // The valuation follows the case through checking, and records who
    // checked it. A frozen (approved) version is never touched here.
    const valuationStatus = VALUATION_STATUS_AFTER[outcome.definition.action];
    if (valuationStatus) {
      await tx.valuation.updateMany({
        where: { caseId: found.id, isCurrent: true, frozenAt: null },
        data: {
          status: valuationStatus,
          ...(outcome.definition.action === 'COMPLETE_CHECKING'
            ? { checkedById: actor.id, checkerRemarks: outcome.comment ?? null }
            : {}),
        },
      });
    }

    // --- SLA (section 22) --------------------------------------------------
    // The clock starts at submission, pauses while the request is back with
    // the requester, and stops for good on completion or cancellation.
    if (outcome.definition.action === 'SUBMIT_REQUEST') {
      await openSlaRecord(tx, found.id, now);
    }
    if (outcome.definition.action === 'RETURN_TO_REQUESTER') {
      await pauseSla(tx, found.id, outcome.comment ?? 'Returned to the requester', now);
    }
    if (outcome.fromStatus === 'AWAITING_REQUESTER' && outcome.toStatus !== 'AWAITING_REQUESTER') {
      await resumeSla(tx, found.id, now);
    }
    if (outcome.toStatus === 'COMPLETED' || outcome.toStatus === 'CANCELLED') {
      await closeSla(tx, found.id, now);
    }

    // --- Audit -------------------------------------------------------------
    await record(tx, {
      actorId: actor.id,
      actorRole: outcome.actorRole,
      action: 'CASE_TRANSITIONED',
      entity: 'ValuationCase',
      entityId: found.id,
      before: { status: outcome.fromStatus, version: snapshot.version },
      after: {
        status: outcome.toStatus,
        version: updated.version,
        action: outcome.definition.action,
        comment: outcome.comment,
        assigneeId: input.assigneeId ?? null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });

    return {
      updated,
      action: outcome.definition.action,
      toStatus: outcome.toStatus,
      comment: outcome.comment,
    };
  });

  // --- After commit: notifications and the SLA state -------------------------
  // Outside the transaction on purpose: a mail server that is down must not
  // roll back an approval (workflow doc, section 6). Both never throw.
  await refreshSla({ caseId: input.caseId }).catch((error: unknown) =>
    logger.error({ err: error, caseId: input.caseId }, 'SLA refresh after transition failed'),
  );
  await dispatchCaseEvents(eventsForTransition(done.action, done.toStatus), input.caseId, {
    actorId: actor.id,
    action: done.action,
    comment: done.comment,
  });

  return done.updated;
}

const ENDS_OPEN_TASKS = new Set<string>(['RETURN_FOR_CORRECTION', 'REJECT', 'CANCEL']);

/** Approval levels and the chain roles they stand for. */
const ROLE_FOR_LEVEL = {
  CHECKER: 'CHECKER',
  MANAGER: 'MAKER_MANAGER',
  DIRECTOR: 'DIRECTOR',
} as const satisfies Record<'CHECKER' | 'MANAGER' | 'DIRECTOR', RoleCode>;

/** The approval decision each transition records, and at which level. */
function approvalRecordFor(
  action: string,
  fromStatus: CaseStatus,
): {
  level: 'CHECKER' | 'MANAGER' | 'DIRECTOR';
  decision: 'APPROVED' | 'REJECTED' | 'RETURNED';
} | null {
  const gateLevel =
    fromStatus === 'PENDING_MANAGER_APPROVAL'
      ? ('MANAGER' as const)
      : fromStatus === 'PENDING_DIRECTOR_APPROVAL'
        ? ('DIRECTOR' as const)
        : null;
  switch (action) {
    case 'COMPLETE_CHECKING':
      return { level: 'CHECKER', decision: 'APPROVED' };
    case 'APPROVE_MANAGER':
      return { level: 'MANAGER', decision: 'APPROVED' };
    case 'APPROVE_DIRECTOR':
      return { level: 'DIRECTOR', decision: 'APPROVED' };
    case 'REJECT':
      return gateLevel ? { level: gateLevel, decision: 'REJECTED' } : null;
    case 'RETURN_FOR_CORRECTION':
      // A return from checking is the checker's review, recorded as a
      // correction cycle; one from an approval gate is an approver's decision.
      return gateLevel ? { level: gateLevel, decision: 'RETURNED' } : null;
    default:
      return null;
  }
}

/** Milestone timestamps, so reporting never has to derive them from history. */
function milestoneFor(status: CaseStatus, now: Date): Record<string, Date> {
  switch (status) {
    case 'REQUESTED':
      return { requestedAt: now };
    case 'ON_PROGRESS':
      return { startedAt: now };
    case 'SUBMITTED_FOR_CHECKING':
      return { submittedAt: now };
    case 'CHECKED':
      return { checkedAt: now };
    case 'APPROVED':
      return { approvedAt: now };
    case 'SIGNED':
      return { signedAt: now };
    case 'COMPLETED':
      return { completedAt: now };
    case 'ARCHIVED':
      return { archivedAt: now };
    default:
      return {};
  }
}

function roleForTask(task: string): string | null {
  switch (task) {
    case 'ASSIGN_MAKER':
      return 'MAKER_MANAGER';
    case 'ASSIGN_CHECKER':
      return 'CHECKER_MANAGER';
    case 'MANAGER_APPROVAL':
      return 'MAKER_MANAGER';
    case 'DIRECTOR_APPROVAL':
      return 'DIRECTOR';
    default:
      return null;
  }
}

/** Working-day due date for a task, from the configured SLA policy and holiday calendar. */
async function computeDueDate(from: Date): Promise<Date> {
  const policy = await loadSlaPolicy().catch(() => null);
  const calendar = await calendarFor({
    workingDaysOfWeek: policy?.workingDaysOfWeek ?? [1, 2, 3, 4, 5],
    countCalendarDays: policy?.countCalendarDays ?? false,
  });
  return addWorkingDays(from, policy?.totalWorkingDays ?? 5, calendar);
}

// ---------------------------------------------------------------------------
// Work queue
// ---------------------------------------------------------------------------

/**
 * Tasks assigned to this actor, plus the role queues they can pick up from, a
 * page at a time and soonest due first. The two counts cover every open task,
 * not just the page shown.
 */
export async function listMyTasks(
  actor: Actor,
  {
    page: requestedPage = 1,
    pageSize: requestedSize = 25,
  }: { page?: number; pageSize?: number } = {},
) {
  assertPermission(actor, PERMISSIONS.CASE_READ);

  const page = Math.max(1, requestedPage);
  const pageSize = Math.min(100, Math.max(10, requestedSize));
  const scope = caseScopeFilter(actor);

  const assignedWhere: Prisma.WorkflowTaskWhereInput = { completedAt: null, assigneeId: actor.id };
  const queuedWhere: Prisma.WorkflowTaskWhereInput = {
    completedAt: null,
    assigneeId: null,
    roleCode: { in: [...actor.roles] },
    case: scope,
  };

  const [rows, assigned, queued] = await Promise.all([
    listTaskPage({ OR: [assignedWhere, queuedWhere] }, page, pageSize),
    prisma.workflowTask.count({ where: assignedWhere }),
    prisma.workflowTask.count({ where: queuedWhere }),
  ]);
  const total = assigned + queued;

  return {
    rows,
    total,
    assigned,
    queued,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function listTaskPage(where: Prisma.WorkflowTaskWhereInput, page: number, pageSize: number) {
  return prisma.workflowTask.findMany({
    where,
    // `id` breaks ties, so a task cannot appear on two pages or on none when
    // several share a due date.
    orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          status: true,
          discipline: true,
          ownerName: true,
          applicantName: true,
          requestType: { select: { name: true } },
          slaRecord: { select: { status: true, dueAt: true } },
        },
      },
    },
  });
}

export type TaskRow = Awaited<ReturnType<typeof listMyTasks>>['rows'][number];

/** Counters for the navigation rail badges. */
export async function loadNavBadges(actor: Actor): Promise<Record<string, number>> {
  const scope = caseScopeFilter(actor);

  const [openTasks, pendingApprovals, returned, overdue, unread] = await Promise.all([
    prisma.workflowTask.count({
      where: {
        completedAt: null,
        OR: [
          { assigneeId: actor.id },
          { assigneeId: null, roleCode: { in: [...actor.roles] }, case: scope },
        ],
      },
    }),
    prisma.valuationCase.count({
      where: {
        AND: [scope, { status: { in: ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL'] } }],
      },
    }),
    prisma.valuationCase.count({
      where: { AND: [scope, { status: 'RETURNED_FOR_CORRECTION' }] },
    }),
    // The stored SLA state, as the dashboard and the SLA register read it.
    prisma.slaRecord.count({ where: { case: scope, status: 'BREACHED' } }),
    prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),
  ]);

  return { openTasks, pendingApprovals, returned, overdue, unread };
}

// ---------------------------------------------------------------------------
// Supporting reads for the intake and assignment screens
// ---------------------------------------------------------------------------

/** Request types an administrator has enabled (spec section 37). */
export async function listActiveRequestTypes() {
  return prisma.requestType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { code: true, name: true, description: true, requiresPriorCase: true },
  });
}

/**
 * Valuators eligible to receive this case.
 *
 * Filtered by department, discipline and role — and, when choosing a checker,
 * the maker is excluded up front rather than offered and then refused. The
 * acting user is excluded too: assignment and valuation are separate duties.
 */
export async function listAssignableValuators(
  actor: Actor,
  options: {
    departmentId: string;
    discipline: 'CIVIL' | 'MECHANICAL';
    forRole: 'MAKER' | 'CHECKER';
    excludeUserId?: string | null;
  },
) {
  assertPermission(
    actor,
    options.forRole === 'CHECKER' ? PERMISSIONS.CASE_ASSIGN_CHECKER : PERMISSIONS.CASE_ASSIGN_MAKER,
  );

  const people = await prisma.user.findMany({
    where: {
      isActive: true,
      departmentId: options.departmentId,
      discipline: { in: [options.discipline, 'BOTH'] },
      ...(options.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
      roles: { some: { role: { code: options.forRole } } },
    },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true, discipline: true },
  });

  return people.filter((person) => person.id !== actor.id);
}
