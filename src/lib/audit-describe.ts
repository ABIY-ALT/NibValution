import { formatCurrency } from '@/lib/money';
import {
  CASE_STATUS_LABELS,
  ROLE_LABELS,
  isCaseStatus,
  isRoleCode,
} from '@/server/domain/shared/enums';

/**
 * Plain-language descriptions of audit records.
 *
 * The trail stores what the system needs to prove a change - an action code,
 * an entity type, an id and JSON snapshots. A reader wants a sentence: who did
 * what, to which case or person. This turns the first into the second without
 * touching the record itself; the stored row stays the authority.
 *
 * Every branch tolerates missing or unexpected fields. The trail spans years of
 * releases, and an old record in an older shape must still read as something,
 * never throw.
 */

export type AuditCategoryKey =
  'access' | 'security' | 'case' | 'document' | 'valuation' | 'settings' | 'users';

/** The badge variant each category renders with, one hue per kind of event. */
export const AUDIT_CATEGORIES: Record<
  AuditCategoryKey,
  { label: string; tone: 'default' | 'danger' | 'accent' | 'info' | 'success' | 'brand' | 'active' }
> = {
  access: { label: 'Sign-in', tone: 'default' },
  security: { label: 'Security', tone: 'danger' },
  case: { label: 'Case', tone: 'accent' },
  document: { label: 'Document', tone: 'info' },
  valuation: { label: 'Valuation', tone: 'success' },
  settings: { label: 'Settings', tone: 'brand' },
  users: { label: 'Users & roles', tone: 'active' },
};

/** A short name for each action, as the filter list offers it. */
const ACTIONS: Record<string, { category: AuditCategoryKey; label: string }> = {
  LOGIN_SUCCESS: { category: 'access', label: 'Signed in' },
  LOGIN_FAILURE: { category: 'security', label: 'Sign-in failed' },
  LOGOUT: { category: 'access', label: 'Signed out' },
  SESSION_EXPIRED: { category: 'access', label: 'Session expired' },
  PASSWORD_CHANGED: { category: 'access', label: 'Password changed' },
  PASSWORD_RESET_REQUESTED: { category: 'users', label: 'Password set-up or reset link sent' },
  PASSWORD_RESET: { category: 'users', label: 'Password reset by an administrator' },
  SESSIONS_REVOKED: { category: 'users', label: 'Signed out of every device' },
  ACCOUNT_LOCKED: { category: 'security', label: 'Account locked' },
  REAUTHENTICATED: { category: 'access', label: 'Identity confirmed' },
  PERMISSION_DENIED: { category: 'security', label: 'Access refused' },
  CASE_CREATED: { category: 'case', label: 'Case or property added' },
  CASE_UPDATED: { category: 'case', label: 'Case details updated' },
  CASE_SUBMITTED: { category: 'case', label: 'Case submitted' },
  CASE_ASSIGNED: { category: 'case', label: 'Case assigned' },
  CASE_REASSIGNED: { category: 'case', label: 'Case reassigned' },
  CASE_TRANSITIONED: { category: 'case', label: 'Case moved to a new stage' },
  CASE_RETURNED: { category: 'case', label: 'Case returned' },
  CASE_CANCELLED: { category: 'case', label: 'Case cancelled' },
  CASE_ARCHIVED: { category: 'case', label: 'Case archived' },
  COMMENT_ADDED: { category: 'case', label: 'Comment added' },
  APPROVAL_RECORDED: { category: 'case', label: 'Approval recorded' },
  DOCUMENT_UPLOADED: { category: 'document', label: 'Document uploaded' },
  DOCUMENT_DOWNLOADED: { category: 'document', label: 'Document downloaded' },
  DOCUMENT_DELETED: { category: 'document', label: 'Document deleted' },
  REPORT_GENERATED: { category: 'document', label: 'Report generated' },
  REPORT_DOWNLOADED: { category: 'document', label: 'Report downloaded' },
  SIGNATURE_APPLIED: { category: 'document', label: 'Report signed' },
  SIGNATURE_REVOKED: { category: 'document', label: 'Signature revoked' },
  CALCULATION_PERFORMED: { category: 'valuation', label: 'Valuation calculated' },
  VALUATION_VERSION_CREATED: { category: 'valuation', label: 'Valuation version saved' },
  CONFIGURATION_CHANGED: { category: 'settings', label: 'Setting changed' },
  CONFIG_UPDATE: { category: 'settings', label: 'System setting changed' },
  USER_CREATED: { category: 'users', label: 'User created' },
  USER_UPDATED: { category: 'users', label: 'User updated' },
  USER_DEACTIVATED: { category: 'users', label: 'User activated or deactivated' },
  ROLE_CREATED: { category: 'users', label: 'Role created' },
  ROLE_GRANTED: { category: 'users', label: 'Roles changed' },
  ROLE_REVOKED: { category: 'users', label: 'Role removed' },
};

/** What each stored entity type is called in a sentence. */
const ENTITIES: Record<string, string> = {
  ValuationCase: 'valuation case',
  CivilProperty: 'civil property details',
  CivilBuilding: 'building',
  MechanicalProperty: 'mechanical property details',
  Vehicle: 'vehicle',
  Machinery: 'machinery item',
  SiteVisit: 'site visit',
  Comment: 'comment',
  PropertyDocument: 'document',
  Valuation: 'valuation',
  Report: 'report',
  DigitalSignature: 'digital signature',
  User: 'user account',
  Credential: 'password',
  Session: 'sign-in session',
  Role: 'role',
  RequestType: 'request type',
  PropertyCategory: 'property category',
  DocumentCategory: 'document category',
  ApprovalThreshold: 'approval threshold',
  SystemConfiguration: 'system setting',
  SlaPolicy: 'SLA policy',
  Holiday: 'holiday',
  ValuationParameterSet: 'valuation parameter set',
};

/** Past-tense phrasing for each workflow step a case can take. */
const WORKFLOW_STEPS: Record<string, string> = {
  SUBMIT_REQUEST: 'Submitted the valuation request',
  RETURN_TO_REQUESTER: 'Returned the request to the requester',
  ASSIGN_MAKER: 'Assigned a valuator',
  START_VALUATION: 'Started the valuation',
  MARK_NOT_VISITED: 'Marked the site as not visited',
  MARK_PENDING: 'Put the valuation on hold',
  RESUME_VALUATION: 'Resumed the valuation',
  SUBMIT_FOR_CHECKING: 'Submitted the valuation for checking',
  ASSIGN_CHECKER: 'Assigned a checker',
  ADD_CHECKER_COMMENT: 'Added checker comments',
  COMPLETE_CHECKING: 'Completed checking',
  SUBMIT_FOR_APPROVAL: 'Submitted for approval',
  RETURN_FOR_CORRECTION: 'Returned the case for correction',
  RESUBMIT: 'Resubmitted after correction',
  APPROVE_MANAGER: 'Approved as manager',
  APPROVE_DIRECTOR: 'Approved as director',
  REJECT: 'Rejected the valuation',
  SIGN: 'Signed the report',
  GENERATE_FINAL_LETTER: 'Issued the final letter',
  DELIVER: 'Delivered the report',
  ARCHIVE: 'Archived the case',
  CANCEL: 'Cancelled the case',
};

const LOGIN_FAILURE_REASONS: Record<string, string> = {
  BAD_PASSWORD: 'Wrong password',
  UNKNOWN_ACCOUNT: 'No account matches the name entered',
  ACCOUNT_LOCKED: 'The account is locked',
  INACTIVE_ACCOUNT: 'The account is deactivated',
  REAUTH_FAILED: 'Wrong password when confirming identity',
};

const REPORT_TYPES: Record<string, string> = {
  VALUATION: 'valuation report',
  COVER_PAGE: 'cover page',
  FINAL_LETTER: 'final letter',
};

/** Fields that describe the record's plumbing rather than a change anyone made. */
const HOUSEKEEPING_FIELDS = new Set(['version', 'caseId', 'updatedAt', 'createdAt', 'id']);

/** `SUBMIT_REQUEST` → `Submit request`; `landHoldingRight` → `land holding right`. */
export function humanize(code: string): string {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.\-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function auditActionLabel(action: string): string {
  return ACTIONS[action]?.label ?? humanize(action);
}

export function auditEntityLabel(entity: string): string {
  const label = ENTITIES[entity] ?? humanize(entity).toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The roles an audit record stores as a comma-joined code list, named. */
export function roleNames(csv: string | null | undefined): string | null {
  if (!csv) return null;
  const names = csv
    .split(',')
    .map((code) => code.trim())
    .filter(Boolean)
    .map((code) => (isRoleCode(code) ? ROLE_LABELS[code] : humanize(code)));
  return names.length > 0 ? names.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Describing one record
// ---------------------------------------------------------------------------

export interface AuditRecordInput {
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface AuditLookups {
  /** Case id → case number, for the cases on this page. */
  caseNumbers: Record<string, string>;
  /** User id → full name, for the accounts on this page. */
  userNames: Record<string, string>;
}

export interface AuditDescription {
  category: AuditCategoryKey;
  /** One sentence: what happened. */
  summary: string;
  /** A short supporting line - a reason, a comment, a status - or null. */
  detail: string | null;
  /** The case this record concerns, when there is one. */
  caseId: string | null;
  caseNumber: string | null;
}

type Obj = Record<string, unknown>;

function asObject(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function quote(value: string | null): string {
  return value ? `“${value}”` : '';
}

function statusName(value: unknown): string | null {
  const code = text(value);
  if (!code) return null;
  return isCaseStatus(code) ? CASE_STATUS_LABELS[code] : humanize(code);
}

function roleList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((code) => (isRoleCode(code) ? ROLE_LABELS[code] : humanize(code)))
    : [];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields a before/after pair actually changed, named for a reader. */
function changedFields(before: Obj, after: Obj): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !HOUSEKEEPING_FIELDS.has(key))
    .filter((key) => key in after && !sameValue(before[key], after[key]))
    .map((key) => humanize(key).toLowerCase());
}

function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function clip(value: string, max = 140): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function describeAudit(record: AuditRecordInput, lookups: AuditLookups): AuditDescription {
  const before = asObject(record.before);
  const after = asObject(record.after);
  const category = ACTIONS[record.action]?.category ?? 'settings';
  const entityName = ENTITIES[record.entity] ?? humanize(record.entity).toLowerCase();

  const caseId = record.entity === 'ValuationCase' ? record.entityId : (text(after.caseId) ?? null);
  const caseNumber =
    (caseId ? lookups.caseNumbers[caseId] : undefined) ?? text(after.caseNumber) ?? null;

  // The account a user-management record is about - not necessarily the actor.
  const targetName =
    record.entityId && (record.entity === 'User' || record.entity === 'Credential')
      ? (lookups.userNames[record.entityId] ?? null)
      : null;
  const target = targetName ?? 'a user';

  const result = (summary: string, detail: string | null = null): AuditDescription => ({
    category,
    summary,
    detail: detail ? clip(detail) : null,
    caseId,
    caseNumber,
  });

  switch (record.action) {
    case 'LOGIN_SUCCESS':
      return result('Signed in');

    case 'LOGOUT':
      return result('Signed out');

    case 'SESSION_EXPIRED':
      return result('Session expired');

    case 'REAUTHENTICATED':
      return result('Re-entered their password to confirm identity');

    case 'PASSWORD_CHANGED': {
      const revoked = Number(after.otherSessionsRevoked ?? 0);
      const via =
        after.via === 'SETUP_LINK'
          ? 'Set from the emailed set-up link'
          : after.via === 'RESET_LINK'
            ? 'Set from the emailed reset link'
            : null;
      const parts = [
        via,
        revoked > 0 ? `signed out of ${revoked} other session${revoked === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      const detail = parts.join(' · ');
      return result(
        targetName ? `Password changed for ${targetName}` : 'Changed password',
        detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : null,
      );
    }

    case 'PASSWORD_RESET_REQUESTED': {
      if (after.purpose === 'SETUP' || after.purpose === 'RESET') {
        const hours = Number(after.validHours ?? 0);
        const parts = [
          after.emailRequested === true ? 'Emailed to the user' : 'Link handed to the administrator',
          hours > 0 ? `valid ${hours} hour${hours === 1 ? '' : 's'}` : null,
        ].filter(Boolean);
        return result(
          after.purpose === 'SETUP'
            ? `Sent ${target} a password set-up link`
            : `Sent ${target} a password reset link`,
          parts.join(' · '),
        );
      }
      return result(
        targetName ? `Password reset requested for ${targetName}` : 'Requested a password reset',
      );
    }

    // Kept for audit rows written before reset links replaced temporary passwords.
    case 'PASSWORD_RESET': {
      const revoked = Number(after.sessionsRevoked ?? 0);
      const parts = [
        'Temporary password issued',
        after.emailRequested === true ? 'emailed to the user' : null,
        revoked > 0 ? `signed out of ${revoked} session${revoked === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return result(`Reset ${target}’s password`, parts.join(' · '));
    }

    case 'SESSIONS_REVOKED': {
      const revoked = Number(after.sessionsRevoked ?? 0);
      return result(
        `Signed ${target} out of every device`,
        `${revoked} session${revoked === 1 ? '' : 's'} ended`,
      );
    }

    case 'LOGIN_FAILURE': {
      const reason = text(after.reason);
      const attempted = text(after.identifier) ?? text(after.employeeId);
      let detail = reason ? (LOGIN_FAILURE_REASONS[reason] ?? humanize(reason)) : null;
      if (reason === 'UNKNOWN_ACCOUNT' && attempted)
        detail = `No account matches ${quote(attempted)}`;
      if (reason === 'BAD_PASSWORD' && after.locked === true)
        detail = 'Wrong password — the account is now locked';
      return result(targetName ? `Sign-in failed for ${targetName}` : 'Sign-in failed', detail);
    }

    case 'ACCOUNT_LOCKED':
      return result(
        targetName ? `${targetName}’s account was locked` : 'An account was locked',
        'Too many failed sign-in attempts',
      );

    case 'PERMISSION_DENIED':
      return result(
        'Tried to do something they are not allowed to',
        text(after.permission) ? `Needed permission ${text(after.permission)}` : null,
      );

    case 'CASE_CREATED':
      if (record.entity === 'ValuationCase') {
        const owner = text(after.ownerName) ?? text(after.applicantName);
        return result('Created a valuation case', owner ? `Property owner: ${owner}` : null);
      }
      return result(`Added ${entityName}`);

    case 'CASE_UPDATED': {
      if (after.deleted === true) return result(`Removed ${entityName}`);
      if (record.entity === 'Comment' && typeof after.isResolved === 'boolean') {
        return result(after.isResolved ? 'Resolved a comment' : 'Reopened a comment');
      }
      const fields = changedFields(before, after);
      return result(
        `Updated ${entityName}`,
        fields.length > 0 ? `Changed ${listPhrase(fields.slice(0, 4))}` : null,
      );
    }

    case 'CASE_TRANSITIONED': {
      const step = text(after.action);
      const from = statusName(before.status);
      const to = statusName(after.status);
      const comment = text(after.comment);
      const parts = [
        from && to && from !== to ? `${from} → ${to}` : to ? `Now ${to}` : null,
        comment ? quote(comment) : null,
      ].filter(Boolean);
      return result(
        step ? (WORKFLOW_STEPS[step] ?? humanize(step)) : 'Moved the case to a new stage',
        parts.length > 0 ? parts.join(' · ') : null,
      );
    }

    case 'COMMENT_ADDED':
      return result(
        after.replyTo ? 'Replied to a comment' : 'Added a comment',
        text(after.section) ? `On ${humanize(String(after.section)).toLowerCase()}` : null,
      );

    case 'APPROVAL_RECORDED':
      return result(
        'Recorded an approval decision',
        text(after.decision) ? humanize(String(after.decision)) : null,
      );

    case 'DOCUMENT_UPLOADED': {
      const filename = text(after.filename);
      if (after.rejected === true) {
        return result(
          `Upload of ${quote(filename) || 'a file'} was rejected`,
          'The file failed the virus scan',
        );
      }
      return result(
        filename ? `Uploaded ${quote(filename)}` : 'Uploaded a document',
        text(after.category) ? `Filed as ${humanize(String(after.category))}` : null,
      );
    }

    case 'DOCUMENT_DOWNLOADED':
      return result(
        text(after.filename)
          ? `Downloaded ${quote(text(after.filename))}`
          : 'Downloaded a document',
      );

    case 'DOCUMENT_DELETED': {
      const filename = text(after.filename) ?? text(before.filename);
      return result(filename ? `Deleted ${quote(filename)}` : 'Deleted a document');
    }

    case 'REPORT_GENERATED': {
      const type = text(after.type);
      const version = text(after.version);
      return result(
        `Generated the ${type ? (REPORT_TYPES[type] ?? humanize(type).toLowerCase()) : 'report'}`,
        version ? `Version ${version}` : null,
      );
    }

    case 'REPORT_DOWNLOADED':
      return result('Downloaded a report');

    case 'SIGNATURE_APPLIED':
      return result(
        'Digitally signed the report',
        text(after.reportVersion) ? `Report version ${text(after.reportVersion)}` : null,
      );

    case 'SIGNATURE_REVOKED':
      return result('Revoked a digital signature', text(after.reason));

    case 'CALCULATION_PERFORMED': {
      const market = text(after.marketValue);
      const parameterSet = text(after.parameterSet);
      const parts = [
        market ? `Market value ${formatCurrency(market)}` : null,
        parameterSet ? `using parameters ${parameterSet}` : null,
      ].filter(Boolean);
      return result('Calculated the valuation', parts.length > 0 ? parts.join(' · ') : null);
    }

    case 'VALUATION_VERSION_CREATED':
      return result(
        'Saved a new valuation version',
        text(after.version) ? `Version ${text(after.version)}` : null,
      );

    case 'USER_CREATED':
      return result(`Created the account for ${text(after.fullName) ?? target}`);

    case 'USER_DEACTIVATED':
      return result(after.isActive === true ? `Reactivated ${target}` : `Deactivated ${target}`);

    case 'USER_UPDATED': {
      if ('lockedUntil' in after && after.lockedUntil === null && 'lockedUntil' in before) {
        return result(`Unlocked ${target}’s account`);
      }
      if ('discipline' in after && Object.keys(after).length === 1) {
        const from = text(before.discipline);
        const to = text(after.discipline);
        return result(
          `Changed ${target}’s discipline`,
          from && to && from !== to
            ? `${humanize(from)} → ${humanize(to)}`
            : to
              ? `Set to ${humanize(to)}`
              : null,
        );
      }
      const fields = changedFields(before, after);
      return result(
        `Updated ${target}`,
        fields.length > 0 ? `Changed ${listPhrase(fields)}` : null,
      );
    }

    case 'ROLE_GRANTED':
    case 'ROLE_REVOKED': {
      const was = roleList(before.roles);
      const now = roleList(after.roles);
      const added = now.filter((role) => !was.includes(role));
      const removed = was.filter((role) => !now.includes(role));
      const parts = [
        added.length > 0 ? `Added ${listPhrase(added)}` : null,
        removed.length > 0 ? `Removed ${listPhrase(removed)}` : null,
      ].filter(Boolean);
      return result(
        `Changed ${target}’s roles`,
        parts.length > 0
          ? parts.join(' · ')
          : now.length > 0
            ? `Roles: ${listPhrase(now)}`
            : 'No roles',
      );
    }

    case 'ROLE_CREATED': {
      const permissions = Array.isArray(after.permissions) ? after.permissions.length : null;
      return result(
        `Created the role ${quote(text(after.name) ?? text(after.code))}`,
        permissions !== null
          ? `${permissions} permission${permissions === 1 ? '' : 's'} granted`
          : null,
      );
    }

    case 'CONFIGURATION_CHANGED':
    case 'CONFIG_UPDATE':
      return result(
        ...describeConfiguration(record.entity, entityName, before, after, record.entityId),
      );

    default: {
      const fields = changedFields(before, after);
      return result(
        `${auditActionLabel(record.action)} — ${entityName}`,
        fields.length > 0 ? `Changed ${listPhrase(fields.slice(0, 4))}` : null,
      );
    }
  }
}

function describeConfiguration(
  entity: string,
  entityName: string,
  before: Obj,
  after: Obj,
  entityId: string | null,
): [string, string | null] {
  const name = text(after.name) ?? text(before.name) ?? text(after.code) ?? text(before.code);

  if (entity === 'ValuationParameterSet') {
    const version = text(after.version);
    const key = text(after.parameterName) ?? text(after.key);
    const isNew = after.parameterAdded === true;
    return [
      `Published valuation parameters${version ? ` version ${version}` : ''}`,
      key
        ? `${isNew ? 'Added' : 'Changed'} ${quote(key)}${text(after.reason) ? ` — ${text(after.reason)}` : ''}`
        : text(after.reason),
    ];
  }

  if (entity === 'SystemConfiguration') {
    return [`Changed the system setting ${quote(text(after.key) ?? entityId)}`, null];
  }

  if (Object.keys(before).length === 0) {
    return [`Created ${entityName} ${quote(name)}`.trim(), text(after.description)];
  }

  if (typeof after.isActive === 'boolean' && before.isActive !== after.isActive) {
    return [`${after.isActive ? 'Enabled' : 'Disabled'} ${entityName} ${quote(name)}`.trim(), null];
  }

  if ('approvalChain' in after) {
    const chain = roleList(after.approvalChain);
    return [
      `Changed the approval chain for ${quote(name)}`,
      chain.length > 0 ? `Now approved by ${chain.join(' → ')}` : null,
    ];
  }

  const fields = changedFields(before, after);
  return [
    `Changed ${entityName} ${quote(name)}`.trim(),
    fields.length > 0 ? `Changed ${listPhrase(fields.slice(0, 4))}` : 'Saved with no field changed',
  ];
}
