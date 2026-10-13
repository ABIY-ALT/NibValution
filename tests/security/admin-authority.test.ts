import { describe, expect, it } from 'vitest';
import {
  canAccessCase,
  satisfiesScope,
  type Actor,
  type CaseAccessSubject,
} from '@/server/domain/rbac/authorize';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  type PermissionCode,
} from '@/server/domain/rbac/permissions';
import { caseScopeFilter } from '@/server/application/dashboard-service';
import { availableActions } from '@/server/domain/workflow/workflow-service';
import { TRANSITIONS } from '@/server/domain/workflow/transitions';
import { CASE_STATUSES } from '@/server/domain/shared/enums';
import type { RoleCode } from '@/server/domain/shared/enums';

/**
 * The administrator's full operating authority.
 *
 * The bank chose to give the administrator every permission so they can reach
 * and act on every page. These tests pin the two things that must remain true
 * once that decision is made:
 *
 *  1. The authority really is complete — no page silently refuses them, which
 *     would be worse than not granting it at all.
 *  2. The guards that survive really do survive: an administrator still cannot
 *     approve a case they personally valued or checked, no operating role gains
 *     the override, and the chain order still holds.
 */

function actorFor(role: RoleCode, overrides: Partial<Actor> = {}): Actor {
  return {
    id: overrides.id ?? `user-${role.toLowerCase()}`,
    fullName: 'Test User',
    roles: [role],
    permissions: new Set<PermissionCode>(DEFAULT_ROLE_PERMISSIONS[role]),
    organizationId: overrides.organizationId ?? null,
    departmentId: overrides.departmentId ?? null,
    discipline: overrides.discipline ?? 'NONE',
    isActive: overrides.isActive ?? true,
    organizationScope: overrides.organizationScope ?? [],
  };
}

/** A case in a department and organisation the administrator has no relation to. */
const FOREIGN_CASE: CaseAccessSubject = {
  id: 'case-1',
  requestingOrgId: 'org-bahirdar',
  departmentId: 'dept-pvd',
  requestedById: 'user-process_owner',
  makerId: 'user-maker',
  checkerId: 'user-checker',
};

/** Every permission that is scoped to a case rather than to configuration. */
const CASE_SCOPED: PermissionCode[] = [
  PERMISSIONS.CASE_CREATE,
  PERMISSIONS.CASE_READ,
  PERMISSIONS.CASE_TIMELINE_READ,
  PERMISSIONS.CASE_UPDATE_REQUEST,
  PERMISSIONS.CASE_CANCEL,
  PERMISSIONS.CASE_ASSIGN_MAKER,
  PERMISSIONS.CASE_ASSIGN_CHECKER,
  PERMISSIONS.CASE_REASSIGN,
  PERMISSIONS.CASE_RETURN_TO_REQUESTER,
  PERMISSIONS.CASE_ARCHIVE,
  PERMISSIONS.VALUATION_START,
  PERMISSIONS.VALUATION_EDIT,
  PERMISSIONS.VALUATION_CALCULATE,
  PERMISSIONS.VALUATION_SUBMIT,
  PERMISSIONS.VALUATION_READ,
  PERMISSIONS.VALUATION_CHECK,
  PERMISSIONS.VALUATION_RETURN,
  PERMISSIONS.VALUATION_MARK_STATUS,
  PERMISSIONS.APPROVAL_MANAGER,
  PERMISSIONS.APPROVAL_DIRECTOR,
  PERMISSIONS.SIGNATURE_SIGN,
  PERMISSIONS.LETTER_GENERATE,
  PERMISSIONS.COVERPAGE_GENERATE,
  PERMISSIONS.REPORT_GENERATE,
  PERMISSIONS.REPORT_DOWNLOAD_FINAL,
  PERMISSIONS.DOCUMENT_UPLOAD,
  PERMISSIONS.DOCUMENT_READ_METADATA,
  PERMISSIONS.DOCUMENT_DOWNLOAD,
  PERMISSIONS.DOCUMENT_DELETE,
];

describe('administrator: full authority', () => {
  const admin = actorFor('ADMIN', { organizationId: 'org-ho' });

  it('holds every permission in the catalogue', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(admin.permissions.has(permission), `administrator lacks ${permission}`).toBe(true);
    }
  });

  it('can act on a case in a unit and department it has no relation to', () => {
    // The point of the override: no DEPT, OWN_ORG or SELF_* relationship exists,
    // and the action is still permitted.
    for (const permission of CASE_SCOPED) {
      expect(
        canAccessCase(admin, FOREIGN_CASE, permission),
        `administrator was refused ${permission}`,
      ).toBe(true);
    }
  });

  it('sees every case in the dashboard scope filter', () => {
    expect(caseScopeFilter(admin)).toEqual({});
  });

  it('is refused everything once deactivated', () => {
    // The override is carried by permissions, and a deactivated account holds
    // none of them in practice.
    const suspended = { ...admin, isActive: false };
    for (const permission of CASE_SCOPED) {
      expect(canAccessCase(suspended, FOREIGN_CASE, permission)).toBe(false);
    }
  });
});

describe('administrator: guards that survive the override', () => {
  it('still cannot approve a case it valued itself', () => {
    // NOT_PARTICIPANT is about the specific case, not about role, so it vetoes
    // on top of the override.
    const admin = actorFor('ADMIN', { id: 'user-admin' });
    const ownCase = { ...FOREIGN_CASE, makerId: 'user-admin' };

    expect(canAccessCase(admin, ownCase, PERMISSIONS.APPROVAL_MANAGER)).toBe(false);
    expect(canAccessCase(admin, ownCase, PERMISSIONS.APPROVAL_DIRECTOR)).toBe(false);
    expect(canAccessCase(admin, ownCase, PERMISSIONS.SIGNATURE_SIGN)).toBe(false);
  });

  it('still cannot approve a case it checked itself', () => {
    const admin = actorFor('ADMIN', { id: 'user-admin' });
    const ownCase = { ...FOREIGN_CASE, checkerId: 'user-admin' };

    expect(canAccessCase(admin, ownCase, PERMISSIONS.APPROVAL_MANAGER)).toBe(false);
    expect(canAccessCase(admin, ownCase, PERMISSIONS.SIGNATURE_SIGN)).toBe(false);
  });

  it('can still read and work a case it participated in', () => {
    // The veto is confined to approval and signing; it does not lock an
    // administrator out of the case entirely.
    const admin = actorFor('ADMIN', { id: 'user-admin' });
    const ownCase = { ...FOREIGN_CASE, makerId: 'user-admin' };

    expect(canAccessCase(admin, ownCase, PERMISSIONS.CASE_READ)).toBe(true);
    expect(canAccessCase(admin, ownCase, PERMISSIONS.VALUATION_EDIT)).toBe(true);
  });
});

describe('the override is confined to the administrator', () => {
  it('is granted to no operating role', () => {
    for (const role of [
      'MAKER',
      'CHECKER',
      'MAKER_MANAGER',
      'CHECKER_MANAGER',
      'PROCESS_OWNER',
      'DIRECTOR',
    ] as const) {
      expect(
        DEFAULT_ROLE_PERMISSIONS[role].includes(PERMISSIONS.SYSTEM_ADMINISTER),
        `${role} holds system:administer`,
      ).toBe(false);
    }
  });

  it('leaves every operating role narrowly scoped', () => {
    // The decision widened one role, not the model. A Maker still reaches only
    // their own cases.
    const maker = actorFor('MAKER', { id: 'user-other', departmentId: 'dept-pvd' });
    expect(canAccessCase(maker, FOREIGN_CASE, PERMISSIONS.VALUATION_EDIT)).toBe(false);
    expect(canAccessCase(maker, FOREIGN_CASE, PERMISSIONS.APPROVAL_MANAGER)).toBe(false);

    const checker = actorFor('CHECKER', { id: 'user-other', departmentId: 'dept-pvd' });
    expect(canAccessCase(checker, FOREIGN_CASE, PERMISSIONS.APPROVAL_DIRECTOR)).toBe(false);
  });

  it('still narrows the dashboard scope filter for every operating role', () => {
    for (const role of ['MAKER', 'CHECKER', 'MAKER_MANAGER', 'PROCESS_OWNER'] as const) {
      const filter = caseScopeFilter(actorFor(role, { departmentId: 'dept-pvd' }));
      expect(filter, `${role} was given an unrestricted case filter`).not.toEqual({});
    }
  });

  it('is satisfied only by holding system:administer', () => {
    expect(satisfiesScope(actorFor('ADMIN'), FOREIGN_CASE, 'GLOBAL_ADMIN')).toBe(true);
    expect(satisfiesScope(actorFor('MAKER'), FOREIGN_CASE, 'GLOBAL_ADMIN')).toBe(false);
    expect(satisfiesScope(actorFor('DIRECTOR'), FOREIGN_CASE, 'GLOBAL_ADMIN')).toBe(false);
  });

  it('registers the override in the catalogue so it can be seeded and audited', () => {
    expect(ALL_PERMISSIONS).toContain(PERMISSIONS.SYSTEM_ADMINISTER);
  });
});

describe('what the interface offers matches what the server accepts', () => {
  const admin = actorFor('ADMIN', { id: 'user-admin' });

  it('offers the administrator every transition legal from each status', () => {
    // The defect this guards against: an override applied when *enforcing* a
    // transition but not when *listing* the available ones, so the buttons
    // disappear even though the action would succeed.
    for (const status of CASE_STATUSES) {
      const snapshot = {
        ...FOREIGN_CASE,
        caseNumber: 'PV-2026-000001',
        status,
        version: 1,
        discipline: 'CIVIL' as const,
        finalValue: null,
      };

      const offered = new Set(availableActions(admin, snapshot));
      const legalHere = TRANSITIONS.filter((t) => t.from.includes(status));

      for (const transition of legalHere) {
        // Approval and signing are vetoed only when the administrator was a
        // participant, which this fixture case is not.
        expect(
          offered.has(transition.action),
          `administrator was not offered ${transition.action} from ${status}`,
        ).toBe(true);
      }
    }
  });

  it('offers nothing from a terminal status', () => {
    for (const status of ['ARCHIVED', 'CANCELLED'] as const) {
      const snapshot = {
        ...FOREIGN_CASE,
        caseNumber: 'PV-2026-000001',
        status,
        version: 1,
        discipline: 'CIVIL' as const,
        finalValue: null,
      };
      expect(availableActions(admin, snapshot)).toEqual([]);
    }
  });

  it('withholds approval on a case the administrator participated in', () => {
    const snapshot = {
      ...FOREIGN_CASE,
      makerId: 'user-admin',
      caseNumber: 'PV-2026-000001',
      status: 'PENDING_MANAGER_APPROVAL' as const,
      version: 1,
      discipline: 'CIVIL' as const,
      finalValue: null,
    };
    expect(availableActions(admin, snapshot)).not.toContain('APPROVE_MANAGER');
  });
});
