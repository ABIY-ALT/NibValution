import type { RoleCode } from '../shared/enums';

/**
 * The permission catalogue (docs/04-rbac-matrix.md).
 *
 * These constants are the *seed* for the `permissions` and `role_permissions`
 * tables, and the vocabulary the code uses when calling `authorize()`. At
 * runtime the grants come from the database, so an administrator can re-grant a
 * permission without a deployment (spec section 37). This file exists so that a
 * typo in a permission code is a compile error rather than a silent allow.
 */

export const PERMISSIONS = {
  // --- Case lifecycle ---
  CASE_CREATE: 'case:create',
  CASE_READ: 'case:read',
  CASE_UPDATE_REQUEST: 'case:update_request',
  CASE_CANCEL: 'case:cancel',
  CASE_ASSIGN_MAKER: 'case:assign_maker',
  CASE_ASSIGN_CHECKER: 'case:assign_checker',
  CASE_REASSIGN: 'case:reassign',
  CASE_RETURN_TO_REQUESTER: 'case:return_to_requester',
  CASE_ARCHIVE: 'case:archive',
  CASE_TIMELINE_READ: 'case:timeline_read',
  /**
   * Read-only visibility of every case, in any unit or department.
   *
   * This is an oversight grant, not an operating one. It satisfies the *scope*
   * half of the two-key check for read permissions only (see
   * `authorize.ts`), so a holder can open any case but still cannot value,
   * check, approve, sign, assign or delete anything. Segregation of duties is
   * therefore preserved: an administrator can investigate a case to support a
   * user without ever being able to authorise a figure.
   */
  CASE_READ_ALL: 'case:read_all',
  /**
   * Full operating authority across every case, in any unit or department.
   *
   * This satisfies the *scope* half of the two-key check for every permission,
   * and lets the holder act in any workflow role. It is the deliberate override
   * that lets an administrator run or repair any case without borrowing an
   * account.
   *
   * The cost is stated plainly in docs/04-rbac-matrix.md: for an account
   * holding this, the audit trail can no longer prove that two different people
   * were involved. Every such action is still recorded, and is attributed to
   * the ADMIN role so an override is visible in the history rather than
   * indistinguishable from ordinary work.
   */
  SYSTEM_ADMINISTER: 'system:administer',

  // --- Valuation ---
  VALUATION_START: 'valuation:start',
  VALUATION_EDIT: 'valuation:edit',
  VALUATION_CALCULATE: 'valuation:calculate',
  VALUATION_SUBMIT: 'valuation:submit',
  VALUATION_READ: 'valuation:read',
  VALUATION_CHECK: 'valuation:check',
  VALUATION_RETURN: 'valuation:return',
  VALUATION_MARK_STATUS: 'valuation:mark_status',

  // --- Approval & signature ---
  APPROVAL_MANAGER: 'approval:manager',
  APPROVAL_DIRECTOR: 'approval:director',
  SIGNATURE_SIGN: 'signature:sign',
  LETTER_GENERATE: 'letter:generate',
  REPORT_GENERATE: 'report:generate',
  REPORT_DOWNLOAD_FINAL: 'report:download_final',
  COVERPAGE_GENERATE: 'coverpage:generate',

  // --- Documents ---
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_READ_METADATA: 'document:read_metadata',
  DOCUMENT_DOWNLOAD: 'document:download',
  DOCUMENT_DELETE: 'document:delete',

  // --- Dashboards & reporting ---
  DASHBOARD_MAKER: 'dashboard:maker',
  DASHBOARD_CHECKER: 'dashboard:checker',
  DASHBOARD_MANAGER: 'dashboard:manager',
  DASHBOARD_DIRECTOR: 'dashboard:director',
  DASHBOARD_REQUESTER: 'dashboard:requester',
  REPORT_OPERATIONAL: 'report:operational',
  REPORT_PERFORMANCE: 'report:performance',
  REPORT_SLA: 'report:sla',
  ARCHIVE_SEARCH: 'archive:search',

  // --- Administration ---
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
  PERMISSION_MANAGE: 'permission:manage',
  ORG_MANAGE: 'org:manage',
  ORG_ROLLUP: 'org:rollup',
  CONFIG_READ: 'config:read',
  CONFIG_UPDATE: 'config:update',
  THRESHOLD_UPDATE: 'threshold:update',
  PARAMETER_UPDATE: 'parameter:update',
  CATEGORY_UPDATE: 'category:update',
  REQUEST_TYPE_UPDATE: 'requesttype:update',
  TEMPLATE_UPDATE: 'template:update',
  NOTIFICATION_CONFIG: 'notification:config',
  SLA_CONFIG: 'sla:config',
  AUDIT_READ: 'audit:read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionCode[] = Object.values(PERMISSIONS);

/** Split `resource:action` for storage in the `permissions` table. */
export function splitPermission(code: PermissionCode): { resource: string; action: string } {
  const [resource, action] = code.split(':');
  return { resource: resource ?? code, action: action ?? '' };
}

/**
 * The default role-to-permission grants seeded on first install.
 *
 * `ADMIN` holds the complete catalogue, by explicit decision of the bank: the
 * administrator can reach and act on every page. The trade-off is recorded in
 * docs/04-rbac-matrix.md — for that account the audit trail can no longer prove
 * two people were involved, so every administrator action is attributed to the
 * ADMIN role to keep an override visible in the history.
 *
 * The operating roles below remain narrowly scoped; segregation of duties is
 * still enforced between Maker, Checker and approver for everyone else.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  /**
   * The administrator holds every permission, by explicit decision of the bank.
   * See SYSTEM_ADMINISTER above for what that costs and what still holds.
   */
  ADMIN: ALL_PERMISSIONS,

  PROCESS_OWNER: [
    PERMISSIONS.CASE_CREATE,
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_UPDATE_REQUEST,
    PERMISSIONS.CASE_CANCEL,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.DASHBOARD_REQUESTER,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],

  MAKER_MANAGER: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_ASSIGN_MAKER,
    PERMISSIONS.CASE_REASSIGN,
    PERMISSIONS.CASE_RETURN_TO_REQUESTER,
    PERMISSIONS.CASE_ARCHIVE,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.VALUATION_RETURN,
    PERMISSIONS.APPROVAL_MANAGER,
    PERMISSIONS.SIGNATURE_SIGN,
    PERMISSIONS.LETTER_GENERATE,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.COVERPAGE_GENERATE,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.DASHBOARD_MANAGER,
    PERMISSIONS.REPORT_OPERATIONAL,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.REPORT_SLA,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],

  MAKER: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_START,
    PERMISSIONS.VALUATION_EDIT,
    PERMISSIONS.VALUATION_CALCULATE,
    PERMISSIONS.VALUATION_SUBMIT,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.VALUATION_MARK_STATUS,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.DOCUMENT_UPLOAD,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DOCUMENT_DELETE,
    PERMISSIONS.DASHBOARD_MAKER,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],

  CHECKER_MANAGER: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_ASSIGN_CHECKER,
    // The Scope of Work: "Checker manager - comment/return to maker/checker".
    PERMISSIONS.VALUATION_RETURN,
    PERMISSIONS.CASE_REASSIGN,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DASHBOARD_MANAGER,
    PERMISSIONS.REPORT_OPERATIONAL,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.REPORT_SLA,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],

  CHECKER: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.VALUATION_CHECK,
    PERMISSIONS.VALUATION_RETURN,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DASHBOARD_CHECKER,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],

  DIRECTOR: [
    PERMISSIONS.CASE_READ,
    PERMISSIONS.CASE_REASSIGN,
    PERMISSIONS.CASE_TIMELINE_READ,
    PERMISSIONS.VALUATION_READ,
    PERMISSIONS.VALUATION_RETURN,
    PERMISSIONS.APPROVAL_DIRECTOR,
    PERMISSIONS.SIGNATURE_SIGN,
    PERMISSIONS.LETTER_GENERATE,
    PERMISSIONS.REPORT_GENERATE,
    PERMISSIONS.REPORT_DOWNLOAD_FINAL,
    PERMISSIONS.COVERPAGE_GENERATE,
    PERMISSIONS.DOCUMENT_READ_METADATA,
    PERMISSIONS.DOCUMENT_DOWNLOAD,
    PERMISSIONS.DASHBOARD_DIRECTOR,
    PERMISSIONS.DASHBOARD_MANAGER,
    PERMISSIONS.REPORT_OPERATIONAL,
    PERMISSIONS.REPORT_PERFORMANCE,
    PERMISSIONS.REPORT_SLA,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.ARCHIVE_SEARCH,
  ],
};

/** Human-readable descriptions, used by the admin UI and the seed. */
export const PERMISSION_DESCRIPTIONS: Partial<Record<PermissionCode, string>> = {
  [PERMISSIONS.CASE_CREATE]: 'Create and submit a valuation request',
  [PERMISSIONS.CASE_ASSIGN_MAKER]: 'Assign a valuation case to a Maker',
  [PERMISSIONS.CASE_ASSIGN_CHECKER]: 'Assign a valuation case to a Checker',
  [PERMISSIONS.VALUATION_SUBMIT]: 'Submit a completed valuation for checking',
  [PERMISSIONS.VALUATION_RETURN]: 'Return a case for correction with a mandatory comment',
  [PERMISSIONS.APPROVAL_MANAGER]: 'Approve cases at Manager level',
  [PERMISSIONS.APPROVAL_DIRECTOR]: 'Approve cases at Director level',
  [PERMISSIONS.SIGNATURE_SIGN]: 'Digitally sign an approved valuation',
  [PERMISSIONS.LETTER_GENERATE]: 'Generate the final valuation letter',
  [PERMISSIONS.AUDIT_READ]: 'Read the audit trail',
  [PERMISSIONS.ORG_ROLLUP]: 'See cases of subordinate organisation units',
  [PERMISSIONS.CASE_READ_ALL]:
    'Read-only visibility of every case in every unit. Grants no ability to value, approve or sign.',
  [PERMISSIONS.SYSTEM_ADMINISTER]:
    'Act on any case in any unit, in any workflow role. Every use is audited and attributed to ADMIN.',
};
