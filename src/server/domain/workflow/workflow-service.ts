import { BusinessRuleError, ForbiddenError, WorkflowError } from '@/lib/errors';
import type { CaseStatus, RoleCode, TaskType } from '../shared/enums';
import type { Actor, CaseAccessSubject } from '../rbac/authorize';
import { canAccessCase, matchesDiscipline } from '../rbac/authorize';
import { PERMISSIONS } from '../rbac/permissions';
import {
  assertTransitionAllowed,
  transitionsFrom,
  type TransitionDefinition,
  type TransitionGuard,
  type WorkflowAction,
} from './transitions';

/**
 * The single authority on case movement (spec section 36).
 *
 * This is the *decision* half of the workflow engine and it is deliberately
 * pure: it reads a case snapshot plus the facts a caller supplies and returns
 * what should happen, without touching a database, a clock or a request. That
 * is what makes every branch of it testable in milliseconds, including the
 * combinations a manual test plan would never reach.
 *
 * The *persistence* half lives in `src/server/application/case-service.ts`,
 * which wraps the decision in a transaction together with the workflow history,
 * the SLA update and the audit record (rule 11).
 *
 * No component, route handler or query may set a status directly (section 20).
 */

/** Everything the engine needs to know about a case to decide a transition. */
export interface CaseSnapshot extends CaseAccessSubject {
  readonly caseNumber: string;
  readonly status: CaseStatus;
  readonly version: number;
  readonly discipline: 'CIVIL' | 'MECHANICAL';
  readonly finalValue: string | null;
}

/** Facts the caller supplies with a transition request. */
export interface TransitionRequest {
  readonly action: WorkflowAction;
  /** Optimistic-lock token the client last saw (rule 14). */
  readonly expectedVersion: number;
  readonly comment?: string | null;
  readonly reasonCode?: string | null;
  /** Target user for an assignment. */
  readonly assigneeId?: string | null;
  readonly assigneeDiscipline?: 'CIVIL' | 'MECHANICAL' | 'BOTH' | 'NONE';
  readonly assigneeIsActive?: boolean;
}

/**
 * Evidence about the case that guards are evaluated against.
 *
 * Gathered by the application layer and passed in, so the engine never has to
 * query for it — and so a test can construct any situation directly.
 */
export interface GuardContext {
  readonly hasRequiredDocuments: boolean;
  readonly calculationComplete: boolean;
  readonly openCorrectionCount: number;
  readonly unresolvedCommentCount: number;
  readonly hasSignedReport: boolean;
  readonly reauthenticatedWithinWindow: boolean;
  readonly retentionElapsed: boolean;
  /** Roles that have already approved, in order. */
  readonly approvedRoles: readonly RoleCode[];
  /** The approval chain resolved from configuration for this case's value. */
  readonly approvalChain: readonly RoleCode[];
  /** Minimum length a mandatory comment must reach, from configuration. */
  readonly minCommentLength: number;
  /**
   * The site-visit rule is satisfied: it is switched off, or a visit was
   * checked in at the property, or an unverified visit explains why.
   */
  readonly siteVisitEvidence: boolean;
}

export interface TransitionOutcome {
  readonly definition: TransitionDefinition;
  readonly fromStatus: CaseStatus;
  readonly toStatus: CaseStatus;
  readonly actorRole: RoleCode;
  readonly closesTask: TaskType | undefined;
  readonly opensTask: TaskType | undefined;
  /** Who the newly opened task belongs to, when the transition names one. */
  readonly opensTaskFor: string | null;
  /** True when this transition opens a correction cycle (spec section 33). */
  readonly opensCorrectionCycle: boolean;
  /** True when this transition closes the open correction cycle. */
  readonly closesCorrectionCycle: boolean;
  readonly comment: string | null;
}

/**
 * Decide a transition, or throw explaining why it is not permitted.
 *
 * The order of checks is deliberate: version, then status, then role, then
 * scope, then guards. A stale client is told to refresh before being told its
 * user is not permitted, which is the more useful message when both are true.
 */
export function decideTransition(
  actor: Actor,
  snapshot: CaseSnapshot,
  request: TransitionRequest,
  context: GuardContext,
): TransitionOutcome {
  // 1. Optimistic lock. Two managers assigning the same case cannot both win.
  if (request.expectedVersion !== snapshot.version) {
    throw new WorkflowError(
      `This case has changed since you opened it (you have version ${request.expectedVersion}, ` +
        `it is now version ${snapshot.version}). Refresh to see the current state before acting.`,
    );
  }

  // 2. Status precondition.
  const definition = assertTransitionAllowed(request.action, snapshot.status);

  // 3. Role. An actor may hold several roles; any one that the transition names
  //    is enough, and the one used is recorded on the history entry.
  const actorRole = resolveActingRole(actor, definition);

  // 4. Scope — the check that closes IDOR.
  if (!canAccessCase(actor, snapshot, definition.permission)) {
    throw new ForbiddenError(`You are not permitted to ${humanise(request.action)} this case.`);
  }

  // 5. Guards.
  for (const guard of definition.guards) {
    assertGuard(guard, actor, snapshot, request, context);
  }

  const toStatus = resolveTargetStatus(definition, snapshot, context);

  return {
    definition,
    fromStatus: snapshot.status,
    toStatus,
    actorRole,
    closesTask: definition.closesTask,
    opensTask: definition.opensTask,
    opensTaskFor: resolveTaskOwner(definition, snapshot, request),
    opensCorrectionCycle: request.action === 'RETURN_FOR_CORRECTION' || request.action === 'REJECT',
    closesCorrectionCycle: request.action === 'RESUBMIT',
    comment: request.comment?.trim() || null,
  };
}

function humanise(action: WorkflowAction): string {
  return action.toLowerCase().replace(/_/g, ' ');
}

/**
 * The role the actor is acting in, for the audit and history record.
 *
 * An administrator may act in any workflow role, and the record says so: their
 * action is attributed to ADMIN rather than to the role they stood in for, so a
 * reader of the timeline can tell an override from ordinary work. That
 * distinction is the whole reason the override is acceptable.
 */
function resolveActingRole(actor: Actor, definition: TransitionDefinition): RoleCode {
  if (definition.roles.length === 0) {
    return actor.roles[0] ?? ('UNKNOWN' as RoleCode);
  }

  const match = definition.roles.find((role) => actor.roles.includes(role));
  if (match) return match;

  if (actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER)) {
    return 'ADMIN';
  }

  throw new ForbiddenError(`This action is reserved for: ${definition.roles.join(', ')}.`);
}

/**
 * Where the case lands.
 *
 * Most transitions declare a fixed target. Approval is the exception: the
 * target depends on how much of the configured chain remains, which is why the
 * table records `to: null` plus `dynamicTargets` for those.
 */
function resolveTargetStatus(
  definition: TransitionDefinition,
  snapshot: CaseSnapshot,
  context: GuardContext,
): CaseStatus {
  if (definition.action === 'SUBMIT_FOR_APPROVAL') {
    return nextGate(context.approvalChain, context.approvedRoles);
  }
  if (definition.action === 'APPROVE_MANAGER') {
    return nextGate(context.approvalChain, [...context.approvedRoles, 'MAKER_MANAGER']);
  }
  if (definition.to === null) {
    throw new WorkflowError(
      `Transition "${definition.action}" has no target status and no rule to compute one.`,
    );
  }
  return definition.to;
}

/**
 * The approval gates still ahead of a case.
 *
 * Every band's chain begins with CHECKER, but the checker's place in it is the
 * CHECKING -> CHECKED step itself: by the time any approval transition runs,
 * checking has completed in this round. Treating CHECKER as a gate still to be
 * passed made every case fail on the way into approval.
 */
export function remainingGates(
  chain: readonly RoleCode[],
  approved: readonly RoleCode[],
): RoleCode[] {
  return chain.filter((role) => role !== 'CHECKER' && !approved.includes(role));
}

/** The status implied by the next unapproved role in the chain. */
function nextGate(chain: readonly RoleCode[], approved: readonly RoleCode[]): CaseStatus {
  const remaining = remainingGates(chain, approved);
  const next = remaining[0];
  if (next === undefined) return 'APPROVED';
  if (next === 'MAKER_MANAGER') return 'PENDING_MANAGER_APPROVAL';
  if (next === 'DIRECTOR') return 'PENDING_DIRECTOR_APPROVAL';
  throw new WorkflowError(`Role "${next}" appears in an approval chain but cannot approve.`);
}

/** Who the task opened by this transition belongs to, where that is knowable. */
function resolveTaskOwner(
  definition: TransitionDefinition,
  snapshot: CaseSnapshot,
  request: TransitionRequest,
): string | null {
  switch (definition.opensTask) {
    case 'PERFORM_VALUATION':
      return request.assigneeId ?? null;
    case 'PERFORM_CHECKING':
      // An assignment names the checker; a resubmission goes back to the
      // checker already on the case (workflow doc: "same checker"), rather
      // than into the pool for anyone to pick up.
      return request.assigneeId ?? snapshot.checkerId;
    case 'CORRECT_VALUATION':
    case 'GENERATE_COVER_PAGE':
      // Both return the case to the Maker who worked it.
      return snapshot.makerId;
    default:
      // Assignment and approval tasks belong to a role rather than a person:
      // whichever manager or director picks them up first.
      return null;
  }
}

function assertGuard(
  guard: TransitionGuard,
  actor: Actor,
  snapshot: CaseSnapshot,
  request: TransitionRequest,
  context: GuardContext,
): void {
  switch (guard) {
    case 'COMMENT_REQUIRED': {
      const comment = request.comment?.trim() ?? '';
      if (comment.length < context.minCommentLength) {
        // A return without an actionable comment wastes the Maker's next cycle,
        // which is exactly what section 33 exists to prevent.
        throw new BusinessRuleError(
          'COMMENT_REQUIRED',
          `A comment of at least ${context.minCommentLength} characters is required, ` +
            `so the recipient knows what to correct.`,
        );
      }
      return;
    }

    case 'REMARK_REQUIRED': {
      const remark = request.comment?.trim() ?? '';
      if (remark.length < context.minCommentLength) {
        throw new BusinessRuleError(
          'REMARK_REQUIRED',
          `A remark of at least ${context.minCommentLength} characters is required to explain this status.`,
        );
      }
      return;
    }

    case 'REASON_REQUIRED': {
      const reason = (request.reasonCode ?? request.comment ?? '').trim();
      if (reason.length === 0) {
        throw new BusinessRuleError('REASON_REQUIRED', 'A reason is required for this action.');
      }
      return;
    }

    case 'REQUIRED_DOCUMENTS_PRESENT':
      if (!context.hasRequiredDocuments) {
        throw new BusinessRuleError(
          'DOCUMENTS_MISSING',
          'Every mandatory supporting document must be attached before this case can move on.',
        );
      }
      return;

    case 'CALCULATION_COMPLETE':
      if (!context.calculationComplete) {
        throw new BusinessRuleError(
          'CALCULATION_INCOMPLETE',
          'The valuation calculation is not complete, so the case cannot be submitted.',
        );
      }
      return;

    case 'NO_OPEN_CORRECTION':
      if (context.openCorrectionCount > 0) {
        throw new BusinessRuleError(
          'OPEN_CORRECTION',
          'An open correction must be resolved and resubmitted rather than submitted afresh.',
        );
      }
      return;

    case 'ALL_COMMENTS_RESOLVED':
      if (context.unresolvedCommentCount > 0) {
        throw new BusinessRuleError(
          'UNRESOLVED_COMMENTS',
          `${context.unresolvedCommentCount} comment(s) are still unresolved. ` +
            'Resolve or withdraw them before completing the check.',
        );
      }
      return;

    case 'CHECKER_DIFFERENT_FROM_MAKER':
      if (request.assigneeId && request.assigneeId === snapshot.makerId) {
        // Segregation of duties, enforced here, at assignment, and by a
        // database check constraint.
        throw new BusinessRuleError(
          'SEGREGATION_OF_DUTIES',
          'The checker must be a different person from the maker.',
        );
      }
      return;

    case 'DISCIPLINE_MATCHES': {
      if (!request.assigneeId) {
        throw new BusinessRuleError(
          'ASSIGNEE_REQUIRED',
          'Choose a valuator to assign this case to.',
        );
      }
      if (request.assigneeIsActive === false) {
        throw new BusinessRuleError(
          'ASSIGNEE_INACTIVE',
          'That account is deactivated and cannot be assigned work.',
        );
      }
      if (request.assigneeId === actor.id) {
        throw new BusinessRuleError(
          'SELF_ASSIGNMENT',
          'You cannot assign a case to yourself; assignment and valuation are separate duties.',
        );
      }
      const discipline = request.assigneeDiscipline ?? 'NONE';
      if (discipline !== 'BOTH' && discipline !== snapshot.discipline) {
        throw new BusinessRuleError(
          'DISCIPLINE_MISMATCH',
          `This is a ${snapshot.discipline.toLowerCase()} case and that valuator is registered for ${discipline.toLowerCase()} work.`,
        );
      }
      return;
    }

    case 'APPROVAL_LEVEL_REACHED': {
      const remaining = remainingGates(context.approvalChain, context.approvedRoles);
      const next = remaining[0];
      if (next === undefined) {
        throw new BusinessRuleError(
          'APPROVAL_COMPLETE',
          'This case has already received every approval its value requires.',
        );
      }
      const isAdministrator = actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER);
      if (!actor.roles.includes(next) && !isAdministrator) {
        // Approving out of turn would let a Director's sign-off substitute for
        // the Manager review the policy requires. The chain order still holds
        // for an administrator - they may stand in for the *next* approver, not
        // skip one.
        throw new BusinessRuleError(
          'APPROVAL_OUT_OF_ORDER',
          `This case awaits approval by ${next}.`,
        );
      }
      return;
    }

    case 'RECENT_REAUTHENTICATION':
      if (!context.reauthenticatedWithinWindow) {
        throw new BusinessRuleError(
          'REAUTHENTICATION_REQUIRED',
          'Confirm your password before signing. Signing must prove the person at the keyboard is the signer.',
        );
      }
      return;

    case 'SIGNED_REPORT_EXISTS':
      if (!context.hasSignedReport) {
        throw new BusinessRuleError(
          'NO_SIGNED_REPORT',
          'A signed valuation report must exist before the final letter can be issued.',
        );
      }
      return;

    case 'RETENTION_ELAPSED':
      if (!context.retentionElapsed) {
        throw new BusinessRuleError(
          'RETENTION_NOT_ELAPSED',
          'This case has not yet been complete for long enough to be archived.',
        );
      }
      return;

    case 'NOT_APPROVED_YET':
      if (
        (['APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED'] as CaseStatus[]).includes(snapshot.status)
      ) {
        throw new BusinessRuleError(
          'ALREADY_APPROVED',
          'An approved valuation is superseded by a new version, never cancelled.',
        );
      }
      return;

    case 'SITE_VISIT_EVIDENCE':
      if (!context.siteVisitEvidence) {
        throw new BusinessRuleError(
          'SITE_VISIT_UNVERIFIED',
          'Record a site visit checked in at the property, or explain in a visit’s remarks ' +
            `(at least ${context.minCommentLength} characters) why it could not be verified.`,
        );
      }
      return;
  }
}

/**
 * Which actions this actor could take on this case right now.
 *
 * Drives the UI without duplicating any rule in it: the buttons a user sees are
 * computed from the same table the server enforces, so the interface can never
 * offer an action that would be refused.
 */
export function availableActions(actor: Actor, snapshot: CaseSnapshot): readonly WorkflowAction[] {
  const permitted: WorkflowAction[] = [];

  // An administrator may act in any role, so the same override that
  // `resolveActingRole` applies when enforcing a transition must apply when
  // deciding what to offer. Otherwise the interface hides actions the server
  // would accept - a page you can use but cannot find.
  const isAdministrator = actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER);

  for (const definition of transitionsFrom(snapshot.status)) {
    const roleOk =
      isAdministrator ||
      definition.roles.length === 0 ||
      definition.roles.some((r) => actor.roles.includes(r));
    if (!roleOk) continue;
    if (!canAccessCase(actor, snapshot, definition.permission)) continue;
    permitted.push(definition.action);
  }

  return permitted;
}

export { matchesDiscipline };
