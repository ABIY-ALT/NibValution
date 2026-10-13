import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db/client';
import { serverEnv } from '@/lib/env';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Discipline, RoleCode } from '@/server/domain/shared/enums';

/**
 * Server-side sessions (spec section 26).
 *
 * Sessions are database records, not self-contained tokens. That choice costs a
 * query per request and buys something a JWT cannot give a bank: immediate,
 * central revocation. When an administrator deactivates a user - or a user
 * changes their password after a suspected compromise - every live session ends
 * on the next request, rather than remaining valid until a token expires.
 *
 * The cookie carries a random 32-byte token; only its SHA-256 is stored, so a
 * database disclosure does not hand over usable sessions.
 */

export const SESSION_COOKIE_NAME = 'nib_session';

/** How often the idle window is slid forward, at most. */
const SLIDE_EVERY_MS = 60_000;

export interface SessionCookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

export async function createSession(
  userId: string,
  context: { ipAddress?: string | null; userAgent?: string | null },
): Promise<CreatedSession> {
  const token = generateToken();
  const now = Date.now();
  const expiresAt = new Date(now + serverEnv.SESSION_IDLE_MINUTES * 60_000);
  const absoluteExpiresAt = new Date(now + serverEnv.SESSION_ABSOLUTE_HOURS * 3_600_000);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      expiresAt,
      absoluteExpiresAt,
      // The login itself counts as a fresh authentication, so an immediate
      // signature does not demand a second password entry.
      reauthenticatedAt: new Date(),
    },
  });

  return { token, sessionId: session.id, expiresAt, absoluteExpiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  actor: Actor;
  mustChangePassword: boolean;
  reauthenticatedAt: Date | null;
  expiresAt: Date;
}

/**
 * Resolve a session token to an actor, sliding the idle window forward.
 *
 * Returns `null` for anything invalid - unknown, revoked, expired, or belonging
 * to a deactivated user - without distinguishing between them to the caller.
 */
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          credential: { select: { mustChange: true, expiresAt: true } },
          roles: {
            include: { role: { include: { permissions: { include: { permission: true } } } } },
          },
          organization: { select: { id: true } },
        },
      },
    },
  });

  if (!session) return null;

  const now = new Date();
  if (
    session.revokedAt !== null ||
    session.expiresAt <= now ||
    session.absoluteExpiresAt <= now ||
    !session.user.isActive
  ) {
    // Expired or revoked sessions are cleaned up as they are encountered, which
    // keeps the table small without a separate sweep for the common case.
    if (session.revokedAt === null) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    }
    return null;
  }

  // Slide the idle window, but never past the absolute expiry. At most once a
  // minute: a page load fans out into several requests, and a write for each
  // would buy an idle timeout accurate to the second at the cost of a row
  // update per request for every signed-in user.
  let newExpiry = session.expiresAt;
  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() >= SLIDE_EVERY_MS) {
    const slidExpiry = new Date(now.getTime() + serverEnv.SESSION_IDLE_MINUTES * 60_000);
    newExpiry = slidExpiry > session.absoluteExpiresAt ? session.absoluteExpiresAt : slidExpiry;
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: now, expiresAt: newExpiry },
    });
  }

  const roles: RoleCode[] = session.user.roles.map((r) => r.role.code as RoleCode);
  const permissions = new Set<PermissionCode>();
  for (const userRole of session.user.roles) {
    for (const grant of userRole.role.permissions) {
      permissions.add(grant.permission.code as PermissionCode);
    }
  }

  const organizationScope = await resolveOrganizationScope(
    session.user.organizationId,
    permissions.has('org:rollup' as PermissionCode),
  );

  const credentialExpired =
    session.user.credential?.expiresAt !== null &&
    session.user.credential?.expiresAt !== undefined &&
    session.user.credential.expiresAt <= now;

  const actor: Actor = {
    id: session.user.id,
    fullName: session.user.fullName,
    roles,
    permissions,
    organizationId: session.user.organizationId,
    departmentId: session.user.departmentId,
    discipline: session.user.discipline as Discipline,
    isActive: session.user.isActive,
    organizationScope,
  };

  return {
    sessionId: session.id,
    actor,
    mustChangePassword: (session.user.credential?.mustChange ?? false) || credentialExpired,
    reauthenticatedAt: session.reauthenticatedAt,
    expiresAt: newExpiry,
  };
}

/**
 * The organisation ids an actor may see.
 *
 * Without `org:rollup` this is just their own unit. With it - the case for a
 * district office - it is their unit and everything beneath it, walked
 * recursively so a three-level hierarchy behaves the same as a two-level one.
 */
async function resolveOrganizationScope(
  organizationId: string | null,
  hasRollup: boolean,
): Promise<string[]> {
  if (!organizationId) return [];
  if (!hasRollup) return [organizationId];

  const scope = new Set<string>([organizationId]);
  let frontier = [organizationId];

  // Bounded to protect against a cycle introduced by bad configuration data.
  for (let depth = 0; depth < 6 && frontier.length > 0; depth += 1) {
    const children = await prisma.organization.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !scope.has(id));
    for (const id of frontier) scope.add(id);
  }

  return [...scope];
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revoke every live session for a user - used on deactivation and password change. */
export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Mark a session as freshly re-authenticated, gating digital signature (section 19). */
export async function markReauthenticated(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { reauthenticatedAt: new Date() },
  });
}

/** Has the session re-authenticated recently enough to sign? */
export function hasRecentReauthentication(
  reauthenticatedAt: Date | null,
  windowSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!reauthenticatedAt) return false;
  return now.getTime() - reauthenticatedAt.getTime() <= windowSeconds * 1000;
}

export function sessionCookieOptions(token: string, maxAgeSeconds: number): SessionCookieOptions {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: serverEnv.APP_URL.startsWith('https://'),
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Constant-time comparison, for CSRF tokens and similar secrets. */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Remove sessions that expired long ago. Called by the maintenance job. */
export async function purgeExpiredSessions(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.session.deleteMany({
    where: { OR: [{ absoluteExpiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });
  return result.count;
}
