import { describe, expect, it } from 'vitest';
import {
  assertCaseAccess,
  assertNotParticipant,
  assertPermission,
  canAccessCase,
  matchesDiscipline,
  satisfiesScope,
  type Actor,
  type CaseAccessSubject,
} from '@/server/domain/rbac/authorize';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionCode,
} from '@/server/domain/rbac/permissions';
import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/lib/errors';
import type { Discipline, RoleCode } from '@/server/domain/shared/enums';

/**
 * Security tests for the authorisation layer (spec section 38).
 *
 * These exercise the domain logic directly rather than through HTTP, which is
 * what makes them exhaustive: every role can be tested against every
 * case-relationship in milliseconds, including the combinations a manual test
 * plan would never reach.
 */

const DEPT_PVD = 'dept-pvd';
const DEPT_OTHER = 'dept-other';
const ORG_MEXICO = 'org-mexico';
const ORG_BOLE = 'org-bole';
const ORG_DISTRICT = 'org-district';

function actor(
  roles: RoleCode[],
  overrides: Partial<Omit<Actor, 'roles' | 'permissions'>> & {
    extraPermissions?: PermissionCode[];
  } = {},
): Actor {
  const permissions = new Set<PermissionCode>();
  for (const role of roles) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) permissions.add(permission);
  }
  for (const permission of overrides.extraPermissions ?? []) permissions.add(permission);

  return {
    id: overrides.id ?? `user-${roles.join('-').toLowerCase()}`,
    fullName: overrides.fullName ?? 'Test User',
    roles,
    permissions,
    organizationId: overrides.organizationId ?? null,
    departmentId: overrides.departmentId ?? null,
    discipline: (overrides.discipline ?? 'BOTH') as Discipline,
    isActive: overrides.isActive ?? true,
    organizationScope:
      overrides.organizationScope ??
      (overrides.organizationId ? [overrides.organizationId] : []),
  };
}

function subject(overrides: Partial<CaseAccessSubject> = {}): CaseAccessSubject {
  return {
    id: 'case-1',
    requestingOrgId: ORG_MEXICO,
    departmentId: DEPT_PVD,
    requestedById: 'user-process_owner',
    makerId: 'user-maker',
    checkerId: 'user-checker',
    ...overrides,
  };
}

describe('authorisation: unauthenticated and inactive callers', () => {
  it('refuses a null actor', () => {
    expect(() => assertPermission(null as unknown as Actor, PERMISSIONS.CASE_READ)).toThrow(
      UnauthenticatedError,
    );
  });

  it('refuses a deactivated account even though its permissions are intact', () => {
    const suspended = actor(['MAKER'], { id: 'user-maker', isActive: false });
    expect(suspended.permissions.has(PERMISSIONS.VALUATION_EDIT)).toBe(true);
    expect(() => assertCaseAccess(suspended, subject(), PERMISSIONS.VALUATION_EDIT)).toThrow(
      ForbiddenError,
    );
  });
});

describe('authorisation: IDOR (spec section 26)', () => {
  it('hides a case belonging to another maker behind a 404, not a 403', () => {
    // Returning 403 would confirm the case exists and turn the endpoint into an
    // enumeration oracle.
    const otherMaker = actor(['MAKER'], { id: 'user-other-maker', departmentId: null });
    expect(() => assertCaseAccess(otherMaker, subject(), PERMISSIONS.CASE_READ)).toThrow(
      NotFoundError,
    );
  });

  it('refuses a process owner access to another branch', () => {
    const boleOwner = actor(['PROCESS_OWNER'], {
      id: 'user-bole',
      organizationId: ORG_BOLE,
    });
    expect(() => assertCaseAccess(boleOwner, subject(), PERMISSIONS.CASE_READ)).toThrow(
      NotFoundError,
    );
  });

  it('reports 403 rather than 404 when the case is visible but the action is not', () => {
    // A checker can read the case; they simply may not approve it.
    const checker = actor(['CHECKER'], { id: 'user-checker', departmentId: DEPT_PVD });
    expect(() => assertCaseAccess(checker, subject(), PERMISSIONS.APPROVAL_MANAGER)).toThrow(
      ForbiddenError,
    );
  });

  it('refuses a maker from another department reading a case', () => {
    const foreignMaker = actor(['MAKER'], {
      id: 'user-foreign',
      departmentId: DEPT_OTHER,
    });
    expect(canAccessCase(foreignMaker, subject(), PERMISSIONS.CASE_READ)).toBe(false);
  });
});

describe('authorisation: role escalation', () => {
  it('does not let a maker assign work', () => {
    const maker = actor(['MAKER'], { id: 'user-maker', departmentId: DEPT_PVD });
    expect(canAccessCase(maker, subject(), PERMISSIONS.CASE_ASSIGN_MAKER)).toBe(false);
    expect(canAccessCase(maker, subject(), PERMISSIONS.CASE_ASSIGN_CHECKER)).toBe(false);
  });

  it('does not let a checker approve at manager level', () => {
    const checker = actor(['CHECKER'], { id: 'user-checker', departmentId: DEPT_PVD });
    expect(canAccessCase(checker, subject(), PERMISSIONS.APPROVAL_MANAGER)).toBe(false);
  });

  it('does not let a manager approve at director level', () => {
    const manager = actor(['MAKER_MANAGER'], { id: 'user-manager', departmentId: DEPT_PVD });
    expect(canAccessCase(manager, subject(), PERMISSIONS.APPROVAL_DIRECTOR)).toBe(false);
  });

  it('gives the administrator every right, by explicit decision of the bank', () => {
    // Reversed from the original design at the bank's request. The trade-off
    // and the guards that survive are covered in admin-authority.test.ts.
    const admin = actor(['ADMIN'], { id: 'user-admin', departmentId: DEPT_PVD });
    const granted: PermissionCode[] = [
      PERMISSIONS.VALUATION_EDIT,
      PERMISSIONS.VALUATION_SUBMIT,
      PERMISSIONS.VALUATION_CHECK,
      PERMISSIONS.APPROVAL_MANAGER,
      PERMISSIONS.APPROVAL_DIRECTOR,
      PERMISSIONS.SIGNATURE_SIGN,
      PERMISSIONS.CASE_CREATE,
    ];
    for (const permission of granted) {
      expect(admin.permissions.has(permission), permission).toBe(true);
    }
  });

  it('still refuses an administrator approval of a case they worked on', () => {
    // The override widens scope; it does not lift the segregation-of-duties
    // veto on the specific case.
    const admin = actor(['ADMIN'], { id: 'user-admin', departmentId: DEPT_PVD });
    expect(
      canAccessCase(admin, subject({ makerId: 'user-admin' }), PERMISSIONS.APPROVAL_MANAGER),
    ).toBe(false);
  });

  it('does not let a process owner see the valuation working', () => {
    // A requesting branch sees the result, not the calculation - exposing the
    // working invites pressure on the valuator.
    const owner = actor(['PROCESS_OWNER'], { id: 'user-owner', organizationId: ORG_MEXICO });
    expect(owner.permissions.has(PERMISSIONS.VALUATION_CALCULATE)).toBe(false);
    expect(owner.permissions.has(PERMISSIONS.VALUATION_EDIT)).toBe(false);
  });
});

describe('authorisation: segregation of duties (assumption 2.2)', () => {
  it('refuses approval by the person who made the valuation', () => {
    const managerWhoMadeIt = actor(['MAKER_MANAGER'], {
      id: 'user-dual',
      departmentId: DEPT_PVD,
    });
    const case_ = subject({ makerId: 'user-dual' });
    expect(canAccessCase(managerWhoMadeIt, case_, PERMISSIONS.APPROVAL_MANAGER)).toBe(false);
  });

  it('refuses approval by the person who checked the valuation', () => {
    const directorWhoChecked = actor(['DIRECTOR'], {
      id: 'user-dual',
      departmentId: DEPT_PVD,
    });
    const case_ = subject({ checkerId: 'user-dual' });
    expect(canAccessCase(directorWhoChecked, case_, PERMISSIONS.APPROVAL_DIRECTOR)).toBe(false);
  });

  it('refuses signing by a participant', () => {
    const manager = actor(['MAKER_MANAGER'], { id: 'user-dual', departmentId: DEPT_PVD });
    expect(canAccessCase(manager, subject({ makerId: 'user-dual' }), PERMISSIONS.SIGNATURE_SIGN)).toBe(
      false,
    );
  });

  it('permits approval by an uninvolved manager in the same department', () => {
    const manager = actor(['MAKER_MANAGER'], { id: 'user-manager', departmentId: DEPT_PVD });
    expect(canAccessCase(manager, subject(), PERMISSIONS.APPROVAL_MANAGER)).toBe(true);
  });

  it('explains the refusal when a participant attempts to approve', () => {
    const manager = actor(['MAKER_MANAGER'], { id: 'user-dual', departmentId: DEPT_PVD });
    expect(() => assertNotParticipant(manager, subject({ makerId: 'user-dual' }), 'approve')).toThrow(
      /may not also approve/,
    );
  });
});

describe('authorisation: scope predicates', () => {
  const case_ = subject();

  it('matches a maker to their own case only', () => {
    const maker = actor(['MAKER'], { id: 'user-maker' });
    expect(satisfiesScope(maker, case_, 'SELF_MAKER')).toBe(true);
    expect(satisfiesScope(maker, case_, 'SELF_CHECKER')).toBe(false);
  });

  it('matches a department predicate only within the same department', () => {
    const inDept = actor(['MAKER_MANAGER'], { departmentId: DEPT_PVD });
    const outOfDept = actor(['MAKER_MANAGER'], { departmentId: DEPT_OTHER });
    expect(satisfiesScope(inDept, case_, 'DEPT')).toBe(true);
    expect(satisfiesScope(outOfDept, case_, 'DEPT')).toBe(false);
  });

  it('never matches DEPT for an actor with no department', () => {
    // A null department must not silently match a case whose department is also
    // being compared loosely.
    const noDept = actor(['MAKER_MANAGER'], { departmentId: null });
    expect(satisfiesScope(noDept, case_, 'DEPT')).toBe(false);
  });

  it('extends a district office to its branches only when roll-up is granted', () => {
    const withoutRollup = actor(['PROCESS_OWNER'], {
      id: 'user-district',
      organizationId: ORG_DISTRICT,
      organizationScope: [ORG_DISTRICT],
    });
    const withRollup = actor(['PROCESS_OWNER'], {
      id: 'user-district',
      organizationId: ORG_DISTRICT,
      organizationScope: [ORG_DISTRICT, ORG_MEXICO, ORG_BOLE],
      extraPermissions: [PERMISSIONS.ORG_ROLLUP],
    });

    expect(satisfiesScope(withoutRollup, case_, 'OWN_ORG')).toBe(false);
    expect(satisfiesScope(withRollup, case_, 'OWN_ORG')).toBe(true);
  });
});

describe('authorisation: discipline matching (assumption 2.5)', () => {
  it('lets a dual-discipline valuator work either kind of case', () => {
    const both = actor(['MAKER'], { discipline: 'BOTH' });
    expect(matchesDiscipline(both, 'CIVIL')).toBe(true);
    expect(matchesDiscipline(both, 'MECHANICAL')).toBe(true);
  });

  it('refuses a civil valuator a mechanical case', () => {
    const civil = actor(['MAKER'], { discipline: 'CIVIL' });
    expect(matchesDiscipline(civil, 'CIVIL')).toBe(true);
    expect(matchesDiscipline(civil, 'MECHANICAL')).toBe(false);
  });
});

describe('authorisation: permissions without a declared scope', () => {
  it('denies a case-scoped check for an administration permission', () => {
    // Asking "may this actor do config:update *on this case*" is a category
    // error; denying is the safe answer.
    const admin = actor(['ADMIN'], { departmentId: DEPT_PVD });
    expect(canAccessCase(admin, subject(), PERMISSIONS.CONFIG_UPDATE)).toBe(false);
    expect(() => assertPermission(admin, PERMISSIONS.CONFIG_UPDATE)).not.toThrow();
  });
});
