import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/infrastructure/db/client';
import { assertPermission, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { caseScopeFilter } from './dashboard-service';

/**
 * The civil and mechanical property registers (`/civil`, `/mechanical`).
 *
 * A register is a view over cases, so it is scoped exactly as the case list
 * is: a branch sees its own collateral, the department sees its own, oversight
 * roles see the bank. The pages previously queried every property in the
 * database, so a branch user could read another branch's owners, LHC numbers
 * and plates (spec section 26). Search runs in the database over the whole
 * scoped register - not over the latest hundred rows - and the totals count
 * everything the viewer may see, never just the page on screen.
 */

export interface RegisterFilter {
  search?: string;
  page?: number;
  pageSize?: number;
}

const CASE_SELECT = {
  id: true,
  caseNumber: true,
  applicantName: true,
  ownerName: true,
} as const;

const GOOD_CONDITION = ['EXCELLENT', 'VERY_GOOD', 'GOOD'] as const;

function paging(filter: RegisterFilter) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, filter.pageSize ?? 10));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

const like = (term: string) => ({ contains: term, mode: 'insensitive' as const });

export async function listCivilRegister(actor: Actor, filter: RegisterFilter = {}) {
  assertPermission(actor, PERMISSIONS.VALUATION_READ);

  const scope: Prisma.CivilPropertyWhereInput = { case: caseScopeFilter(actor) };
  const term = filter.search?.trim();
  const where: Prisma.CivilPropertyWhereInput = term
    ? {
        AND: [
          scope,
          {
            OR: [
              { lhcNumber: like(term) },
              { subCity: like(term) },
              { woreda: like(term) },
              { case: { caseNumber: like(term) } },
              { case: { applicantName: like(term) } },
              { case: { ownerName: like(term) } },
            ],
          },
        ],
      }
    : scope;
  const { page, pageSize, skip } = paging(filter);

  const [rows, total, totals, buildings, locations] = await Promise.all([
    prisma.civilProperty.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        case: { select: { ...CASE_SELECT, status: true } },
        category: { select: { name: true, code: true } },
        _count: { select: { buildings: true } },
      },
    }),
    prisma.civilProperty.count({ where }),
    prisma.civilProperty.aggregate({
      where: scope,
      _count: { _all: true },
      _sum: { plotArea: true },
    }),
    prisma.civilBuilding.count({ where: { property: scope } }),
    prisma.civilProperty.findMany({
      where: { AND: [scope, { subCity: { not: null } }] },
      distinct: ['subCity'],
      select: { subCity: true },
    }),
  ]);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      properties: totals._count._all,
      buildings,
      plotArea: totals._sum.plotArea?.toString() ?? '0',
      locations: locations.length,
    },
  };
}

export type MechanicalTab = 'vehicles' | 'machinery';

export async function listMechanicalRegister(
  actor: Actor,
  filter: RegisterFilter & { tab: MechanicalTab },
) {
  assertPermission(actor, PERMISSIONS.VALUATION_READ);

  const caseScope = caseScopeFilter(actor);
  const itemScope = { property: { case: caseScope } };
  const term = filter.search?.trim();
  const byCase = term
    ? [
        { property: { case: { caseNumber: like(term) } } },
        { property: { case: { applicantName: like(term) } } },
      ]
    : [];
  const vehicleWhere: Prisma.VehicleWhereInput = term
    ? {
        AND: [
          itemScope,
          {
            OR: [
              { plateNumber: like(term) },
              { chassisNumber: like(term) },
              { make: like(term) },
              { model: like(term) },
              ...byCase,
            ],
          },
        ],
      }
    : itemScope;
  const machineryWhere: Prisma.MachineryWhereInput = term
    ? {
        AND: [
          itemScope,
          {
            OR: [
              { equipmentName: like(term) },
              { serialNumber: like(term) },
              { manufacturer: like(term) },
              ...byCase,
            ],
          },
        ],
      }
    : itemScope;
  const { page, pageSize, skip } = paging(filter);
  const include = {
    property: { select: { case: { select: CASE_SELECT } } },
    category: { select: { name: true } },
  } as const;

  const [
    vehicles,
    machinery,
    total,
    packages,
    vehicleCount,
    machineryCount,
    goodVehicles,
    goodMachinery,
  ] = await Promise.all([
    filter.tab === 'vehicles'
      ? prisma.vehicle.findMany({
          where: vehicleWhere,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include,
        })
      : Promise.resolve([]),
    filter.tab === 'machinery'
      ? prisma.machinery.findMany({
          where: machineryWhere,
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          include,
        })
      : Promise.resolve([]),
    filter.tab === 'vehicles'
      ? prisma.vehicle.count({ where: vehicleWhere })
      : prisma.machinery.count({ where: machineryWhere }),
    prisma.mechanicalProperty.count({ where: { case: caseScope } }),
    prisma.vehicle.count({ where: itemScope }),
    prisma.machinery.count({ where: itemScope }),
    prisma.vehicle.count({
      where: { AND: [itemScope, { condition: { in: [...GOOD_CONDITION] } }] },
    }),
    prisma.machinery.count({
      where: { AND: [itemScope, { condition: { in: [...GOOD_CONDITION] } }] },
    }),
  ]);

  return {
    vehicles,
    machinery,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    summary: {
      packages,
      vehicles: vehicleCount,
      machinery: machineryCount,
      goodCondition: goodVehicles + goodMachinery,
    },
  };
}
