import { WorkflowError } from '@/lib/errors';
import type { CaseStatus, RoleCode, TaskType } from '../shared/enums';
import { PERMISSIONS, type PermissionCode } from '../rbac/permissions';
import type { ScopePredicate } from '../rbac/authorize';

/**
 * The workflow state machine (docs/03-workflow-state-machine.md).
 *
 * Transitions are declared as data rather than expressed as branching logic
 * scattered through route handlers and components (spec section 36). Adding a
 * stage later is a new row plus a guard, not a hunt through the UI - and the
 * table can be tested exhaustively, which a pile of `if` statements cannot.
 */

export type WorkflowAction =
  | 'SUBMIT_REQUEST'
  | 'ASSIGN_MAKER'
  | 'START_VALUATION'
  | 'MARK_NOT_VISITED'
  | 'MARK_PENDING'
  | 'RESUME_VALUATION'
  | 'SUBMIT_FOR_CHECKING'
  | 'ASSIGN_CHECKER'
  | 'ADD_CHECKER_COMMENT'
  | 'COMPLETE_CHECKING'
  | 'SUBMIT_FOR_APPROVAL'
  | 'RETURN_FOR_CORRECTION'
  | 'RESUBMIT'
  | 'APPROVE_MANAGER'
  | 'APPROVE_DIRECTOR'
  | 'REJECT'
  | 'SIGN'
  | 'GENERATE_FINAL_LETTER'
  | 'DELIVER'
  | 'ARCHIVE'
  | 'CANCEL'
  | 'RETURN_TO_REQUESTER';

/** Extra conditions a transition requires beyond status, role and permission. */
export type TransitionGuard =
  | 'COMMENT_REQUIRED'
  | 'REMARK_REQUIRED'
  | 'REASON_REQUIRED'
  | 'CALCULATION_COMPLETE'
  | 'REQUIRED_DOCUMENTS_PRESENT'
  | 'NO_OPEN_CORRECTION'
  | 'CHECKER_DIFFERENT_FROM_MAKER'
  | 'DISCIPLINE_MATCHES'
  | 'APPROVAL_LEVEL_REACHED'
  | 'RECENT_REAUTHENTICATION'
  | 'SIGNED_REPORT_EXISTS'
  | 'RETENTION_ELAPSED'
  | 'NOT_APPROVED_YET';

export interface TransitionDefinition {
  readonly action: WorkflowAction;
  /** Statuses this action may be invoked from. */
  readonly from: readonly CaseStatus[];
  /**
   * Resulting status. `null` means the transition computes its target at
   * runtime (approval routing decides between the manager and director gates).
   */
  readonly to: CaseStatus | null;
  /**
   * Statuses this transition can lead to once approval routing has run.
   *
   * Declared rather than left implicit so the table remains a complete
   * description of the state machine: without it, `PENDING_MANAGER_APPROVAL`
   * and `PENDING_DIRECTOR_APPROVAL` would look unreachable to anyone - or any
   * test - reading the transitions.
   */
  readonly dynamicTargets?: readonly CaseStatus[];
  readonly permission: PermissionCode;
  /** Roles that may invoke it. Empty means "any role holding the permission". */
  readonly roles: readonly RoleCode[];
  readonly scope: readonly ScopePredicate[];
  readonly guards: readonly TransitionGuard[];
  /** Task closed by this action, if any. */
  readonly closesTask?: TaskType;
  /** Task opened by this action, if any. */
  readonly opensTask?: TaskType;
  readonly description: string;
}

export const TRANSITIONS: readonly TransitionDefinition[] = [
  {
    action: 'SUBMIT_REQUEST',
    from: ['DRAFT'],
    to: 'REQUESTED',
    permission: PERMISSIONS.CASE_CREATE,
    roles: ['PROCESS_OWNER'],
    scope: ['SELF_REQUESTER', 'OWN_ORG'],
    guards: ['REQUIRED_DOCUMENTS_PRESENT'],
    opensTask: 'ASSIGN_MAKER',
    description: 'Process Owner submits the valuation request to the department.',
  },
  {
    action: 'RETURN_TO_REQUESTER',
    from: ['REQUESTED'],
    to: 'AWAITING_REQUESTER',
    permission: PERMISSIONS.CASE_RETURN_TO_REQUESTER,
    roles: ['MAKER_MANAGER'],
    scope: ['DEPT'],
    guards: ['REASON_REQUIRED'],
    description: 'Manager returns an incomplete request; the SLA clock pauses.',
  },
  {
    action: 'ASSIGN_MAKER',
    from: ['REQUESTED', 'AWAITING_REQUESTER'],
    to: 'ASSIGNED',
    permission: PERMISSIONS.CASE_ASSIGN_MAKER,
    roles: ['MAKER_MANAGER'],
    scope: ['DEPT'],
    guards: ['DISCIPLINE_MATCHES'],
    closesTask: 'ASSIGN_MAKER',
    opensTask: 'PERFORM_VALUATION',
    description: 'Maker Manager assigns the case to a Valuator.',
  },
  {
    action: 'START_VALUATION',
    from: ['ASSIGNED'],
    to: 'ON_PROGRESS',
    permission: PERMISSIONS.VALUATION_START,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: [],
    description: 'Assigned Maker accepts and starts the valuation.',
  },
  {
    action: 'MARK_NOT_VISITED',
    from: ['ASSIGNED', 'ON_PROGRESS'],
    to: 'NOT_VISITED',
    permission: PERMISSIONS.VALUATION_MARK_STATUS,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: ['REMARK_REQUIRED'],
    description: 'Site could not be visited. A remark is mandatory (spec section 16).',
  },
  {
    action: 'MARK_PENDING',
    from: ['ASSIGNED', 'ON_PROGRESS'],
    to: 'PENDING',
    permission: PERMISSIONS.VALUATION_MARK_STATUS,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: ['REMARK_REQUIRED'],
    description: 'Valuation blocked pending external input. A remark is mandatory.',
  },
  {
    action: 'RESUME_VALUATION',
    from: ['NOT_VISITED', 'PENDING'],
    to: 'ON_PROGRESS',
    permission: PERMISSIONS.VALUATION_EDIT,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: [],
    description: 'Maker resumes a blocked valuation.',
  },
  {
    action: 'SUBMIT_FOR_CHECKING',
    from: ['ON_PROGRESS'],
    to: 'SUBMITTED_FOR_CHECKING',
    permission: PERMISSIONS.VALUATION_SUBMIT,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: ['CALCULATION_COMPLETE', 'REQUIRED_DOCUMENTS_PRESENT', 'NO_OPEN_CORRECTION'],
    closesTask: 'PERFORM_VALUATION',
    opensTask: 'ASSIGN_CHECKER',
    description: 'Maker submits the completed valuation for checking.',
  },
  {
    action: 'ASSIGN_CHECKER',
    from: ['SUBMITTED_FOR_CHECKING'],
    to: 'CHECKING',
    permission: PERMISSIONS.CASE_ASSIGN_CHECKER,
    roles: ['CHECKER_MANAGER'],
    scope: ['DEPT'],
    guards: ['CHECKER_DIFFERENT_FROM_MAKER', 'DISCIPLINE_MATCHES'],
    closesTask: 'ASSIGN_CHECKER',
    opensTask: 'PERFORM_CHECKING',
    description: 'Checker Manager assigns the case to a Checker.',
  },
  {
    action: 'ADD_CHECKER_COMMENT',
    from: ['CHECKING'],
    to: 'COMMENTED',
    permission: PERMISSIONS.VALUATION_CHECK,
    roles: ['CHECKER'],
    scope: ['SELF_CHECKER'],
    guards: ['COMMENT_REQUIRED'],
    description: 'Checker raises comments without yet returning the case.',
  },
  {
    action: 'COMPLETE_CHECKING',
    from: ['CHECKING', 'COMMENTED'],
    to: 'CHECKED',
    permission: PERMISSIONS.VALUATION_CHECK,
    roles: ['CHECKER'],
    scope: ['SELF_CHECKER'],
    guards: ['CALCULATION_COMPLETE'],
    closesTask: 'PERFORM_CHECKING',
    opensTask: 'GENERATE_COVER_PAGE',
    description:
      'Checker completes the review. The Scope of Work returns the case to the Maker at this point, who prepares the cover page before final approval.',
  },
  {
    action: 'SUBMIT_FOR_APPROVAL',
    from: ['CHECKED'],
    to: null,
    dynamicTargets: ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL', 'APPROVED'],
    // The Maker's own submission, so it rides on the Maker's submit right.
    // `coverpage:generate` is held by managers and directors (RBAC matrix), so
    // requiring it here left no role able to take this step at all.
    permission: PERMISSIONS.VALUATION_SUBMIT,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    guards: [],
    closesTask: 'GENERATE_COVER_PAGE',
    description:
      'Maker generates the cover page from case data and submits for final approval; routing then follows the configured threshold.',
  },
  {
    action: 'RETURN_FOR_CORRECTION',
    from: ['CHECKING', 'COMMENTED', 'PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL'],
    to: 'RETURNED_FOR_CORRECTION',
    permission: PERMISSIONS.VALUATION_RETURN,
    // The Scope of Work gives return rights to the Checker, the Checker
    // Manager, the Maker Manager and the Director.
    roles: ['CHECKER', 'CHECKER_MANAGER', 'MAKER_MANAGER', 'DIRECTOR'],
    scope: ['SELF_CHECKER', 'DEPT'],
    guards: ['COMMENT_REQUIRED'],
    opensTask: 'CORRECT_VALUATION',
    description: 'Case returned to the Maker with a mandatory comment (spec section 33).',
  },
  {
    action: 'RESUBMIT',
    from: ['RETURNED_FOR_CORRECTION'],
    to: 'CHECKING',
    permission: PERMISSIONS.VALUATION_SUBMIT,
    roles: ['MAKER'],
    scope: ['SELF_MAKER'],
    // The comment is the correction cycle's resolution note (section 33): a
    // resubmission has to say what was changed, or the checker re-reviews blind.
    guards: ['CALCULATION_COMPLETE', 'REQUIRED_DOCUMENTS_PRESENT', 'COMMENT_REQUIRED'],
    closesTask: 'CORRECT_VALUATION',
    opensTask: 'PERFORM_CHECKING',
    description:
      'Maker corrects and resubmits with a note of what changed; the correction cycle closes.',
  },
  {
    action: 'APPROVE_MANAGER',
    from: ['PENDING_MANAGER_APPROVAL'],
    to: null,
    dynamicTargets: ['PENDING_DIRECTOR_APPROVAL', 'APPROVED'],
    permission: PERMISSIONS.APPROVAL_MANAGER,
    roles: ['MAKER_MANAGER'],
    scope: ['DEPT', 'NOT_PARTICIPANT'],
    guards: ['APPROVAL_LEVEL_REACHED'],
    closesTask: 'MANAGER_APPROVAL',
    description: 'Manager approves. Target is APPROVED or PENDING_DIRECTOR_APPROVAL by band.',
  },
  {
    action: 'APPROVE_DIRECTOR',
    from: ['PENDING_DIRECTOR_APPROVAL'],
    to: 'APPROVED',
    permission: PERMISSIONS.APPROVAL_DIRECTOR,
    roles: ['DIRECTOR'],
    scope: ['DEPT', 'NOT_PARTICIPANT'],
    guards: ['APPROVAL_LEVEL_REACHED'],
    closesTask: 'DIRECTOR_APPROVAL',
    opensTask: 'SIGN',
    description: 'Director approves a case at or above the director threshold.',
  },
  {
    action: 'REJECT',
    from: ['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL'],
    to: 'RETURNED_FOR_CORRECTION',
    permission: PERMISSIONS.APPROVAL_MANAGER,
    roles: ['MAKER_MANAGER', 'DIRECTOR'],
    scope: ['DEPT', 'NOT_PARTICIPANT'],
    guards: ['COMMENT_REQUIRED'],
    opensTask: 'CORRECT_VALUATION',
    description: 'Approver rejects the valuation, returning it for correction.',
  },
  {
    action: 'SIGN',
    from: ['APPROVED'],
    to: 'SIGNED',
    permission: PERMISSIONS.SIGNATURE_SIGN,
    roles: ['MAKER_MANAGER', 'DIRECTOR'],
    scope: ['DEPT', 'NOT_PARTICIPANT'],
    guards: ['RECENT_REAUTHENTICATION'],
    closesTask: 'SIGN',
    opensTask: 'GENERATE_FINAL_LETTER',
    description: 'Signing authority digitally signs; the report becomes immutable.',
  },
  {
    action: 'GENERATE_FINAL_LETTER',
    from: ['SIGNED'],
    to: 'SIGNED',
    permission: PERMISSIONS.LETTER_GENERATE,
    roles: ['MAKER_MANAGER', 'DIRECTOR'],
    scope: ['DEPT'],
    guards: ['SIGNED_REPORT_EXISTS'],
    closesTask: 'GENERATE_FINAL_LETTER',
    description: 'Final letter issued by the authority resolved from thresholds (section 18).',
  },
  {
    action: 'DELIVER',
    from: ['SIGNED'],
    to: 'COMPLETED',
    permission: PERMISSIONS.LETTER_GENERATE,
    roles: ['MAKER_MANAGER', 'DIRECTOR'],
    scope: ['DEPT'],
    guards: ['SIGNED_REPORT_EXISTS'],
    description: 'Completed report delivered to the requesting organisation.',
  },
  {
    action: 'ARCHIVE',
    from: ['COMPLETED'],
    to: 'ARCHIVED',
    permission: PERMISSIONS.CASE_ARCHIVE,
    roles: ['MAKER_MANAGER', 'ADMIN'],
    scope: ['DEPT', 'ANY'],
    guards: ['RETENTION_ELAPSED'],
    description: 'Case archived; remains searchable and read-only.',
  },
  {
    action: 'CANCEL',
    from: [
      'DRAFT',
      'REQUESTED',
      'AWAITING_REQUESTER',
      'ASSIGNED',
      'ON_PROGRESS',
      'NOT_VISITED',
      'PENDING',
      'SUBMITTED_FOR_CHECKING',
      'CHECKING',
      'COMMENTED',
      'RETURNED_FOR_CORRECTION',
      'CHECKED',
    ],
    to: 'CANCELLED',
    permission: PERMISSIONS.CASE_CANCEL,
    roles: ['PROCESS_OWNER', 'ADMIN'],
    scope: ['SELF_REQUESTER', 'OWN_ORG', 'ANY'],
    guards: ['REASON_REQUIRED', 'NOT_APPROVED_YET'],
    description:
      'Request withdrawn before approval. An approved valuation is superseded by a new version, never cancelled.',
  },
];

const BY_ACTION = new Map<WorkflowAction, TransitionDefinition>(
  TRANSITIONS.map((t) => [t.action, t]),
);

export function getTransition(action: WorkflowAction): TransitionDefinition {
  const definition = BY_ACTION.get(action);
  if (!definition) {
    throw new WorkflowError(`Unknown workflow action "${action}".`);
  }
  return definition;
}

/** Is this action legal from this status, ignoring role and guards? */
export function isTransitionAllowedFrom(action: WorkflowAction, status: CaseStatus): boolean {
  return getTransition(action).from.includes(status);
}

/** Every action declared as legal from a given status. */
export function transitionsFrom(status: CaseStatus): readonly TransitionDefinition[] {
  return TRANSITIONS.filter((t) => t.from.includes(status));
}

/**
 * Assert the status precondition, producing a message that names both the
 * current status and the statuses that would have permitted the action - the
 * information a user needs to understand why the button did nothing.
 */
export function assertTransitionAllowed(
  action: WorkflowAction,
  status: CaseStatus,
): TransitionDefinition {
  const definition = getTransition(action);
  if (!definition.from.includes(status)) {
    throw new WorkflowError(
      `Action "${action}" is not permitted while the case is "${status}". ` +
        `It is available from: ${definition.from.join(', ')}.`,
    );
  }
  return definition;
}
