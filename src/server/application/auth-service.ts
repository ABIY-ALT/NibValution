import { prisma } from '@/server/infrastructure/db/client';
import {
  CURRENT_HASH_PARAMS,
  dummyVerify,
  hashPassword,
  needsRehash,
  paramsToJson,
  verifyPassword,
} from '@/server/infrastructure/auth/password';
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

export async function changePassword(
  userId: string,
  sessionId: string,
  currentPassword: string,
  newPassword: string,
  context: LoginContext,
): Promise<void> {
  const policy = await loadPasswordPolicy();

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

  const credential = await prisma.credential.findUnique({ where: { userId } });
  if (!credential || !(await verifyPassword(currentPassword, credential.passwordHash))) {
    throw new UnauthenticatedError('The current password is incorrect.');
  }

  if (await verifyPassword(newPassword, credential.passwordHash)) {
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

  const { hash, params } = await hashPassword(newPassword);
  const expiresAt = new Date(Date.now() + policy.expiryDays * 86_400_000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordHistory.create({
      data: { userId, passwordHash: credential.passwordHash },
    });
    await tx.credential.update({
      where: { userId },
      data: {
        passwordHash: hash,
        algorithm: params.algorithm,
        params: paramsToJson(params),
        mustChange: false,
        expiresAt,
      },
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
  });

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
