import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import { changePassword, login, logout } from '@/server/application/auth-service';
import { hashPassword, paramsToJson } from '@/server/infrastructure/auth/password';
import { resolveSession, revokeAllSessionsForUser } from '@/server/infrastructure/auth/session';
import { __clearAllRateLimits } from '@/server/infrastructure/auth/rate-limit';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { UnauthenticatedError } from '@/lib/errors';

/**
 * Authentication and session behaviour against the real database.
 *
 * The assertions that matter most here are the negative ones: that a wrong
 * password, an unknown employee ID and a locked account are indistinguishable
 * to the caller, and that a password change actually terminates other sessions.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `auth-${Date.now()}`;
const PASSWORD = 'Integration#Test-2026';
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'vitest', correlationId: SUFFIX };

const createdUserIds: string[] = [];

async function createUser(
  label: string,
  options: { roles?: string[]; mustChange?: boolean; isActive?: boolean } = {},
) {
  const { hash, params } = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      employeeId: `EMP-${SUFFIX}-${label}`.toUpperCase(),
      email: `${label}.${SUFFIX}@test.invalid`,
      fullName: `Auth Test ${label}`,
      discipline: 'CIVIL',
      isActive: options.isActive ?? true,
      credential: {
        create: {
          passwordHash: hash,
          algorithm: params.algorithm,
          params: paramsToJson(params),
          mustChange: options.mustChange ?? false,
        },
      },
    },
  });
  createdUserIds.push(user.id);

  for (const roleCode of options.roles ?? []) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }

  return user;
}

describeIfDb('authentication', () => {
  beforeEach(() => {
    // The limiter is in-process; clearing it keeps one test's failed attempts
    // from throttling the next.
    __clearAllRateLimits();
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.passwordHistory.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.credential.deleteMany({ where: { userId: { in: createdUserIds } } });

    /**
     * These users are deactivated rather than deleted, because they now have
     * audit history and `audit_logs.actorId` is ON DELETE RESTRICT. That is the
     * intended lifecycle - a user who has acted in the system is never removed,
     * or the audit trail would lose the identity behind an action - so the
     * fixture follows it instead of working around it. Their credentials and
     * sessions are gone, so they cannot be used to sign in.
     */
    await prisma.user.updateMany({
      where: { id: { in: createdUserIds } },
      data: { isActive: false, fullName: 'Deactivated integration-test account' },
    });

    await prisma.$disconnect();
  });

  describe('login', () => {
    it('issues a session for correct credentials', async () => {
      const user = await createUser('ok');
      const result = await login(user.employeeId, PASSWORD, CONTEXT);

      expect(result.userId).toBe(user.id);
      expect(result.session.token).toBeTruthy();
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      // The absolute expiry is a hard ceiling the idle window cannot slide past.
      expect(result.session.absoluteExpiresAt.getTime()).toBeGreaterThan(
        result.session.expiresAt.getTime(),
      );
    });

    it('signs in with the institutional email address', async () => {
      // The Board Governance Portal signs staff in by email, so this system
      // accepts the same credential rather than a second identifier.
      const user = await createUser('byemail');
      const result = await login(user.email, PASSWORD, CONTEXT);
      expect(result.userId).toBe(user.id);
    });

    it('matches the email address case-insensitively', async () => {
      const user = await createUser('emailcase');
      const result = await login(user.email.toUpperCase(), PASSWORD, CONTEXT);
      expect(result.userId).toBe(user.id);
    });

    it('still accepts an employee ID for seeded and service accounts', async () => {
      const user = await createUser('byid');
      const result = await login(user.employeeId, PASSWORD, CONTEXT);
      expect(result.userId).toBe(user.id);
    });

    it('gives nothing away for an unknown email address', async () => {
      const message = await login('nobody@nibbank.com.et', PASSWORD, CONTEXT).catch(
        (e: Error) => e.message,
      );
      expect(message).toBe('The email address or password is incorrect.');
    });

    it('is case-insensitive on the identifier but not the password', async () => {
      const user = await createUser('case');
      await expect(login(user.employeeId.toLowerCase(), PASSWORD, CONTEXT)).resolves.toBeTruthy();
      await expect(login(user.employeeId, PASSWORD.toLowerCase(), CONTEXT)).rejects.toThrow(
        UnauthenticatedError,
      );
    });

    it('gives the same message for a wrong password and an unknown account', async () => {
      const user = await createUser('generic');

      const wrongPassword = await login(user.employeeId, 'Wrong#Password-1', CONTEXT).catch(
        (e: Error) => e.message,
      );
      const unknownAccount = await login('EMP-DOES-NOT-EXIST', PASSWORD, CONTEXT).catch(
        (e: Error) => e.message,
      );

      expect(wrongPassword).toBe(unknownAccount);
    });

    it('refuses a deactivated account without saying so', async () => {
      const user = await createUser('inactive', { isActive: false });
      const message = await login(user.employeeId, PASSWORD, CONTEXT).catch((e: Error) => e.message);
      expect(message).toBe('The email address or password is incorrect.');
    });

    it('reports that an initial password must be changed', async () => {
      const user = await createUser('mustchange', { mustChange: true });
      const result = await login(user.employeeId, PASSWORD, CONTEXT);
      expect(result.mustChangePassword).toBe(true);
    });

    it('records both successful and failed attempts in the audit trail', async () => {
      const user = await createUser('audited');
      await login(user.employeeId, PASSWORD, CONTEXT);
      await login(user.employeeId, 'Wrong#Password-1', CONTEXT).catch(() => undefined);

      const entries = await prisma.auditLog.findMany({
        where: { actorId: user.id, action: { in: ['LOGIN_SUCCESS', 'LOGIN_FAILURE'] } },
      });
      expect(entries.map((e) => e.action).sort()).toEqual(['LOGIN_FAILURE', 'LOGIN_SUCCESS']);
    });
  });

  describe('account lockout', () => {
    it('locks the account after the configured number of failures', async () => {
      const user = await createUser('lockout');

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(user.employeeId, 'Wrong#Password-1', CONTEXT).catch(() => undefined);
      }

      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(locked.failedAttempts).toBe(5);
      expect(locked.lockedUntil).not.toBeNull();
      expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      // Even the correct password is refused while the lock holds, and the
      // message stays generic so the lock is not confirmed to an attacker.
      const message = await login(user.employeeId, PASSWORD, CONTEXT).catch((e: Error) => e.message);
      expect(message).toBe('The email address or password is incorrect.');

      const lockEntry = await prisma.auditLog.findFirst({
        where: { actorId: user.id, action: 'ACCOUNT_LOCKED' },
      });
      expect(lockEntry).not.toBeNull();
    });

    it('clears the failure counter after a successful login', async () => {
      const user = await createUser('counter');
      await login(user.employeeId, 'Wrong#Password-1', CONTEXT).catch(() => undefined);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedAttempts).toBe(1);

      await login(user.employeeId, PASSWORD, CONTEXT);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.failedAttempts).toBe(0);
      expect(after.lastLoginAt).not.toBeNull();
    });
  });

  describe('session resolution', () => {
    it('resolves a token to an actor carrying that role\'s permissions', async () => {
      const user = await createUser('maker', { roles: ['MAKER'] });
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);

      const resolved = await resolveSession(session.token);
      expect(resolved).not.toBeNull();
      expect(resolved!.actor.id).toBe(user.id);
      expect(resolved!.actor.roles).toEqual(['MAKER']);
      expect(resolved!.actor.permissions.has(PERMISSIONS.VALUATION_SUBMIT)).toBe(true);
      // A maker holds no approval rights, whatever the UI might offer.
      expect(resolved!.actor.permissions.has(PERMISSIONS.APPROVAL_MANAGER)).toBe(false);
    });

    it('returns null for an unknown or malformed token', async () => {
      expect(await resolveSession('not-a-real-token')).toBeNull();
      expect(await resolveSession(undefined)).toBeNull();
    });

    it('stops resolving once the session is revoked', async () => {
      const user = await createUser('revoke', { roles: ['MAKER'] });
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);
      expect(await resolveSession(session.token)).not.toBeNull();

      await logout(session.sessionId, user.id, CONTEXT);
      expect(await resolveSession(session.token)).toBeNull();
    });

    it('stops resolving the moment the user is deactivated', async () => {
      // Central revocation is the reason sessions are database records rather
      // than self-contained tokens.
      const user = await createUser('deactivate', { roles: ['MAKER'] });
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);
      expect(await resolveSession(session.token)).not.toBeNull();

      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      expect(await resolveSession(session.token)).toBeNull();
    });

    it('does not store the session token itself', async () => {
      const user = await createUser('hashed');
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);

      const stored = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
      expect(stored.tokenHash).not.toBe(session.token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('revokes every session for a user in one call', async () => {
      const user = await createUser('multi');
      const first = await login(user.employeeId, PASSWORD, CONTEXT);
      const second = await login(user.employeeId, PASSWORD, CONTEXT);

      const revoked = await revokeAllSessionsForUser(user.id);
      expect(revoked).toBe(2);
      expect(await resolveSession(first.session.token)).toBeNull();
      expect(await resolveSession(second.session.token)).toBeNull();
    });
  });

  describe('password change', () => {
    it('rejects a new password that fails the policy', async () => {
      const user = await createUser('weak');
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);

      await expect(
        changePassword(user.id, session.sessionId, PASSWORD, 'short', CONTEXT),
      ).rejects.toThrow(/password policy/);
    });

    it('rejects the current password as the new one', async () => {
      const user = await createUser('same');
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);

      await expect(
        changePassword(user.id, session.sessionId, PASSWORD, PASSWORD, CONTEXT),
      ).rejects.toThrow(/must differ/);
    });

    it('rejects a password reused from history', async () => {
      const user = await createUser('history');
      const { session } = await login(user.employeeId, PASSWORD, CONTEXT);
      const second = 'Integration#Test-2027';

      await changePassword(user.id, session.sessionId, PASSWORD, second, CONTEXT);
      await expect(
        changePassword(user.id, session.sessionId, second, PASSWORD, CONTEXT),
      ).rejects.toThrow(/must not repeat/);
    });

    it('changes the password, clears must-change, and ends other sessions', async () => {
      const user = await createUser('rotate', { mustChange: true });
      const keep = await login(user.employeeId, PASSWORD, CONTEXT);
      const other = await login(user.employeeId, PASSWORD, CONTEXT);
      const newPassword = 'Integration#Test-2028';

      await changePassword(user.id, keep.session.sessionId, PASSWORD, newPassword, CONTEXT);

      // The session that performed the change survives; the other does not.
      expect(await resolveSession(keep.session.token)).not.toBeNull();
      expect(await resolveSession(other.session.token)).toBeNull();

      __clearAllRateLimits();
      const relogin = await login(user.employeeId, newPassword, CONTEXT);
      expect(relogin.mustChangePassword).toBe(false);

      await expect(login(user.employeeId, PASSWORD, CONTEXT)).rejects.toThrow(UnauthenticatedError);
    });
  });
});
