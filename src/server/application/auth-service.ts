import { createHash, randomBytes } from 'node:crypto';
import { prisma, type TransactionClient } from '@/server/infrastructure/db/client';
import {
  CURRENT_HASH_PARAMS,
  dummyVerify,
  hashPassword,
  needsRehash,
  paramsToJson,
  verifyPassword,
  type HashParams,
} from '@/server/infrastructure/auth/password';
import { serverEnv } from '@/lib/env';
import {
  createSession,
  markReauthenticated,
  revokeAllSessionsForUser,
  revokeSession,
  type CreatedSession,
} from '@/server/infrastructure/auth/session';
import { assertRateLimit, resetRateLimit } from '@/server/infrastructure/auth/rate-limit';
import { recordStandalone } from '@/server/infrastructure/audit/audit-service';
import { getNumberConfig } from './configuration-service';
import { BusinessRuleError, UnauthenticatedError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Authentication use cases.
 *
 * The overriding principle here is that failures must be indistinguishable.
 * Whether an employee ID does not exist, the password is wrong, or the account
 * is locked, the caller receives the same message and a comparable response
 * time. Anything else lets an outsider map the bank's staff list from the login
 * page.
 */

export interface LoginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface LoginResult {
  session: CreatedSession;
  userId: string;
  mustChangePassword: boolean;
}

const GENERIC_FAILURE = 'The email address or password is incorrect.';

/**
 * Sign in with an institutional email address.
 *
 * The NIB Board Governance Portal signs staff in by institutional email, so
 * this system does the same: one credential across both, rather than asking the
 * same person to remember a different identifier here.
 *
 * An employee ID is still accepted in the same field. That is not a fallback
 * for staff - it keeps seeded and service accounts usable without a second
 * login form.
 */
export async function login(
  identifier: string,
  password: string,
  context: LoginContext,
): Promise<LoginResult> {
  const trimmed = identifier.trim();
  const looksLikeEmail = trimmed.includes('@');
  // Emails are matched case-insensitively; employee IDs are stored upper-case.
  const normalizedEmail = trimmed.toLowerCase();
  const normalizedId = trimmed.toUpperCase();
  // The limiter keys on one normalised form so "A@x" and "a@X" cannot be used
  // to buy two separate attempt budgets against the same account.
  const limiterKey = looksLikeEmail ? normalizedEmail : normalizedId;

  // Two limiters: one per source address (blunts a spray across many accounts),
  // one per account (blunts a focused attack from many addresses).
  // Per address, generous enough for a whole office behind one proxy signing in
  // at nine o'clock; the per-account limit and the lockout are what stop
  // guessing at a particular account.
  const perAddress = await getNumberConfig('security.login_attempts_per_ip', 100);
  assertRateLimit(`login:ip:${context.ipAddress ?? 'unknown'}`, perAddress, 300);
  assertRateLimit(`login:user:${limiterKey}`, 10, 300);

  const maxAttempts = await getNumberConfig('security.max_failed_logins', 5);
  const lockoutMinutes = await getNumberConfig('security.lockout_minutes', 15);

  const user = await prisma.user.findFirst({
    where: looksLikeEmail ? { email: normalizedEmail } : { employeeId: normalizedId },
    include: { credential: true },
  });

  if (!user || !user.credential) {
    // Spend comparable time on a missing account so response timing does not
    // reveal which employee IDs are real.
    await dummyVerify(password);
    await recordStandalone({
      actorId: null,
      actorRole: null,
      action: 'LOGIN_FAILURE',
      entity: 'User',
      entityId: null,
      // The attempted identifier is recorded so repeated probing of unknown
      // accounts is visible in the audit trail.
      after: { identifier: trimmed, reason: 'UNKNOWN_ACCOUNT' },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.correlationId,
    });
    throw new UnauthenticatedError(GENERIC_FAILURE);
  }

  const now = new Date();

  if (user.lockedUntil && user.lockedUntil > now) {
    await recordStandalone({
      actorId: user.id,
      actorRole: null,
      action: 'LOGIN_FAILURE',
      entity: 'User',
      entityId: user.id,
      after: { reason: 'ACCOUNT_LOCKED', lockedUntil: user.lockedUntil },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.correlationId,
    });
    // Deliberately the same message: telling an attacker they have locked the
    // account confirms the account exists.
    throw new UnauthenticatedError(GENERIC_FAILURE);
  }

  const passwordValid = await verifyPassword(password, user.credential.passwordHash);

  if (!passwordValid) {
    const failedAttempts = user.failedAttempts + 1;
    const shouldLock = failedAttempts >= maxAttempts;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts,
        lockedUntil: shouldLock ? new Date(now.getTime() + lockoutMinutes * 60_000) : null,
      },
    });

    await recordStandalone({
      actorId: user.id,
      actorRole: null,
      action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILURE',
      entity: 'User',
      entityId: user.id,
      after: { reason: 'BAD_PASSWORD', failedAttempts, locked: shouldLock },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.correlationId,
    });

    throw new UnauthenticatedError(GENERIC_FAILURE);
  }

  if (!user.isActive) {
    await recordStandalone({
      actorId: user.id,
      actorRole: null,
      action: 'LOGIN_FAILURE',
      entity: 'User',
      entityId: user.id,
      after: { reason: 'INACTIVE_ACCOUNT' },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.correlationId,
    });
    throw new UnauthenticatedError(GENERIC_FAILURE);
  }

  // Successful login: clear the failure counters and slide the hash forward if
  // the stored parameters are weaker than today's baseline.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: now },
  });
  resetRateLimit(`login:user:${limiterKey}`);

  const storedParams = user.credential.params as Partial<typeof CURRENT_HASH_PARAMS> | null;
  if (needsRehash(storedParams)) {
    const { hash, params } = await hashPassword(password);
    await prisma.credential.update({
      where: { userId: user.id },
      data: { passwordHash: hash, algorithm: params.algorithm, params: paramsToJson(params) },
    });
    logger.info({ userId: user.id }, 'Password hash upgraded to current parameters');
  }

  const session = await createSession(user.id, context);

  const roles = await prisma.userRole.findMany({
    where: { userId: user.id },
    include: { role: { select: { code: true } } },
  });

  await recordStandalone({
    actorId: user.id,
    actorRole: roles.map((r) => r.role.code).join(','),
    action: 'LOGIN_SUCCESS',
    entity: 'User',
    entityId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  });

  const credentialExpired = user.credential.expiresAt !== null && user.credential.expiresAt <= now;

  return {
    session,
    userId: user.id,
    mustChangePassword: user.credential.mustChange || credentialExpired,
  };
}

export async function logout(
  sessionId: string,
  userId: string,
  context: LoginContext,
): Promise<void> {
  await revokeSession(sessionId);
  await recordStandalone({
    actorId: userId,
    actorRole: null,
    action: 'LOGOUT',
    entity: 'Session',
    entityId: sessionId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  });
}

/**
 * Re-authenticate for a sensitive action (spec section 19).
 *
 * Signing a valuation must prove the person at the keyboard is the signer, not
 * merely that a session cookie is present on an unattended machine.
 */
export async function reauthenticate(
  userId: string,
  sessionId: string,
  password: string,
  context: LoginContext,
): Promise<void> {
  assertRateLimit(`reauth:${userId}`, 5, 300);

  const credential = await prisma.credential.findUnique({ where: { userId } });
  if (!credential || !(await verifyPassword(password, credential.passwordHash))) {
    await recordStandalone({
      actorId: userId,
      actorRole: null,
      action: 'LOGIN_FAILURE',
      entity: 'Session',
      entityId: sessionId,
      after: { reason: 'REAUTH_FAILED' },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.correlationId,
    });
    throw new UnauthenticatedError('The password is incorrect.');
  }

  await markReauthenticated(sessionId);
  await recordStandalone({
    actorId: userId,
    actorRole: null,
    action: 'REAUTHENTICATED',
    entity: 'Session',
    entityId: sessionId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  });
}

export interface PasswordPolicy {
  minLength: number;
  historyDepth: number;
  expiryDays: number;
  /**
   * Whether a password must mix character classes.
   *
   * Configuration rather than code (spec section 37): the bank sets the bar,
   * and raising it later is a settings change, not a deployment.
   */
  requireComplexity: boolean;
}

export async function loadPasswordPolicy(): Promise<PasswordPolicy> {
  return {
    minLength: await getNumberConfig('security.password_min_length', 6),
    historyDepth: await getNumberConfig('security.password_history', 5),
    expiryDays: await getNumberConfig('security.password_expiry_days', 90),
    requireComplexity: (await getNumberConfig('security.password_require_complexity', 0)) === 1,
  };
}

/**
 * Password rules. Returns every violation at once rather than one at a time, so
 * a user fixes their password in a single attempt instead of three.
 *
 * Both the length and whether character classes are required come from
 * configuration, so this function encodes no policy of its own (spec §37).
 */
export function validatePasswordComplexity(
  password: string,
  minLength: number,
  requireComplexity = false,
): string[] {
  const problems: string[] = [];

  if (password.length < minLength) {
    problems.push(`Must be at least ${minLength} characters long.`);
  }

  if (requireComplexity) {
    if (!/[a-z]/.test(password)) problems.push('Must contain a lower-case letter.');
    if (!/[A-Z]/.test(password)) problems.push('Must contain an upper-case letter.');
    if (!/\d/.test(password)) problems.push('Must contain a digit.');
    if (!/[^A-Za-z0-9]/.test(password)) problems.push('Must contain a symbol.');
  }

  return problems;
}

function assertMeetsPolicy(newPassword: string, policy: PasswordPolicy): void {
  const problems = validatePasswordComplexity(
    newPassword,
    policy.minLength,
    policy.requireComplexity,
  );
  if (problems.length > 0) {
    throw new ValidationError('The new password does not meet the password policy.', {
      newPassword: problems,
    });
  }
}

/** Refuse the current password and the last few, per the configured history depth. */
async function assertNotReused(
  userId: string,
  newPassword: string,
  currentHash: string | null,
  policy: PasswordPolicy,
): Promise<void> {
  if (currentHash && (await verifyPassword(newPassword, currentHash))) {
    throw new BusinessRuleError(
      'PASSWORD_REUSED',
      'The new password must differ from the current password.',
    );
  }

  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: policy.historyDepth,
  });
  for (const previous of history) {
    if (await verifyPassword(newPassword, previous.passwordHash)) {
      throw new BusinessRuleError(
        'PASSWORD_REUSED',
        `The new password must not repeat any of your last ${policy.historyDepth} passwords.`,
      );
    }
  }
}

/**
 * Store a new password, moving the one it replaces (if any) into the history.
 * Runs inside the caller's transaction.
 */
async function writePassword(
  tx: TransactionClient,
  userId: string,
  newPassword: { hash: string; params: HashParams },
  previousHash: string | null,
  policy: PasswordPolicy,
): Promise<void> {
  if (previousHash) {
    await tx.passwordHistory.create({ data: { userId, passwordHash: previousHash } });
  }

  const credential = {
    passwordHash: newPassword.hash,
    algorithm: newPassword.params.algorithm,
    params: paramsToJson(newPassword.params),
    mustChange: false,
    expiresAt: new Date(Date.now() + policy.expiryDays * 86_400_000),
  };
  await tx.credential.upsert({
    where: { userId },
    update: credential,
    create: { userId, ...credential },
  });

  // Trim history beyond the configured depth so the table does not grow
  // without limit; keep one extra as a safety margin.
  const stale = await tx.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: policy.historyDepth + 1,
    select: { id: true },
  });
  if (stale.length > 0) {
    await tx.passwordHistory.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}

export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
  context: LoginContext,
): Promise<void> {
  const policy = await loadPasswordPolicy();
  assertMeetsPolicy(newPassword, policy);

  const credential = await prisma.credential.findUnique({ where: { userId } });
  if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
    throw new UnauthenticatedError('The current password is incorrect.');
  }

  await assertNotReused(userId, newPassword, credential.passwordHash, policy);

  const hashed = await hashPassword(newPassword);
  await prisma.$transaction((tx) =>
    writePassword(tx, userId, hashed, credential.passwordHash, policy),
  );

  // A password change is the standard response to a suspected compromise, so
  // every other session for this user ends here.
  const revoked = await revokeAllSessionsForUser(userId, sessionId);

  await recordStandalone({
    actorId: userId,
    actorRole: null,
    action: 'PASSWORD_CHANGED',
    entity: 'Credential',
    entityId: userId,
    after: { otherSessionsRevoked: revoked },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  });
}

// ---------------------------------------------------------------------------
// Emailed set-up and reset links
// ---------------------------------------------------------------------------

/**
 * A new account gets a SETUP link instead of a password, and an administrator's
 * reset sends a RESET link instead of choosing one. Either way the password is
 * only ever known to its owner.
 *
 * The token is 256 random bits, sent only in the email; the database holds its
 * SHA-256, so a leaked copy of the table opens nothing. A link works once,
 * expires after `security.password_link_hours`, and is replaced by the next one
 * sent - only the latest email works.
 */

export type PasswordLinkPurpose = 'SETUP' | 'RESET';

const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const INVALID_LINK =
  'This link has expired or has already been used. Ask your administrator to send a new one.';

function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedPasswordLink {
  url: string;
  expiresAt: Date;
  hours: number;
}

/** Create a link inside the caller's transaction, retiring any still outstanding. */
export async function issuePasswordLink(
  tx: TransactionClient,
  userId: string,
  purpose: PasswordLinkPurpose,
  createdBy: string | null,
): Promise<IssuedPasswordLink> {
  const hours = await getNumberConfig('security.password_link_hours', 24);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + hours * 3_600_000);

  await tx.passwordToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });

  const token = randomBytes(32).toString('base64url');
  await tx.passwordToken.create({
    data: { userId, tokenHash: hashLinkToken(token), purpose, expiresAt, createdBy },
  });

  const url = new URL('/set-password', serverEnv.APP_URL);
  url.searchParams.set('token', token);
  return { url: url.toString(), expiresAt, hours };
}

async function findUsableLink(token: string) {
  if (!LINK_TOKEN.test(token)) return null;
  const link = await prisma.passwordToken.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: {
      id: true,
      userId: true,
      purpose: true,
      expiresAt: true,
      usedAt: true,
      user: {
        select: {
          fullName: true,
          email: true,
          isActive: true,
          credential: { select: { passwordHash: true } },
        },
      },
    },
  });
  if (!link || link.usedAt || link.expiresAt <= new Date() || !link.user.isActive) return null;
  return link;
}

/** What the set-password page shows for a link, or `null` when it cannot be used. */
export async function checkPasswordLink(
  token: string,
): Promise<{ purpose: PasswordLinkPurpose; fullName: string; email: string } | null> {
  const link = await findUsableLink(token);
  return link
    ? { purpose: link.purpose, fullName: link.user.fullName, email: link.user.email }
    : null;
}

/**
 * Set a password from an emailed link.
 *
 * The password is checked against the policy and the history before the link
 * is spent, so a rejected password does not cost the user their link. The
 * link is then consumed in the same transaction that stores the password, by a
 * conditional update, so two submissions of one link cannot both succeed.
 */
export async function completePasswordLink(
  token: string,
  newPassword: string,
  context: LoginContext,
): Promise<{ email: string }> {
  // Guessing a 256-bit token is hopeless; this only stops a script hammering the page.
  assertRateLimit(`password-link:${context.ipAddress ?? 'unknown'}`, 20, 300);

  const link = await findUsableLink(token);
  if (!link) throw new BusinessRuleError('PASSWORD_LINK_INVALID', INVALID_LINK);

  const policy = await loadPasswordPolicy();
  assertMeetsPolicy(newPassword, policy);
  const currentHash = link.user.credential?.passwordHash ?? null;
  await assertNotReused(link.userId, newPassword, currentHash, policy);

  const hashed = await hashPassword(newPassword);
  const revoked = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const consumed = await tx.passwordToken.updateMany({
      where: { id: link.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) throw new BusinessRuleError('PASSWORD_LINK_INVALID', INVALID_LINK);

    await writePassword(tx, link.userId, hashed, currentHash, policy);
    // A reset answers a forgotten or compromised password: the lockout goes,
    // and so does every session the old password opened.
    await tx.user.update({
      where: { id: link.userId },
      data: { failedAttempts: 0, lockedUntil: null },
    });
    const sessions = await tx.session.updateMany({
      where: { userId: link.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return sessions.count;
  });

  await recordStandalone({
    actorId: link.userId,
    actorRole: null,
    action: 'PASSWORD_CHANGED',
    entity: 'Credential',
    entityId: link.userId,
    after: { via: link.purpose === 'SETUP' ? 'SETUP_LINK' : 'RESET_LINK', otherSessionsRevoked: revoked },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    correlationId: context.correlationId,
  });

  return { email: link.user.email };
}
