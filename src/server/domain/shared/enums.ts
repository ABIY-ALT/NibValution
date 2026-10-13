/**
 * Domain-level enumerations.
 *
 * These deliberately duplicate the Prisma enums rather than importing them:
 * the domain layer must stay free of `@prisma/client` so the workflow and
 * valuation logic can be unit-tested without a generated client or a database
 * (see docs/06-folder-structure.md).
 *
 * The duplication is kept honest by `src/server/infrastructure/db/enum-parity.ts`,
 * which asserts at compile time that every Prisma enum member has a domain
 * counterpart and vice versa. Drift is therefore a build failure, not a bug
 * that surfaces in production.
 */

export const CASE_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'ASSIGNED',
  'ON_PROGRESS',
  'NOT_VISITED',
  'PENDING',
  'AWAITING_REQUESTER',
  'SUBMITTED_FOR_CHECKING',
  'CHECKING',
  'COMMENTED',
  'RETURNED_FOR_CORRECTION',
  'CHECKED',
  'PENDING_MANAGER_APPROVAL',
  'PENDING_DIRECTOR_APPROVAL',
  'APPROVED',
  'SIGNED',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Statuses after which the case content may no longer be edited. */
export const TERMINAL_STATUSES: readonly CaseStatus[] = [
  'APPROVED',
  'SIGNED',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
] as const;

export const ROLE_CODES = [
  'ADMIN',
  'PROCESS_OWNER',
  'MAKER_MANAGER',
  'MAKER',
  'CHECKER_MANAGER',
  'CHECKER',
  'DIRECTOR',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const DISCIPLINES = ['CIVIL', 'MECHANICAL', 'BOTH', 'NONE'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const APPROVAL_LEVELS = ['CHECKER', 'MANAGER', 'DIRECTOR'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export const APPROVAL_DECISIONS = ['APPROVED', 'REJECTED', 'RETURNED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const LAND_HOLDING_RIGHTS = ['FREEHOLD', 'LEASE', 'BOTH'] as const;
export type LandHoldingRight = (typeof LAND_HOLDING_RIGHTS)[number];

export const CONSTRUCTION_STATUSES = ['COMPLETED', 'UNDER_CONSTRUCTION', 'ABANDONED'] as const;
export type ConstructionStatus = (typeof CONSTRUCTION_STATUSES)[number];

export const CONDITION_GRADES = [
  'EXCELLENT',
  'VERY_GOOD',
  'GOOD',
  'FAIR',
  'POOR',
  'SCRAP',
] as const;
export type ConditionGrade = (typeof CONDITION_GRADES)[number];

export const DEPRECIATION_METHODS = [
  'STRAIGHT_LINE',
  'AGE_LIFE_CONDITION',
  'DECLINING_BALANCE',
] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

export const TASK_TYPES = [
  'ASSIGN_MAKER',
  'PERFORM_VALUATION',
  'ASSIGN_CHECKER',
  'PERFORM_CHECKING',
  'MANAGER_APPROVAL',
  'DIRECTOR_APPROVAL',
  'SIGN',
  'GENERATE_COVER_PAGE',
  'GENERATE_FINAL_LETTER',
  'CORRECT_VALUATION',
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const SLA_STATUSES = ['GREEN', 'WARNING', 'BREACHED', 'PAUSED', 'CLOSED'] as const;
export type SlaStatus = (typeof SLA_STATUSES)[number];

export const SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'QUARANTINED', 'SKIPPED'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const REPORT_TYPES = ['VALUATION', 'COVER_PAGE', 'FINAL_LETTER'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const VALUATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_CHECK',
  'CHECKED',
  'APPROVED',
  'SUPERSEDED',
] as const;
export type ValuationStatus = (typeof VALUATION_STATUSES)[number];

export const SITE_VISIT_CHECKS = [
  'VERIFIED',
  'OUTSIDE_RADIUS',
  'LOW_ACCURACY',
  'LOCATION_SET',
  'NO_LOCATION',
] as const;
export type SiteVisitCheck = (typeof SITE_VISIT_CHECKS)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ORGANIZATION_TYPES = ['BRANCH', 'DISTRICT', 'HEAD_OFFICE_UNIT'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const MECHANICAL_ITEM_KINDS = ['VEHICLE', 'MACHINERY'] as const;
export type MechanicalItemKind = (typeof MECHANICAL_ITEM_KINDS)[number];

export const PARAMETER_TYPES = ['RATE', 'FACTOR', 'PERCENT', 'AMOUNT', 'YEARS', 'TABLE'] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

export const SIGNATURE_STATUSES = ['VALID', 'REVOKED', 'FAILED'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const VALUATION_APPROACH_KINDS = ['COST', 'SALES', 'MARKET'] as const;
export type ValuationApproachKind = (typeof VALUATION_APPROACH_KINDS)[number];

/** Human-readable status labels for the UI and reports. */
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested',
  ASSIGNED: 'Assigned',
  ON_PROGRESS: 'On Progress',
  NOT_VISITED: 'Not Visited',
  PENDING: 'Pending',
  AWAITING_REQUESTER: 'Awaiting Requester',
  SUBMITTED_FOR_CHECKING: 'Submitted for Checking',
  CHECKING: 'Checking',
  COMMENTED: 'Commented',
  RETURNED_FOR_CORRECTION: 'Returned for Correction',
  CHECKED: 'Checked',
  PENDING_MANAGER_APPROVAL: 'Pending Manager Approval',
  PENDING_DIRECTOR_APPROVAL: 'Pending Director Approval',
  APPROVED: 'Approved',
  SIGNED: 'Signed',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
  CANCELLED: 'Cancelled',
};

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'System Administrator',
  PROCESS_OWNER: 'Process Owner',
  MAKER_MANAGER: 'Maker Manager',
  MAKER: 'Valuator (Maker)',
  CHECKER_MANAGER: 'Checker Manager',
  CHECKER: 'Valuator (Checker)',
  DIRECTOR: 'Director',
};

export function isCaseStatus(value: string): value is CaseStatus {
  return (CASE_STATUSES as readonly string[]).includes(value);
}

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}

export function isTerminalStatus(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
