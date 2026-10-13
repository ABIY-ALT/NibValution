import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/lib/errors';
import type { Discipline, RoleCode } from '../shared/enums';
import { PERMISSIONS, type PermissionCode } from './permissions';

/**
 * Authorisation is a two-key check (docs/04-rbac-matrix.md):
 *
 *   1. Permission - does any role the caller holds grant this permission?
 *   2. Scope      - does the caller stand in the required *relationship* to
 *                   this specific record?
 *
 * The second key is what closes IDOR. A Maker holds `valuation:edit`, but only
 * for cases assigned to them; without the scope check, holding the permission
 * would let them edit any case whose id they could guess.
 */

/** The authenticated caller, as the domain layer sees them. */
export interface Actor {
  readonly id: string;
  readonly fullName: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly organizationId: string | null;
  readonly departmentId: string | null;
  readonly discipline: Discipline;
  readonly isActive: boolean;
  /** Ancestor-inclusive set of org ids the actor may see (populated when `org:rollup` is held). */
  readonly organizationScope: readonly string[];
}

/** The subset of a case needed to make an access decision. */
export interface CaseAccessSubject {
  readonly id: string;
  readonly requestingOrgId: string;
  readonly departmentId: string;
  readonly requestedById: string;
  readonly makerId: string | null;
  readonly checkerId: string | null;
}

export type ScopePredicate =
  | 'ANY'
  | 'OWN_ORG'
  | 'SELF_MAKER'
  | 'SELF_CHECKER'
  | 'SELF_REQUESTER'
  | 'DEPT'
  | 'NOT_PARTICIPANT'
  /**
   * Satisfied when the actor holds `case:read_all`.
   *
   * Deliberately attached to read-only permissions only, in the table below.
   * It must never appear on an editing, assignment, approval, signing or
   * deletion permission - that would turn an oversight grant into unlimited
   * operating authority and destroy segregation of duties.
   */
  | 'GLOBAL_READER'
  /**
   * Satisfied when the actor holds `system:administer`.
   *
   * Unlike GLOBAL_READER this is attached to *every* permission, so it carries
   * full operating authority. `NOT_PARTICIPANT` still vetoes on top of it: an
   * administrator who personally valued or checked a case cannot also approve
   * that case, because that guard is about the specific case rather than about
   * role.
   */
  | 'GLOBAL_ADMIN';

/**
 * Which scope predicates satisfy each permission. A permission is granted for a
 * given case when the actor holds it AND at least one listed predicate holds
 * (except `NOT_PARTICIPANT`, which is a veto - see `satisfiesScope`).
 */
const PERMISSION_SCOPES: Partial<Record<PermissionCode, readonly ScopePredicate[]>> = {
  // Raising and submitting a request is scoped to the requester and their own
  // unit. Without this entry the scope check denies by default, which is the
  // safe direction but silently blocks a Process Owner from submitting.
  [PERMISSIONS.CASE_CREATE]: ['SELF_REQUESTER', 'OWN_ORG', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_READ]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'SELF_REQUESTER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],
  [PERMISSIONS.CASE_TIMELINE_READ]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'SELF_REQUESTER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],
  [PERMISSIONS.CASE_UPDATE_REQUEST]: ['SELF_REQUESTER', 'OWN_ORG', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_CANCEL]: ['SELF_REQUESTER', 'OWN_ORG', 'ANY', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_ASSIGN_MAKER]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_ASSIGN_CHECKER]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_REASSIGN]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_RETURN_TO_REQUESTER]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.CASE_ARCHIVE]: ['DEPT', 'ANY', 'GLOBAL_ADMIN'],

  [PERMISSIONS.VALUATION_START]: ['SELF_MAKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_EDIT]: ['SELF_MAKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_CALCULATE]: ['SELF_MAKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_SUBMIT]: ['SELF_MAKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_MARK_STATUS]: ['SELF_MAKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_READ]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],
  [PERMISSIONS.VALUATION_CHECK]: ['SELF_CHECKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.VALUATION_RETURN]: ['SELF_CHECKER', 'DEPT', 'GLOBAL_ADMIN'],

  [PERMISSIONS.APPROVAL_MANAGER]: ['DEPT', 'NOT_PARTICIPANT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.APPROVAL_DIRECTOR]: ['DEPT', 'NOT_PARTICIPANT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.SIGNATURE_SIGN]: ['DEPT', 'NOT_PARTICIPANT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.LETTER_GENERATE]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.COVERPAGE_GENERATE]: ['DEPT', 'GLOBAL_ADMIN'],
  [PERMISSIONS.REPORT_GENERATE]: ['DEPT', 'SELF_MAKER', 'SELF_CHECKER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.REPORT_DOWNLOAD_FINAL]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'SELF_REQUESTER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],

  [PERMISSIONS.DOCUMENT_UPLOAD]: ['OWN_ORG', 'SELF_MAKER', 'SELF_REQUESTER', 'GLOBAL_ADMIN'],
  [PERMISSIONS.DOCUMENT_READ_METADATA]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'SELF_REQUESTER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],
  [PERMISSIONS.DOCUMENT_DOWNLOAD]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_CHECKER',
    'SELF_REQUESTER',
    'GLOBAL_READER',
    'GLOBAL_ADMIN',
  ],
  [PERMISSIONS.DOCUMENT_DELETE]: [
    'OWN_ORG',
    'DEPT',
    'SELF_MAKER',
    'SELF_REQUESTER',
    'GLOBAL_ADMIN',
  ],
};

export function hasPermission(actor: Actor, permission: PermissionCode): boolean {
  return actor.isActive && actor.permissions.has(permission);
}

export function hasRole(actor: Actor, role: RoleCode): boolean {
  return actor.roles.includes(role);
}

export function hasAnyRole(actor: Actor, roles: readonly RoleCode[]): boolean {
  return roles.some((r) => actor.roles.includes(r));
}

/** Evaluate a single scope predicate for an actor against a case. */
export function satisfiesScope(
  actor: Actor,
  subject: CaseAccessSubject,
  predicate: ScopePredicate,
): boolean {
  switch (predicate) {
    case 'ANY':
      return true;
    case 'OWN_ORG':
      return (
        subject.requestingOrgId === actor.organizationId ||
        actor.organizationScope.includes(subject.requestingOrgId)
      );
    case 'SELF_MAKER':
      return subject.makerId === actor.id;
    case 'SELF_CHECKER':
      return subject.checkerId === actor.id;
    case 'SELF_REQUESTER':
      return subject.requestedById === actor.id;
    case 'DEPT':
      return actor.departmentId !== null && subject.departmentId === actor.departmentId;
    case 'NOT_PARTICIPANT':
      return subject.makerId !== actor.id && subject.checkerId !== actor.id;
    case 'GLOBAL_READER':
      return actor.permissions.has(PERMISSIONS.CASE_READ_ALL);
    case 'GLOBAL_ADMIN':
      return actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER);
  }
}

/**
 * Permissions that `GLOBAL_READER` is allowed to satisfy.
 *
 * Kept as an explicit allow-list rather than inferred from the permission name,
 * so that adding a new permission never silently widens what an oversight
 * reader can do. A test asserts that every entry here is genuinely read-only.
 */
export const GLOBAL_READ_PERMISSIONS: readonly PermissionCode[] = [
  PERMISSIONS.CASE_READ,
  PERMISSIONS.CASE_TIMELINE_READ,
  PERMISSIONS.VALUATION_READ,
  PERMISSIONS.DOCUMENT_READ_METADATA,
  PERMISSIONS.DOCUMENT_DOWNLOAD,
  PERMISSIONS.REPORT_DOWNLOAD_FINAL,
];

/**
 * Does the actor hold `permission` for this specific case?
 *
 * `NOT_PARTICIPANT` behaves as a veto rather than as one of several
 * alternatives: for approval and signing it must hold *in addition* to a
 * positional predicate, which is how segregation of duties is enforced. A
 * Manager who happened to make the valuation therefore cannot approve it, even
 * though they satisfy `DEPT`.
 */
export function canAccessCase(
  actor: Actor,
  subject: CaseAccessSubject,
  permission: PermissionCode,
): boolean {
  if (!hasPermission(actor, permission)) return false;

  const predicates = PERMISSION_SCOPES[permission];
  if (!predicates || predicates.length === 0) {
    // A permission with no declared scope is case-independent (e.g. admin
    // configuration). Reaching here with a case subject means the caller asked
    // the wrong question, so deny rather than guess.
    return false;
  }

  if (
    predicates.includes('NOT_PARTICIPANT') &&
    !satisfiesScope(actor, subject, 'NOT_PARTICIPANT')
  ) {
    return false;
  }

  const positional = predicates.filter((p) => p !== 'NOT_PARTICIPANT');
  if (positional.length === 0) return true;

  return positional.some((p) => satisfiesScope(actor, subject, p));
}

/**
 * Assert a case-scoped permission. Throws rather than returning a boolean, so a
 * forgotten check fails loudly in testing instead of silently permitting an
 * action in production.
 *
 * Throws `NotFoundError` rather than `ForbiddenError` when the actor cannot see
 * the case at all: a 403 would confirm the case exists and turn the endpoint
 * into an enumeration oracle.
 */
export function assertCaseAccess(
  actor: Actor,
  subject: CaseAccessSubject,
  permission: PermissionCode,
): void {
  assertActive(actor);

  if (canAccessCase(actor, subject, permission)) return;

  // Distinguish "cannot see this case at all" from "can see it but not do this".
  if (!canAccessCase(actor, subject, PERMISSIONS.CASE_READ)) {
    throw new NotFoundError('The requested case was not found.');
  }
  throw new ForbiddenError(`You are not permitted to perform "${permission}" on this case.`);
}

/** Assert a permission that is not tied to a particular case. */
export function assertPermission(actor: Actor, permission: PermissionCode): void {
  assertActive(actor);
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError(`You are not permitted to perform "${permission}".`);
  }
}

export function assertActive(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw new UnauthenticatedError();
  if (!actor.isActive) {
    throw new ForbiddenError('This account has been deactivated.');
  }
}

/**
 * Segregation of duties (assumption 2.2): the maker and the checker of a case
 * must be different people, and neither may approve it. Enforced here, in the
 * database as a check constraint, and again at assignment time.
 */
export function assertNotParticipant(
  actor: Actor,
  subject: CaseAccessSubject,
  action: string,
): void {
  if (!satisfiesScope(actor, subject, 'NOT_PARTICIPANT')) {
    throw new ForbiddenError(
      `You performed the valuation or the check on this case and may not also ${action} it.`,
    );
  }
}

/** Does the actor's discipline permit them to work a case of this discipline? */
export function matchesDiscipline(actor: Actor, caseDiscipline: Discipline): boolean {
  if (actor.discipline === 'BOTH') return true;
  return actor.discipline === caseDiscipline;
}
