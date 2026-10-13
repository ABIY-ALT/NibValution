import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { record, diff } from '@/server/infrastructure/audit/audit-service';
import { withTransaction, type TransactionClient } from '@/server/infrastructure/db/client';
import { invalidateConfigurationCache } from './configuration-service';
import { assertPermission, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { validateThresholdSet } from '@/server/domain/approval/routing';
import { GUIDELINE_PREFIX, isGuidelineKey } from '@/server/domain/valuation/civil/guideline';
import { dec } from '@/lib/money';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getMailer } from '@/server/infrastructure/messaging';
import { brandedEmail } from '@/server/infrastructure/messaging/branded-email';
import {
  issuePasswordLink,
  type IssuedPasswordLink,
  type PasswordLinkPurpose,
} from './auth-service';
import {
  deriveCode,
  type CreateDocumentCategoryInput,
  type CreatePropertyCategoryInput,
  type CreateRequestTypeInput,
  type CreateRoleInput,
  type CreateUserInput,
  type UserProfileInput,
} from '@/lib/validation/admin';
import type { PublishParameterInput } from '@/lib/validation/parameters';
import type { Discipline, RoleCode } from '@/server/domain/shared/enums';

/**
 * Administration use cases (spec section 31).
 *
 * Two rules run through every function here:
 *
 *  * Each begins with `assertPermission`, so a caller who reached the page by
 *    guessing its URL is refused regardless of what the navigation showed them.
 *  * Each write happens inside a transaction that also records the before and
 *    after values, because section 25 requires configuration changes to be
 *    auditable and rule 11 requires the two to be atomic.
 */

export interface AuditContextInput {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

function contextFor(actor: Actor, ctx: AuditContextInput) {
  return {
    actorId: actor.id,
    actorRole: actor.roles.join(','),
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
    correlationId: ctx.correlationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserListFilter {
  search?: string;
  role?: RoleCode;
  discipline?: Discipline;
  /** `locked` and `mustChange` are states, not columns, so they filter here. */
  status?: 'active' | 'inactive' | 'locked' | 'mustChange';
  page?: number;
  pageSize?: number;
}

const USER_SELECT = {
  id: true,
  employeeId: true,
  email: true,
  fullName: true,
  phone: true,
  discipline: true,
  isActive: true,
  lockedUntil: true,
  lastLoginAt: true,
  organization: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, code: true, name: true } },
  roles: { select: { role: { select: { code: true, name: true } } } },
  credential: { select: { mustChange: true, expiresAt: true } },
  _count: { select: { makerCases: true, checkerCases: true } },
} as const;

/**
 * The user directory, paged.
 *
 * This used to return every account in one query. On a live directory that is
 * over a thousand rows in a single table, each carrying an expandable role
 * editor - unusable, and a page weight that grows without bound. Searching and
 * paging happen in the database so the page cost stays flat.
 */
export async function listUsers(actor: Actor, filter: UserListFilter = {}) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filter.pageSize ?? 25));
  const search = filter.search?.trim();
  const now = new Date();

  const where: Prisma.UserWhereInput = {
    AND: [
      search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { employeeId: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {},
      filter.role ? { roles: { some: { role: { code: filter.role } } } } : {},
      filter.discipline ? { discipline: filter.discipline } : {},
      filter.status === 'active' ? { isActive: true } : {},
      filter.status === 'inactive' ? { isActive: false } : {},
      filter.status === 'locked' ? { lockedUntil: { gt: now } } : {},
      filter.status === 'mustChange' ? { credential: { is: { mustChange: true } } } : {},
    ],
  };

  const [rows, total, activeCount, lockedCount, mustChangeCount, totalAll] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { employeeId: 'asc' }],
      select: USER_SELECT,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
    // The headline figures describe the whole directory, not the current page,
    // so they are counted independently of the filter.
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { lockedUntil: { gt: now } } }),
    prisma.user.count({ where: { credential: { is: { mustChange: true } } } }),
    prisma.user.count(),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    stats: {
      total: totalAll,
      active: activeCount,
      inactive: totalAll - activeCount,
      locked: lockedCount,
      mustChange: mustChangeCount,
    },
  };
}

export type AdminUser = Awaited<ReturnType<typeof listUsers>>['rows'][number];

export async function setUserActive(
  actor: Actor,
  userId: string,
  isActive: boolean,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  if (userId === actor.id && !isActive) {
    // Locking yourself out of the only administrator account is not a decision
    // the system should let you make by accident.
    throw new BusinessRuleError(
      'SELF_DEACTIVATION',
      'You cannot deactivate your own account. Ask another administrator to do it.',
    );
  }

  await withTransaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, employeeId: true, isActive: true },
    });
    if (!before) throw new NotFoundError('The user was not found.');

    const after = await tx.user.update({
      where: { id: userId },
      data: { isActive, ...(isActive ? { failedAttempts: 0, lockedUntil: null } : {}) },
      select: { id: true, employeeId: true, isActive: true },
    });

    // Deactivation must end live sessions immediately, which is the reason
    // sessions are database records rather than self-contained tokens.
    if (!isActive) {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const changes = diff(before, after);
    await record(tx, {
      ...contextFor(actor, ctx),
      action: isActive ? 'USER_UPDATED' : 'USER_DEACTIVATED',
      entity: 'User',
      entityId: userId,
      before: changes.before,
      after: changes.after,
    });
  });
}

export async function unlockUser(
  actor: Actor,
  userId: string,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  await withTransaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, failedAttempts: true, lockedUntil: true },
    });
    if (!before) throw new NotFoundError('The user was not found.');

    await tx.user.update({
      where: { id: userId },
      data: { failedAttempts: 0, lockedUntil: null },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: userId,
      before: { lockedUntil: before.lockedUntil, failedAttempts: before.failedAttempts },
      after: { lockedUntil: null, failedAttempts: 0 },
    });
  });
}

export async function setUserRoles(
  actor: Actor,
  userId: string,
  roleCodes: RoleCode[],
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.ROLE_MANAGE);

  await withTransaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { select: { code: true } } } } },
    });
    if (!user) throw new NotFoundError('The user was not found.');

    const beforeCodes = user.roles.map((r) => r.role.code).sort();
    const roles = await tx.role.findMany({ where: { code: { in: roleCodes } } });
    if (roles.length !== roleCodes.length) {
      throw new BusinessRuleError(
        'UNKNOWN_ROLE',
        'One or more of the selected roles do not exist.',
      );
    }

    await tx.userRole.deleteMany({ where: { userId } });
    for (const role of roles) {
      await tx.userRole.create({ data: { userId, roleId: role.id, assignedBy: actor.id } });
    }

    // Role changes take effect on the user's next request: the permission set
    // is resolved per request, not cached for the life of the session.
    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'ROLE_GRANTED',
      entity: 'User',
      entityId: userId,
      before: { roles: beforeCodes },
      after: { roles: [...roleCodes].sort() },
    });
  });
}

export async function setUserDiscipline(
  actor: Actor,
  userId: string,
  discipline: Discipline,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  await withTransaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, discipline: true },
    });
    if (!before) throw new NotFoundError('The user was not found.');

    await tx.user.update({ where: { id: userId }, data: { discipline } });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: userId,
      before: { discipline: before.discipline },
      after: { discipline },
    });
  });
}

export async function listRolesForAssignment(actor: Actor) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  return prisma.role.findMany({ orderBy: { code: 'asc' }, select: { code: true, name: true } });
}

/** The units and departments an account can be placed in. */
export async function listUserFormOptions(actor: Actor) {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  const [organizations, departments] = await Promise.all([
    prisma.organization.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true },
    }),
    prisma.department.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  return { organizations, departments };
}

const PROFILE_SELECT = {
  employeeId: true,
  fullName: true,
  email: true,
  phone: true,
  discipline: true,
  organization: { select: { name: true } },
  department: { select: { name: true } },
} as const;

/** The account as the audit trail records it: names a reader recognises, not foreign keys. */
function profileSnapshot(user: Prisma.UserGetPayload<{ select: typeof PROFILE_SELECT }>) {
  return {
    employeeId: user.employeeId,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    discipline: user.discipline,
    organization: user.organization?.name ?? null,
    department: user.department?.name ?? null,
  };
}

/** Exactly the editable columns, whatever else the caller's object carries. */
function profileData(input: UserProfileInput) {
  return {
    employeeId: input.employeeId,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    organizationId: input.organizationId,
    departmentId: input.departmentId,
    discipline: input.discipline,
  };
}

/**
 * Refuse an employee ID or email address another account already holds, and a
 * unit or department that does not exist - as field errors, so the form can say
 * which field is wrong instead of failing on a database constraint.
 */
async function assertProfileAvailable(
  tx: TransactionClient,
  input: UserProfileInput,
  exceptUserId?: string,
): Promise<void> {
  const errors: Record<string, string[]> = {};

  const clashes = await tx.user.findMany({
    where: {
      OR: [
        { employeeId: input.employeeId },
        { email: { equals: input.email, mode: 'insensitive' } },
      ],
      ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
    },
    select: { employeeId: true, email: true, fullName: true },
  });
  for (const clash of clashes) {
    if (clash.employeeId === input.employeeId) {
      errors.employeeId = [`${clash.fullName} already has this employee ID.`];
    }
    if (clash.email.toLowerCase() === input.email) {
      errors.email = [`${clash.fullName} already uses this email address.`];
    }
  }

  if (input.organizationId) {
    const found = await tx.organization.count({ where: { id: input.organizationId } });
    if (found === 0) errors.organizationId = ['That unit no longer exists. Choose another.'];
  }
  if (input.departmentId) {
    const found = await tx.department.count({ where: { id: input.departmentId } });
    if (found === 0) errors.departmentId = ['That department no longer exists. Choose another.'];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Please correct the highlighted fields.', errors);
  }
}

export async function updateUserProfile(
  actor: Actor,
  userId: string,
  input: UserProfileInput,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  await withTransaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
    if (!current) throw new NotFoundError('The user was not found.');

    await assertProfileAvailable(tx, input, userId);

    const updated = await tx.user.update({
      where: { id: userId },
      data: profileData(input),
      select: PROFILE_SELECT,
    });

    const changes = diff(profileSnapshot(current), profileSnapshot(updated));
    // Saving an unchanged form is not an event worth an audit row.
    if (Object.keys(changes.after).length === 0) return;

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'USER_UPDATED',
      entity: 'User',
      entityId: userId,
      before: changes.before,
      after: changes.after,
    });
  });
}

/**
 * A set-up or reset link just issued for an account.
 *
 * The URL is handed back so the administrator can pass it on when the email
 * was not sent; it is never stored, logged or audited.
 */
export interface IssuedLink {
  userId: string;
  /** The account's email address, where the link went if it was sent. */
  address: string;
  purpose: PasswordLinkPurpose;
  url: string;
  /** How long the link stays valid. */
  hours: number;
  /** What happened to the email, when one was asked for. */
  email: 'sent' | 'failed' | 'disabled' | 'skipped';
}

/**
 * Open an account for a member of staff.
 *
 * The account has no password until its owner sets one from the emailed link,
 * so the administrator never chooses - and never knows - it. Until then it
 * cannot be signed in to at all.
 */
export async function createUser(
  actor: Actor,
  input: CreateUserInput,
  ctx: AuditContextInput,
): Promise<IssuedLink> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);
  if (input.roles.length > 0) assertPermission(actor, PERMISSIONS.ROLE_MANAGE);

  const { roles: roleCodes, sendEmail, ...profile } = input;

  const { user, link } = await withTransaction(async (tx) => {
    await assertProfileAvailable(tx, profile);

    const roles = await tx.role.findMany({
      where: { code: { in: roleCodes } },
      select: { id: true, code: true },
    });
    if (roles.length !== new Set(roleCodes).size) {
      throw new BusinessRuleError(
        'UNKNOWN_ROLE',
        'One or more of the selected roles do not exist.',
      );
    }

    const created = await tx.user.create({
      data: {
        ...profileData(profile),
        roles: { create: roles.map((role) => ({ roleId: role.id, assignedBy: actor.id })) },
      },
      select: { id: true, ...PROFILE_SELECT },
    });

    const issued = await issuePasswordLink(tx, created.id, 'SETUP', actor.id);

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'USER_CREATED',
      entity: 'User',
      entityId: created.id,
      before: null,
      after: {
        ...profileSnapshot(created),
        roles: roles.map((role) => role.code).sort(),
        setupLinkEmailed: sendEmail,
      },
    });

    return { user: created, link: issued };
  });

  return {
    userId: user.id,
    address: user.email,
    purpose: 'SETUP',
    url: link.url,
    hours: link.hours,
    email: sendEmail ? await sendPasswordLinkEmail(user, 'SETUP', link) : 'skipped',
  };
}

/**
 * Send a user a link to choose a new password.
 *
 * Their current password keeps working until they use the link - an
 * administrator's reset must not lock out someone who never asked for it.
 * Setting the new password is what ends their sessions and clears a lockout.
 * An account whose owner never set a password gets a fresh set-up link instead.
 */
export async function sendPasswordLink(
  actor: Actor,
  userId: string,
  options: { sendEmail: boolean },
  ctx: AuditContextInput,
): Promise<IssuedLink> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  if (userId === actor.id) {
    throw new BusinessRuleError(
      'SELF_PASSWORD_RESET',
      'Use "Change password" to change your own password.',
    );
  }

  const { user, purpose, link } = await withTransaction(async (tx) => {
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { fullName: true, email: true, isActive: true, credential: { select: { id: true } } },
    });
    if (!target) throw new NotFoundError('The user was not found.');
    if (!target.isActive) {
      throw new BusinessRuleError(
        'USER_INACTIVE',
        'This account is deactivated. Activate it before sending a password link.',
      );
    }

    const kind: PasswordLinkPurpose = target.credential ? 'RESET' : 'SETUP';
    const issued = await issuePasswordLink(tx, userId, kind, actor.id);

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'PASSWORD_RESET_REQUESTED',
      entity: 'Credential',
      entityId: userId,
      before: null,
      after: { purpose: kind, validHours: issued.hours, emailRequested: options.sendEmail },
    });

    return { user: target, purpose: kind, link: issued };
  });

  return {
    userId,
    address: user.email,
    purpose,
    url: link.url,
    hours: link.hours,
    email: options.sendEmail ? await sendPasswordLinkEmail(user, purpose, link) : 'skipped',
  };
}

/** End every live session of a user - "sign out everywhere" - without touching the account. */
export async function revokeUserSessions(
  actor: Actor,
  userId: string,
  ctx: AuditContextInput,
): Promise<number> {
  assertPermission(actor, PERMISSIONS.USER_MANAGE);

  if (userId === actor.id) {
    throw new BusinessRuleError(
      'SELF_SESSION_REVOKE',
      'Use "Sign out" to end your own session.',
    );
  }

  return withTransaction(async (tx) => {
    const exists = await tx.user.count({ where: { id: userId } });
    if (exists === 0) throw new NotFoundError('The user was not found.');

    const revoked = await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'SESSIONS_REVOKED',
      entity: 'User',
      entityId: userId,
      after: { sessionsRevoked: revoked.count },
    });

    return revoked.count;
  });
}

/**
 * Email a set-up or reset link to its owner, in the bank's account-email design.
 *
 * Sent after the transaction commits: a mail relay that is down must not undo
 * the change, and the administrator is handed the link to pass on another way.
 * The log driver records only the recipient and subject, never the body, so the
 * link does not reach the server log either.
 */
async function sendPasswordLinkEmail(
  user: { fullName: string; email: string },
  purpose: PasswordLinkPurpose,
  link: IssuedPasswordLink,
): Promise<IssuedLink['email']> {
  const mailer = getMailer();
  if (mailer.name === 'log') return 'disabled';

  const validFor = link.hours === 1 ? '1 hour' : `${link.hours} hours`;
  const message =
    purpose === 'SETUP'
      ? brandedEmail({
          to: user.email,
          subject: 'Set Up Your NIB Property Valuation Password',
          heading: 'Activate Your Account',
          greeting: `Hello ${user.fullName},`,
          paragraphs: [
            'Your account has been created on the NIB Property Valuation System.',
            `You sign in with your email address: ${user.email}`,
            'Click the button below to set your password and activate your account.',
          ],
          strong: [user.email, validFor],
          validity: `This link is valid for ${validFor} and can only be used once.`,
          action: { label: 'Set Up My Password', url: link.url },
          note: 'If you did not expect this email, please contact your IT administrator immediately. Do not share this link with anyone.',
        })
      : brandedEmail({
          to: user.email,
          subject: 'Your NIB Property Valuation Password Reset Request',
          heading: 'Your Password Reset Request',
          greeting: `Hello ${user.fullName},`,
          paragraphs: [
            'An administrator has initiated a password reset for your NIB Property Valuation System account.',
            'You can reset your password by clicking the link below.',
          ],
          strong: [validFor],
          validity: `This link is valid for ${validFor} and can only be used once.`,
          action: { label: 'Reset Your Password', url: link.url },
          note: 'If you did not expect this reset, you can safely ignore this email or contact IT security. Your current password keeps working until you choose a new one.',
        });

  try {
    await mailer.send(message);
    return 'sent';
  } catch (error) {
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Password link email could not be sent',
    );
    return 'failed';
  }
}

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------

export async function listRolesWithPermissions(actor: Actor) {
  assertPermission(actor, PERMISSIONS.ROLE_MANAGE);

  return prisma.role.findMany({
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      isSystem: true,
      isActive: true,
      _count: { select: { users: true } },
      permissions: {
        select: { permission: { select: { code: true, resource: true, action: true } } },
      },
    },
  });
}

export async function listPermissions(actor: Actor) {
  assertPermission(actor, PERMISSIONS.ROLE_MANAGE);
  return prisma.permission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    select: { code: true, resource: true, action: true, description: true },
  });
}

/**
 * Create a role.
 *
 * Three rules make this safe to expose in the administration UI:
 *
 *  * The new role is never a system role. `isSystem` marks the seven roles the
 *    workflow engine names directly; an administrator-created role is an
 *    additional one, not a replacement for those.
 *  * No one can grant a permission they do not themselves hold. Without that
 *    guard, `role:manage` would be a route to every other permission in the
 *    catalogue - create a role carrying it, then assign yourself the role.
 *  * The code is derived from the name and must be free. Codes are what the
 *    matrix, the seed and the audit trail read, so a collision is reported
 *    rather than resolved silently.
 */
export async function createRole(
  actor: Actor,
  input: CreateRoleInput,
  ctx: AuditContextInput,
): Promise<{ id: string; code: string }> {
  assertPermission(actor, PERMISSIONS.ROLE_MANAGE);
  // Attaching grants to a role is a permission change, not merely a role one.
  if (input.permissions.length > 0) assertPermission(actor, PERMISSIONS.PERMISSION_MANAGE);

  const beyondActor = input.permissions.filter((code) => !actor.permissions.has(code));
  if (beyondActor.length > 0) {
    throw new BusinessRuleError(
      'PRIVILEGE_ESCALATION',
      `You cannot grant a permission you do not hold yourself: ${beyondActor.join(', ')}.`,
    );
  }

  const code = deriveCode(input.name);

  return withTransaction(async (tx) => {
    const clash = await tx.role.findUnique({ where: { code }, select: { name: true } });
    if (clash) {
      throw new ConflictError(
        `The code ${code} is already held by the role "${clash.name}". Choose a different name.`,
      );
    }

    const permissions = await tx.permission.findMany({
      where: { code: { in: input.permissions } },
      select: { id: true, code: true },
    });
    if (permissions.length !== input.permissions.length) {
      throw new BusinessRuleError(
        'UNKNOWN_PERMISSION',
        'One or more of the selected permissions do not exist.',
      );
    }

    const role = await tx.role.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        isSystem: false,
        isActive: input.isActive,
        permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) },
      },
      select: { id: true, code: true },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'ROLE_CREATED',
      entity: 'Role',
      entityId: role.id,
      before: null,
      after: {
        code: role.code,
        name: input.name,
        description: input.description,
        isSystem: false,
        isActive: input.isActive,
        permissions: permissions.map((permission) => permission.code).sort(),
      },
    });

    return role;
  });
}

// ---------------------------------------------------------------------------
// Approval thresholds & final-letter authority
// ---------------------------------------------------------------------------

export async function listApprovalConfiguration(actor: Actor) {
  assertPermission(actor, PERMISSIONS.THRESHOLD_UPDATE);

  const [thresholds, letterRules] = await Promise.all([
    prisma.approvalThreshold.findMany({ orderBy: { minAmount: 'asc' } }),
    prisma.finalLetterAuthority.findMany({ orderBy: { minAmount: 'asc' } }),
  ]);

  // Surface whether the live ladder is actually coherent, rather than waiting
  // for a case to fail to route at the moment it matters.
  let validationError: string | null = null;
  try {
    validateThresholdSet(
      thresholds
        .filter((t) => t.isActive)
        .map((t) => ({
          id: t.id,
          name: t.name,
          minAmount: dec(t.minAmount.toString()),
          maxAmount: t.maxAmount === null ? null : dec(t.maxAmount.toString()),
          approvalChain: (t.approvalChain as RoleCode[]) ?? [],
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
        })),
    );
  } catch (error) {
    validationError = error instanceof Error ? error.message : 'Unknown configuration error.';
  }

  return { thresholds, letterRules, validationError };
}

export async function updateThresholdChain(
  actor: Actor,
  thresholdId: string,
  approvalChain: RoleCode[],
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.THRESHOLD_UPDATE);

  if (approvalChain.length === 0) {
    throw new BusinessRuleError(
      'EMPTY_APPROVAL_CHAIN',
      'An approval band must name at least one approving role.',
    );
  }

  await withTransaction(async (tx) => {
    const before = await tx.approvalThreshold.findUnique({ where: { id: thresholdId } });
    if (!before) throw new NotFoundError('The approval threshold was not found.');

    await tx.approvalThreshold.update({
      where: { id: thresholdId },
      data: { approvalChain },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'ApprovalThreshold',
      entityId: thresholdId,
      before: { name: before.name, approvalChain: before.approvalChain },
      after: { name: before.name, approvalChain },
    });
  });

  invalidateConfigurationCache();
}

// ---------------------------------------------------------------------------
// Valuation parameters
// ---------------------------------------------------------------------------

export async function listParameterSets(actor: Actor) {
  assertPermission(actor, PERMISSIONS.PARAMETER_UPDATE);

  const sets = await prisma.valuationParameterSet.findMany({
    orderBy: [{ code: 'asc' }, { version: 'desc' }],
    include: {
      parameters: {
        where: { NOT: { key: { startsWith: GUIDELINE_PREFIX } } },
        orderBy: { key: 'asc' },
      },
      _count: { select: { valuations: true } },
    },
  });

  // The guideline tables are listed by name only. They run to most of a
  // megabyte per version and are published whole by a guideline release, so
  // the register shows that they are there, not their thousand rows.
  const guidelineTables = await prisma.valuationParameter.findMany({
    where: { key: { startsWith: GUIDELINE_PREFIX } },
    orderBy: { key: 'asc' },
    select: {
      id: true,
      setId: true,
      key: true,
      name: true,
      type: true,
      numericValue: true,
      unit: true,
      discipline: true,
      categoryCode: true,
      notes: true,
    },
  });

  return sets.map((set) => ({
    ...set,
    parameters: [
      ...set.parameters,
      ...guidelineTables
        .filter((table) => table.setId === set.id)
        .map((table) => ({ ...table, jsonValue: null as Prisma.JsonValue | null })),
    ],
  }));
}

const NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

/**
 * The stored form of a table typed into the publish form, where every cell
 * arrives as text.
 *
 * `true`/`false` become booleans, because the engine tests flags such as
 * `includeUnpaidLeaseBalance` for truth and the string "false" is truthy.
 * Numbers become numbers, except where the version being replaced stored that
 * cell as a string - condition modifiers are kept as "0.70" so their exact
 * decimal text survives. Anything else is kept as text.
 */
function tableFromRows(
  rows: { entry: string; value: string }[],
  previous: Prisma.JsonValue | null,
): Prisma.InputJsonObject {
  const old =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? (previous as Prisma.JsonObject)
      : {};
  const table: Record<string, string | number | boolean> = {};

  for (const { entry, value } of rows) {
    const lowered = value.toLowerCase();
    if (lowered === 'true' || lowered === 'false') table[entry] = lowered === 'true';
    else if (NUMERIC_TEXT.test(value))
      table[entry] = typeof old[entry] === 'string' ? value : Number(value);
    else table[entry] = value;
  }
  return table;
}

/** Midnight UTC on the day `at` falls in. */
function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * Add a valuation parameter, or change one, by publishing a new version of its
 * set.
 *
 * Parameters are never edited in place: a valuation records the set it used,
 * and must reproduce its figure years later (spec section 28). So the new
 * version is a full copy of the latest one with this single parameter added or
 * replaced, and it takes effect from a chosen date. The previous version is
 * closed at that date but otherwise untouched.
 *
 * Two dates are refused. One in the past would change which parameters apply
 * to valuations already dated then. One earlier than the latest version's
 * start would let an older version take over again afterwards, silently
 * dropping this change.
 */
export async function publishParameterVersion(
  actor: Actor,
  input: PublishParameterInput,
  ctx: AuditContextInput,
): Promise<{ id: string; version: number }> {
  assertPermission(actor, PERMISSIONS.PARAMETER_UPDATE);

  // A guideline table is a thousand nested rows published whole by a guideline
  // release; this form edits flat tables and would flatten it.
  if (isGuidelineKey(input.key)) {
    throw new BusinessRuleError(
      'PARAMETER_READ_ONLY',
      `"${input.key}" is a guideline reference table. It is published with a guideline release and cannot be added or changed here.`,
    );
  }

  const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
  if (effectiveFrom < startOfUtcDay(new Date())) {
    throw new BusinessRuleError(
      'PARAMETER_BACKDATED',
      'A new version cannot take effect in the past - that would change the parameters behind valuations already dated then. Choose today or a later date.',
    );
  }

  const published = await withTransaction(async (tx) => {
    // Serialises publishers of the same set, so two administrators saving at
    // once cannot both claim the next version number.
    await tx.$queryRaw`SELECT id FROM valuation_parameter_sets WHERE code = ${input.setCode} FOR UPDATE`;

    const latest = await tx.valuationParameterSet.findFirst({
      where: { code: input.setCode },
      orderBy: { version: 'desc' },
      include: { parameters: true },
    });
    if (!latest) throw new NotFoundError('The parameter set was not found.');

    if (effectiveFrom < latest.effectiveFrom) {
      throw new BusinessRuleError(
        'PARAMETER_VERSION_ORDER',
        `Version ${latest.version} takes effect on ${latest.effectiveFrom.toISOString().slice(0, 10)}. A newer version cannot start before it.`,
      );
    }

    const previous = latest.parameters.find(
      (parameter) => parameter.key === input.key && (parameter.categoryCode ?? '') === '',
    );

    // The engine reads each key as one kind of value; a percentage that turned
    // into a table would fail every calculation that reads it.
    if (previous && previous.type !== input.type) {
      throw new BusinessRuleError(
        'PARAMETER_TYPE_FIXED',
        `"${input.key}" is a ${previous.type.toLowerCase()} parameter and the valuation engine reads it as one. Its type cannot be changed.`,
      );
    }

    const jsonValue =
      input.type === 'TABLE' ? tableFromRows(input.table, previous?.jsonValue ?? null) : null;

    const set = await tx.valuationParameterSet.create({
      data: {
        code: latest.code,
        version: latest.version + 1,
        description: input.reason,
        effectiveFrom,
        isActive: true,
      },
      select: { id: true, version: true },
    });

    const carried = latest.parameters
      .filter((parameter) => parameter !== previous)
      .map((parameter) => ({
        setId: set.id,
        key: parameter.key,
        name: parameter.name,
        type: parameter.type,
        numericValue: parameter.numericValue,
        ...(parameter.jsonValue !== null
          ? { jsonValue: parameter.jsonValue as Prisma.InputJsonValue }
          : {}),
        unit: parameter.unit,
        discipline: parameter.discipline,
        categoryCode: parameter.categoryCode,
        notes: parameter.notes,
      }));

    await tx.valuationParameter.createMany({
      data: [
        ...carried,
        {
          setId: set.id,
          key: input.key,
          name: input.name,
          type: input.type,
          numericValue: input.numericValue,
          ...(jsonValue ? { jsonValue } : {}),
          unit: input.unit,
          discipline: input.discipline,
          categoryCode: '',
          notes: input.notes,
        },
      ],
    });

    if (!latest.effectiveTo || latest.effectiveTo > effectiveFrom) {
      await tx.valuationParameterSet.update({
        where: { id: latest.id },
        data: { effectiveTo: effectiveFrom },
      });
    }

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'ValuationParameterSet',
      entityId: set.id,
      before: previous
        ? {
            version: latest.version,
            key: previous.key,
            numericValue: previous.numericValue?.toString() ?? null,
            jsonValue: previous.jsonValue,
          }
        : { version: latest.version },
      after: {
        code: latest.code,
        version: set.version,
        key: input.key,
        parameterName: input.name,
        parameterAdded: !previous,
        numericValue: input.numericValue,
        jsonValue,
        effectiveFrom: input.effectiveFrom,
        reason: input.reason,
      },
    });

    return set;
  });

  // Snapshots are cached per valuation date; a new version changes the answer
  // for every date from `effectiveFrom` onward.
  invalidateConfigurationCache();
  return published;
}

// ---------------------------------------------------------------------------
// Categories, request types, document categories
// ---------------------------------------------------------------------------

export async function listCategoryConfiguration(actor: Actor) {
  assertPermission(actor, PERMISSIONS.CATEGORY_UPDATE);

  const [propertyCategories, requestTypes, documentCategories] = await Promise.all([
    prisma.propertyCategory.findMany({
      orderBy: [{ discipline: 'asc' }, { sortOrder: 'asc' }],
      include: { parent: { select: { code: true, name: true } } },
    }),
    prisma.requestType.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.documentCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  return { propertyCategories, requestTypes, documentCategories };
}

export async function setPropertyCategoryActive(
  actor: Actor,
  categoryId: string,
  isActive: boolean,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.CATEGORY_UPDATE);

  await withTransaction(async (tx) => {
    const before = await tx.propertyCategory.findUnique({ where: { id: categoryId } });
    if (!before) throw new NotFoundError('The property category was not found.');

    await tx.propertyCategory.update({ where: { id: categoryId }, data: { isActive } });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'PropertyCategory',
      entityId: categoryId,
      before: { code: before.code, isActive: before.isActive },
      after: { code: before.code, isActive },
    });
  });

  invalidateConfigurationCache();
}

export async function setRequestTypeActive(
  actor: Actor,
  requestTypeId: string,
  isActive: boolean,
  ctx: AuditContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.REQUEST_TYPE_UPDATE);

  await withTransaction(async (tx) => {
    const before = await tx.requestType.findUnique({ where: { id: requestTypeId } });
    if (!before) throw new NotFoundError('The request type was not found.');

    await tx.requestType.update({ where: { id: requestTypeId }, data: { isActive } });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'RequestType',
      entityId: requestTypeId,
      before: { code: before.code, isActive: before.isActive },
      after: { code: before.code, isActive },
    });
  });

  invalidateConfigurationCache();
}

/**
 * Where a newly created configuration entry sits in its list.
 *
 * Appended rather than inserted: the existing order is the order the department
 * chose, and a new entry has no claim on a position within it.
 */
function nextSortOrder(current: { sortOrder: number }[]): number {
  return current.reduce((highest, row) => Math.max(highest, row.sortOrder), -1) + 1;
}

/**
 * The configuration entries the "Add" action on the categories page creates.
 *
 * All three share the same shape: a derived code that must be free, a name, an
 * optional description, and whether the value is offered on new cases. None is
 * ever deleted afterwards - `setPropertyCategoryActive` and its siblings only
 * disable, so a historical valuation keeps the classification it was valued
 * under.
 */
export async function createPropertyCategory(
  actor: Actor,
  input: CreatePropertyCategoryInput,
  ctx: AuditContextInput,
): Promise<{ id: string; code: string }> {
  assertPermission(actor, PERMISSIONS.CATEGORY_UPDATE);

  const code = deriveCode(input.name);

  const created = await withTransaction(async (tx) => {
    const clash = await tx.propertyCategory.findUnique({ where: { code }, select: { name: true } });
    if (clash) {
      throw new ConflictError(
        `The code ${code} is already held by the category "${clash.name}". Choose a different name.`,
      );
    }

    const siblings = await tx.propertyCategory.findMany({
      where: { discipline: input.discipline },
      select: { sortOrder: true },
    });

    const category = await tx.propertyCategory.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        discipline: input.discipline,
        isActive: input.isActive,
        sortOrder: nextSortOrder(siblings),
      },
      select: { id: true, code: true },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'PropertyCategory',
      entityId: category.id,
      before: null,
      after: {
        code: category.code,
        name: input.name,
        description: input.description,
        discipline: input.discipline,
        isActive: input.isActive,
      },
    });

    return category;
  });

  invalidateConfigurationCache();
  return created;
}

export async function createRequestType(
  actor: Actor,
  input: CreateRequestTypeInput,
  ctx: AuditContextInput,
): Promise<{ id: string; code: string }> {
  assertPermission(actor, PERMISSIONS.REQUEST_TYPE_UPDATE);

  const code = deriveCode(input.name);

  const created = await withTransaction(async (tx) => {
    const clash = await tx.requestType.findUnique({ where: { code }, select: { name: true } });
    if (clash) {
      throw new ConflictError(
        `The code ${code} is already held by the request type "${clash.name}". Choose a different name.`,
      );
    }

    const siblings = await tx.requestType.findMany({ select: { sortOrder: true } });

    const requestType = await tx.requestType.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        isActive: input.isActive,
        sortOrder: nextSortOrder(siblings),
      },
      select: { id: true, code: true },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'RequestType',
      entityId: requestType.id,
      before: null,
      after: {
        code: requestType.code,
        name: input.name,
        description: input.description,
        isActive: input.isActive,
      },
    });

    return requestType;
  });

  invalidateConfigurationCache();
  return created;
}

export async function createDocumentCategory(
  actor: Actor,
  input: CreateDocumentCategoryInput,
  ctx: AuditContextInput,
): Promise<{ id: string; code: string }> {
  assertPermission(actor, PERMISSIONS.CATEGORY_UPDATE);

  const code = deriveCode(input.name);

  const created = await withTransaction(async (tx) => {
    const clash = await tx.documentCategory.findUnique({ where: { code }, select: { name: true } });
    if (clash) {
      throw new ConflictError(
        `The code ${code} is already held by the document category "${clash.name}". Choose a different name.`,
      );
    }

    const siblings = await tx.documentCategory.findMany({ select: { sortOrder: true } });

    const category = await tx.documentCategory.create({
      data: {
        code,
        name: input.name,
        description: input.description,
        // Left to the model defaults: a new category applies to every
        // discipline and is optional until someone decides otherwise.
        isActive: input.isActive,
        sortOrder: nextSortOrder(siblings),
      },
      select: { id: true, code: true },
    });

    await record(tx, {
      ...contextFor(actor, ctx),
      action: 'CONFIGURATION_CHANGED',
      entity: 'DocumentCategory',
      entityId: category.id,
      before: null,
      after: {
        code: category.code,
        name: input.name,
        description: input.description,
        isActive: input.isActive,
      },
    });

    return category;
  });

  invalidateConfigurationCache();
  return created;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface AuditFilter {
  action?: string;
  entity?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

/**
 * The distinct actions and entities, for the filter lists.
 *
 * Prisma's `distinct` reads every row and removes duplicates in memory; over
 * half a million audit rows that took the page to fifteen seconds. These walk
 * the existing (action, ...) and (entity, ...) indexes instead, one seek per
 * distinct value - a "skip scan" - so the cost is the number of values, not
 * the number of rows. Neither query takes input.
 */
async function distinctAuditActions(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    WITH RECURSIVE walk AS (
      (SELECT action AS value FROM audit_logs ORDER BY action LIMIT 1)
      UNION ALL
      SELECT (SELECT action FROM audit_logs WHERE action > walk.value ORDER BY action LIMIT 1)
      FROM walk WHERE walk.value IS NOT NULL
    )
    SELECT value FROM walk WHERE value IS NOT NULL`;
  return rows.map((r) => r.value);
}

async function distinctAuditEntities(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    WITH RECURSIVE walk AS (
      (SELECT entity AS value FROM audit_logs ORDER BY entity LIMIT 1)
      UNION ALL
      SELECT (SELECT entity FROM audit_logs WHERE entity > walk.value ORDER BY entity LIMIT 1)
      FROM walk WHERE walk.value IS NOT NULL
    )
    SELECT value FROM walk WHERE value IS NOT NULL`;
  return rows.map((r) => r.value);
}

export async function listAuditLog(actor: Actor, filter: AuditFilter = {}) {
  assertPermission(actor, PERMISSIONS.AUDIT_READ);

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(10, filter.pageSize ?? 50));

  const where = {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entity ? { entity: filter.entity } : {}),
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
    ...(filter.from || filter.to
      ? {
          occurredAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };

  const [rows, total, actions, entities] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { employeeId: true, fullName: true } } },
    }),
    prisma.auditLog.count({ where }),
    distinctAuditActions(),
    distinctAuditEntities(),
  ]);

  const { caseNumbers, userNames } = await resolveAuditSubjects(rows);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    actions,
    entities,
    caseNumbers,
    userNames,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The names behind the identifiers on one page of the trail.
 *
 * A record stores the case or user it touched by id, which proves the link but
 * tells a reader nothing. Two lookups for the whole page - never one per row -
 * turn those ids into the case number and the person's name the log shows. A
 * case or user the reader could not otherwise see is still named here: the
 * audit permission is the right to know who did what to which record.
 */
async function resolveAuditSubjects(
  rows: { entity: string; entityId: string | null; after: Prisma.JsonValue }[],
): Promise<{ caseNumbers: Record<string, string>; userNames: Record<string, string> }> {
  const caseIds = new Set<string>();
  const userIds = new Set<string>();

  for (const row of rows) {
    if (row.entityId && UUID_PATTERN.test(row.entityId)) {
      if (row.entity === 'ValuationCase') caseIds.add(row.entityId);
      if (row.entity === 'User' || row.entity === 'Credential') userIds.add(row.entityId);
    }
    const after = row.after;
    if (after && typeof after === 'object' && !Array.isArray(after)) {
      const caseId = (after as Record<string, unknown>).caseId;
      if (typeof caseId === 'string' && UUID_PATTERN.test(caseId)) caseIds.add(caseId);
    }
  }

  const [cases, users] = await Promise.all([
    caseIds.size > 0
      ? prisma.valuationCase.findMany({
          where: { id: { in: [...caseIds] } },
          select: { id: true, caseNumber: true },
        })
      : [],
    userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, fullName: true },
        })
      : [],
  ]);

  return {
    caseNumbers: Object.fromEntries(cases.map((c) => [c.id, c.caseNumber])),
    userNames: Object.fromEntries(users.map((u) => [u.id, u.fullName])),
  };
}
