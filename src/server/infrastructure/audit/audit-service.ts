import type { Prisma } from '@prisma/client';
import type { TransactionClient } from '../db/client';
import { prisma } from '../db/client';

/**
 * The audit trail (spec section 25).
 *
 * Two rules make it trustworthy:
 *
 *  1. **Written inside the caller's transaction.** `record()` takes a
 *     transaction client, so the audit entry and the change it describes commit
 *     or roll back together. An audit gap cannot arise from a partial failure.
 *  2. **Append-only in the database.** A trigger rejects UPDATE and DELETE on
 *     `audit_logs`, so the trail survives an application bug as well as a
 *     malicious caller.
 *
 * The `before`/`after` snapshots are filtered before storage: an audit record
 * proves *what changed*, and copying password hashes or document contents into
 * it would create a second, less protected copy of sensitive data
 * (section 25: "do not log sensitive data unnecessarily").
 */

export type AuditAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'SESSION_EXPIRED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'ACCOUNT_LOCKED'
  | 'REAUTHENTICATED'
  | 'CASE_CREATED'
  | 'CASE_UPDATED'
  | 'CASE_SUBMITTED'
  | 'CASE_ASSIGNED'
  | 'CASE_REASSIGNED'
  | 'CASE_TRANSITIONED'
  | 'CASE_RETURNED'
  | 'CASE_CANCELLED'
  | 'CASE_ARCHIVED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_DOWNLOADED'
  | 'DOCUMENT_DELETED'
  | 'CALCULATION_PERFORMED'
  | 'VALUATION_VERSION_CREATED'
  | 'REPORT_GENERATED'
  | 'REPORT_DOWNLOADED'
  | 'COMMENT_ADDED'
  | 'APPROVAL_RECORDED'
  | 'SIGNATURE_APPLIED'
  | 'SIGNATURE_REVOKED'
  | 'CONFIGURATION_CHANGED'
  | 'USER_CREATED'
  | 'ROLE_CREATED'
  | 'USER_UPDATED'
  | 'USER_DEACTIVATED'
  | 'ROLE_GRANTED'
  | 'ROLE_REVOKED'
  | 'PERMISSION_DENIED';

export interface AuditContext {
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
  readonly correlationId?: string | null;
}

export interface AuditEntry extends AuditContext {
  readonly action: AuditAction;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Fields never copied into an audit snapshot. Recording that a password hash
 * changed is useful; recording the hash itself is a liability.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'params',
  'mfasecret',
  'tokenhash',
  'signature',
  'privatekey',
  'datasnapshot',
  'parametersnapshot',
  'inputsnapshot',
  'outputsnapshot',
  'body',
]);

/** Recursively strip sensitive keys and truncate oversized values. */
function sanitize(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (depth > 6) return '[truncated: too deep]';

  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  // Prisma Decimal and similar wrapper objects serialise usefully via toString.
  if (typeof value === 'object' && 'toFixed' in value && typeof value.toFixed === 'function') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => sanitize(item, depth + 1) ?? null);
    return items as Prisma.InputJsonValue;
  }

  if (typeof value === 'object') {
    const result: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '[redacted]';
        continue;
      }
      const sanitized = sanitize(entryValue, depth + 1);
      if (sanitized !== undefined) result[key] = sanitized;
    }
    return result;
  }

  return String(value);
}

/**
 * Write an audit record inside an existing transaction.
 *
 * Requiring the transaction client as the first argument is deliberate: it
 * makes it impossible to log an action that has not actually been committed,
 * and equally impossible to commit an action without logging it.
 */
export async function record(tx: TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: sanitize(entry.before) ?? undefined,
      after: sanitize(entry.after) ?? undefined,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      correlationId: entry.correlationId ?? null,
    },
  });
}

/**
 * Write an audit record outside a transaction.
 *
 * Reserved for events that have no accompanying database change to be atomic
 * with - a failed login, a denied permission, a document download. Using this
 * for a state change would reintroduce exactly the gap `record()` prevents.
 */
export async function recordStandalone(entry: AuditEntry): Promise<void> {
  await record(prisma, entry);
}

/** Compute a minimal before/after pair, listing only the fields that changed. */
export function diff<T extends Record<string, unknown>>(
  before: T | null,
  after: T | null,
  fields?: readonly (keyof T)[],
): { before: Partial<T>; after: Partial<T> } {
  const keys =
    fields ??
    ([...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])] as (keyof T)[]);

  const beforeDiff: Partial<T> = {};
  const afterDiff: Partial<T> = {};

  for (const key of keys) {
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (String(oldValue) === String(newValue)) continue;
    if (oldValue !== undefined) beforeDiff[key] = oldValue;
    if (newValue !== undefined) afterDiff[key] = newValue;
  }

  return { before: beforeDiff, after: afterDiff };
}
