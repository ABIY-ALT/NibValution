import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/infrastructure/db/client';
import {
  createUser,
  revokeUserSessions,
  sendPasswordLink,
  updateUserProfile,
} from '@/server/application/admin-service';
import {
  checkPasswordLink,
  completePasswordLink,
  login,
} from '@/server/application/auth-service';
import { createSession } from '@/server/infrastructure/auth/session';
import { __clearAllRateLimits } from '@/server/infrastructure/auth/rate-limit';
import { ALL_PERMISSIONS } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { CreateUserInput } from '@/lib/validation/admin';
import {
  BusinessRuleError,
  UnauthenticatedError,
  ValidationError,
} from '@/lib/errors';

/**
 * Account administration against the real database: opening an account,
 * editing it, sending set-up and reset links, and ending sessions.
 *
 * The assertions that matter most are about the links: a new account cannot
 * sign in until its owner uses the set-up link, a link works exactly once, a
 * newer link retires the older one, and an administrator's reset does not lock
 * anyone out until the new password is actually chosen.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `um-${Date.now()}`;
const CONTEXT = { ipAddress: '10.0.0.1', userAgent: 'vitest', correlationId: SUFFIX };
const FIRST_PASSWORD = 'Valuation#Setup-2026';
const SECOND_PASSWORD = 'Valuation#Reset-2026';

// The audit trail has a foreign key to the acting user, so the actor borrows a
// real account rather than inventing an id.
let actorId = '';
const admin = (): Actor => ({
  id: actorId,
  fullName: 'User Management Test',
  roles: ['ADMIN'],
  permissions: new Set(ALL_PERMISSIONS) as Actor['permissions'],
  organizationId: null,
  departmentId: null,
  discipline: 'BOTH',
  isActive: true,
  organizationScope: [],
});

const createdUserIds: string[] = [];

function input(label: string, overrides: Partial<CreateUserInput> = {}): CreateUserInput {
  return {
    employeeId: `UM-${SUFFIX}-${label}`.toUpperCase(),
    fullName: `User Management ${label}`,
    email: `${label}.${SUFFIX}@test.invalid`,
    phone: null,
    organizationId: null,
    departmentId: null,
    discipline: 'CIVIL',
    roles: [],
    sendEmail: false,
    ...overrides,
  };
}

const tokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';

async function newUser(label: string, overrides: Partial<CreateUserInput> = {}) {
  const issued = await createUser(admin(), input(label, overrides), CONTEXT);
  createdUserIds.push(issued.userId);
  return issued;
}

/** A user who has already used their set-up link. */
async function setUpUser(label: string) {
  const issued = await newUser(label);
  await completePasswordLink(tokenOf(issued.url), FIRST_PASSWORD, CONTEXT);
  return prisma.user.findUniqueOrThrow({ where: { id: issued.userId } });
}

describeIfDb('user management', () => {
  beforeAll(async () => {
    const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!user) throw new Error('The database has no users; run the seed first.');
    actorId = user.id;
  });

  beforeEach(() => {
    __clearAllRateLimits();
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.passwordToken.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.passwordHistory.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.credential.deleteMany({ where: { userId: { in: createdUserIds } } });
    // Deactivated rather than deleted: they now have audit history, and
    // audit_logs keeps the identity behind an action (ON DELETE RESTRICT).
    await prisma.user.updateMany({
      where: { id: { in: createdUserIds } },
      data: { isActive: false, fullName: 'Deactivated integration-test account' },
    });
    await prisma.$disconnect();
  });

  it('opens an account that cannot sign in until its owner uses the set-up link', async () => {
    const issued = await newUser('create', { roles: ['MAKER'] });
    expect(issued.purpose).toBe('SETUP');
    expect(issued.email).toBe('skipped');
    expect(issued.hours).toBeGreaterThan(0);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: issued.userId },
      include: { credential: true, roles: { include: { role: true } } },
    });
    expect(stored.credential).toBeNull();
    expect(stored.roles.map((r) => r.role.code)).toEqual(['MAKER']);

    // Only the hash of the token is stored.
    const token = tokenOf(issued.url);
    const row = await prisma.passwordToken.findFirstOrThrow({ where: { userId: stored.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.purpose).toBe('SETUP');

    await expect(checkPasswordLink(token)).resolves.toMatchObject({
      purpose: 'SETUP',
      email: stored.email,
    });

    await completePasswordLink(token, FIRST_PASSWORD, CONTEXT);
    const result = await login(stored.email, FIRST_PASSWORD, CONTEXT);
    expect(result.mustChangePassword).toBe(false);

    // A link works once.
    await expect(checkPasswordLink(token)).resolves.toBeNull();
    await expect(completePasswordLink(token, SECOND_PASSWORD, CONTEXT)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: issued.userId, action: 'USER_CREATED' },
    });
    expect(audit?.after).toMatchObject({ roles: ['MAKER'], discipline: 'CIVIL' });
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('refuses an employee ID or email another account holds, naming the field', async () => {
    await newUser('taken');
    const error = await createUser(admin(), input('taken'), CONTEXT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors).sort()).toEqual([
      'email',
      'employeeId',
    ]);
  });

  it('edits the details and audits the change by name', async () => {
    const { userId } = await newUser('edit');
    const department = await prisma.department.findFirstOrThrow({ where: { isActive: true } });

    await updateUserProfile(
      admin(),
      userId,
      {
        ...input('edit'),
        fullName: 'User Management Edited',
        phone: '+251 911 000 000',
        departmentId: department.id,
        discipline: 'BOTH',
      },
      CONTEXT,
    );

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.fullName).toBe('User Management Edited');
    expect(stored.departmentId).toBe(department.id);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'User', entityId: userId, action: 'USER_UPDATED' },
    });
    expect(audit?.after).toEqual({
      fullName: 'User Management Edited',
      phone: '+251 911 000 000',
      department: department.name,
      discipline: 'BOTH',
    });
  });

  it('will not move an email address onto a second account', async () => {
    await newUser('owner');
    const { userId } = await newUser('thief');
    await expect(
      updateUserProfile(
        admin(),
        userId,
        { ...input('thief'), email: `owner.${SUFFIX}@test.invalid` },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sends a reset link that changes nothing until the user chooses a new password', async () => {
    const user = await setUpUser('reset');
    const before = await prisma.credential.findUniqueOrThrow({ where: { userId: user.id } });
    const session = await createSession(user.id, CONTEXT);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 5, lockedUntil: new Date(Date.now() + 15 * 60_000) },
    });

    // The test environment pins MAIL_DRIVER=log, so nothing is delivered.
    const issued = await sendPasswordLink(admin(), user.id, { sendEmail: true }, CONTEXT);
    expect(issued.purpose).toBe('RESET');
    expect(issued.email).toBe('disabled');

    // Sending the link alone touches neither the password nor the sessions.
    const unchanged = await prisma.credential.findUniqueOrThrow({ where: { userId: user.id } });
    expect(unchanged.passwordHash).toBe(before.passwordHash);
    const stillLive = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(stillLive.revokedAt).toBeNull();

    await completePasswordLink(tokenOf(issued.url), SECOND_PASSWORD, CONTEXT);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.lockedUntil).toBeNull();
    expect(after.failedAttempts).toBe(0);
    const revoked = await prisma.session.findUniqueOrThrow({ where: { id: session.sessionId } });
    expect(revoked.revokedAt).not.toBeNull();

    await expect(login(user.email, FIRST_PASSWORD, CONTEXT)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    __clearAllRateLimits();
    await expect(login(user.email, SECOND_PASSWORD, CONTEXT)).resolves.toMatchObject({
      mustChangePassword: false,
    });

    expect(await prisma.passwordHistory.count({ where: { userId: user.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Credential', entityId: user.id, action: 'PASSWORD_CHANGED' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit?.after).toMatchObject({ via: 'RESET_LINK', otherSessionsRevoked: 1 });
  });

  it('keeps the link when the chosen password is refused', async () => {
    const user = await setUpUser('weak');
    const { url } = await sendPasswordLink(admin(), user.id, { sendEmail: false }, CONTEXT);

    await expect(completePasswordLink(tokenOf(url), 'x', CONTEXT)).rejects.toBeInstanceOf(
      ValidationError,
    );
    // The current password is in the history check too.
    await expect(
      completePasswordLink(tokenOf(url), FIRST_PASSWORD, CONTEXT),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await expect(checkPasswordLink(tokenOf(url))).resolves.not.toBeNull();
    await completePasswordLink(tokenOf(url), SECOND_PASSWORD, CONTEXT);
  });

  it('retires an older link when a newer one is sent, and refuses an expired one', async () => {
    const { userId, url: first } = await newUser('relink');
    const second = await sendPasswordLink(admin(), userId, { sendEmail: false }, CONTEXT);
    expect(second.purpose).toBe('SETUP');

    await expect(checkPasswordLink(tokenOf(first))).resolves.toBeNull();
    await expect(checkPasswordLink(tokenOf(second.url))).resolves.not.toBeNull();

    await prisma.passwordToken.updateMany({
      where: { userId, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(checkPasswordLink(tokenOf(second.url))).resolves.toBeNull();
  });

  it('will not send a link to a deactivated account, nor to the administrator themselves', async () => {
    const { userId } = await newUser('inactive');
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    await expect(
      sendPasswordLink(admin(), userId, { sendEmail: false }, CONTEXT),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    await expect(
      sendPasswordLink(admin(), actorId, { sendEmail: false }, CONTEXT),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(revokeUserSessions(admin(), actorId, CONTEXT)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
  });

  it('signs a user out everywhere without touching the account', async () => {
    const { userId } = await newUser('signout');
    await createSession(userId, CONTEXT);
    await createSession(userId, CONTEXT);

    expect(await revokeUserSessions(admin(), userId, CONTEXT)).toBe(2);
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.isActive).toBe(true);
  });
});
