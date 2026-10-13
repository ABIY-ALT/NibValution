import type { PrismaClient } from '@prisma/client';

/**
 * Organisation and department structure.
 *
 * These are illustrative development records, not NIB's real branch network -
 * the production structure is loaded by an administrator through the admin UI
 * or a one-off import. They exist so that the organisation-scoped
 * authorisation rules (docs/04-rbac-matrix.md) can actually be exercised in
 * development and in the security tests: a single flat organisation would let
 * a broken scope check pass unnoticed.
 */

const DEPARTMENTS = [
  { code: 'PVD', name: 'Property Valuation Department' },
  { code: 'PVD_MECH', name: 'Property Valuation Department - Mechanical Section' },
] as const;

const ORGANIZATIONS = [
  { code: 'HO', name: 'Head Office', type: 'HEAD_OFFICE_UNIT', parent: null },
  { code: 'HO_CREDIT', name: 'Head Office - Credit Appraisal', type: 'HEAD_OFFICE_UNIT', parent: 'HO' },
  { code: 'DIST_ADDIS', name: 'Addis Ababa District', type: 'DISTRICT', parent: 'HO' },
  { code: 'DIST_BAHIRDAR', name: 'Bahir Dar District', type: 'DISTRICT', parent: 'HO' },
  { code: 'BR_MEXICO', name: 'Mexico Branch', type: 'BRANCH', parent: 'DIST_ADDIS' },
  { code: 'BR_BOLE', name: 'Bole Branch', type: 'BRANCH', parent: 'DIST_ADDIS' },
  { code: 'BR_MERKATO', name: 'Merkato Branch', type: 'BRANCH', parent: 'DIST_ADDIS' },
  { code: 'BR_BAHIRDAR', name: 'Bahir Dar Branch', type: 'BRANCH', parent: 'DIST_BAHIRDAR' },
] as const;

export async function seedOrganizations(prisma: PrismaClient): Promise<void> {
  for (const department of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: department.code },
      update: { name: department.name },
      create: { code: department.code, name: department.name },
    });
  }
  console.warn(`  departments: ${DEPARTMENTS.length}`);

  // Two passes: every parent must exist before a child references it.
  for (const org of ORGANIZATIONS) {
    await prisma.organization.upsert({
      where: { code: org.code },
      update: { name: org.name, type: org.type },
      create: { code: org.code, name: org.name, type: org.type },
    });
  }

  for (const org of ORGANIZATIONS) {
    if (!org.parent) continue;
    const parent = await prisma.organization.findUniqueOrThrow({ where: { code: org.parent } });
    await prisma.organization.update({
      where: { code: org.code },
      data: { parentId: parent.id },
    });
  }
  console.warn(`  organizations: ${ORGANIZATIONS.length}`);
}
