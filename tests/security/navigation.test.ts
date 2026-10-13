import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, upcomingItems, visibleSections } from '@/components/navigation/nav-config';
import { DEFAULT_ROLE_PERMISSIONS, type PermissionCode } from '@/server/domain/rbac/permissions';
import { ROLE_CODES, type RoleCode } from '@/server/domain/shared/enums';

/**
 * The navigation is a usability surface, not a security control - every
 * destination re-checks authorisation server-side. These tests cover the two
 * ways it can still be wrong: offering a link that 404s, and offering a link to
 * someone whose roles will be refused when they follow it.
 */

function permissionsFor(...roles: RoleCode[]): ReadonlySet<PermissionCode> {
  const set = new Set<PermissionCode>();
  for (const role of roles) {
    for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) set.add(permission);
  }
  return set;
}

const ALL_HREFS = NAV_SECTIONS.flatMap((section) => section.items).map((item) => item.href);

describe('navigation configuration', () => {
  it('declares a unique href for every item', () => {
    expect(new Set(ALL_HREFS).size).toBe(ALL_HREFS.length);
  });

  it('never offers a link to a destination that does not exist', () => {
    // The bug this guards against: a menu full of entries that 404, which reads
    // as a broken system rather than an unfinished one.
    for (const role of ROLE_CODES) {
      for (const section of visibleSections(permissionsFor(role))) {
        for (const item of section.items) {
          expect(item.built, `${role} was offered unbuilt route ${item.href}`).toBe(true);
        }
      }
    }
  });

  it('only offers an item to a role that holds one of its permissions', () => {
    for (const role of ROLE_CODES) {
      const permissions = permissionsFor(role);
      for (const section of visibleSections(permissions)) {
        for (const item of section.items) {
          const allowed = item.permissions.some((p) => permissions.has(p));
          expect(allowed, `${role} was offered ${item.href} without a qualifying permission`).toBe(
            true,
          );
        }
      }
    }
  });

  it('hides the whole administration section from a valuator', () => {
    const maker = visibleSections(permissionsFor('MAKER'));
    const hrefs = maker.flatMap((s) => s.items).map((i) => i.href);
    expect(hrefs.some((href) => href.startsWith('/admin'))).toBe(false);
  });

  it('offers an administrator every built destination', () => {
    // The bank granted the administrator full authority, so the rail must not
    // hide anything from them - a page they can use but cannot find is the
    // same defect as a link that 404s.
    const permissions = permissionsFor('ADMIN');
    const offered = new Set(
      visibleSections(permissions)
        .flatMap((s) => s.items)
        .map((i) => i.href),
    );

    const everyBuilt = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.built);
    for (const item of everyBuilt) {
      expect(offered.has(item.href), `administrator was not offered ${item.href}`).toBe(true);
    }

    expect(offered).toContain('/admin/users');
    expect(offered).toContain('/requests/new');
  });

  it('offers a director the audit log but not user management', () => {
    // Directors hold audit:read so they can investigate a case history without
    // an administrator, but they do not manage accounts.
    const director = visibleSections(permissionsFor('DIRECTOR'));
    const hrefs = director.flatMap((s) => s.items).map((i) => i.href);

    expect(hrefs).toContain('/admin/audit');
    expect(hrefs).not.toContain('/admin/users');
    expect(hrefs).not.toContain('/admin/roles');
  });

  it('lists only unbuilt destinations as upcoming - and with every phase built, none', () => {
    for (const role of ROLE_CODES) {
      const upcoming = upcomingItems(permissionsFor(role));
      for (const item of upcoming) expect(item.built).toBe(false);
      // Every menu destination now exists, so no role is shown inert
      // "coming soon" entries. A new unbuilt item should fail here on purpose.
      expect(upcoming).toEqual([]);
    }
  });

  it('offers the SLA calendar to administrators only', () => {
    const hrefs = (role: (typeof ROLE_CODES)[number]) =>
      visibleSections(permissionsFor(role))
        .flatMap((s) => s.items)
        .map((i) => i.href);
    expect(hrefs('ADMIN')).toContain('/admin/sla');
    for (const role of ROLE_CODES.filter((r) => r !== 'ADMIN')) {
      expect(hrefs(role)).not.toContain('/admin/sla');
    }
  });

  it('never lists the same destination as both available and upcoming', () => {
    for (const role of ROLE_CODES) {
      const permissions = permissionsFor(role);
      const available = new Set(
        visibleSections(permissions)
          .flatMap((s) => s.items)
          .map((i) => i.href),
      );
      for (const item of upcomingItems(permissions)) {
        expect(available.has(item.href), `${item.href} appears twice for ${role}`).toBe(false);
      }
    }
  });
});
