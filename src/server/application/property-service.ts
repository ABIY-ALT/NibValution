import { prisma, withTransaction } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import { assertPermission, canAccessCase, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { getNumberConfig } from './configuration-service';
import { invalidateValuation } from './valuation-state';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import type { RequestContextInput } from './case-service';
import type {
  BuildingInput,
  CivilPropertyInput,
  MachineryInput,
  VehicleInput,
} from '@/lib/validation/property';

/**
 * Property registration (spec sections 6 and 7).
 *
 * The per-case limits — 40 buildings, 300 mechanical items — are enforced here
 * against a configuration value rather than a constant, and they are checked
 * inside the same transaction that inserts the row. Checking before the
 * transaction would let two concurrent submissions both pass the count and both
 * insert, which is exactly how a "maximum" quietly becomes a suggestion.
 */

const EDITABLE_STATUSES = new Set([
  'DRAFT',
  'REQUESTED',
  'AWAITING_REQUESTER',
  'ASSIGNED',
  'ON_PROGRESS',
  'NOT_VISITED',
  'PENDING',
  'RETURNED_FOR_CORRECTION',
]);

/** Load the case and assert the caller may edit its property data. */
async function editableCase(actor: Actor, caseId: string) {
  const record_ = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      discipline: true,
      requestingOrgId: true,
      departmentId: true,
      requestedById: true,
      makerId: true,
      checkerId: true,
    },
  });

  if (!record_ || !canAccessCase(actor, record_, PERMISSIONS.CASE_READ)) {
    throw new NotFoundError('The requested case was not found.');
  }

  if (!canAccessCase(actor, record_, PERMISSIONS.VALUATION_EDIT)) {
    throw new BusinessRuleError(
      'NOT_YOUR_CASE',
      'Property details are recorded by the valuator assigned to this case.',
    );
  }

  if (!EDITABLE_STATUSES.has(record_.status)) {
    throw new BusinessRuleError(
      'CASE_NOT_EDITABLE',
      `Property details cannot be changed while the case is "${record_.status}".`,
    );
  }

  return record_;
}

/** Read-only load, for anyone entitled to see the case. */
async function readableCase(actor: Actor, caseId: string) {
  const record_ = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      status: true,
      discipline: true,
      requestingOrgId: true,
      departmentId: true,
      requestedById: true,
      makerId: true,
      checkerId: true,
    },
  });
  if (!record_ || !canAccessCase(actor, record_, PERMISSIONS.CASE_READ)) {
    throw new NotFoundError('The requested case was not found.');
  }
  return record_;
}

// ---------------------------------------------------------------------------
// Civil
// ---------------------------------------------------------------------------

export async function loadCivilProperty(actor: Actor, caseId: string) {
  assertPermission(actor, PERMISSIONS.CASE_READ);
  await readableCase(actor, caseId);

  return prisma.civilProperty.findUnique({
    where: { caseId },
    include: {
      category: { select: { code: true, name: true } },
      buildings: { orderBy: { buildingNumber: 'asc' } },
    },
  });
}

export async function saveCivilProperty(
  actor: Actor,
  input: CivilPropertyInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  const owningCase = await editableCase(actor, input.caseId);

  if (owningCase.discipline !== 'CIVIL') {
    throw new BusinessRuleError('WRONG_DISCIPLINE', 'This is not a civil valuation case.');
  }

  const category = await prisma.propertyCategory.findUnique({
    where: { code: input.categoryCode },
  });
  if (!category || category.discipline !== 'CIVIL' || !category.isActive) {
    throw new BusinessRuleError('UNKNOWN_CATEGORY', 'That property category is not available.');
  }

  // Lease-held land needs its lease terms; without them the land cannot be
  // valued at all (assumption 3.5).
  if (
    (input.landHoldingRight === 'LEASE' || input.landHoldingRight === 'BOTH') &&
    input.leaseRemainingYears === undefined
  ) {
    throw new BusinessRuleError(
      'LEASE_TERMS_REQUIRED',
      'Lease-held land requires the remaining lease term, which the land valuation depends on.',
    );
  }

  const data = {
    categoryId: category.id,
    lhcNumber: input.lhcNumber ?? null,
    subCity: input.subCity ?? null,
    woreda: input.woreda ?? null,
    kebele: input.kebele ?? null,
    houseNumber: input.houseNumber ?? null,
    geographicLocation: input.geographicLocation ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    landHoldingRight: input.landHoldingRight,
    plotArea: input.plotArea ?? null,
    leaseRemainingYears: input.leaseRemainingYears ?? null,
    leaseUnpaidBalance: input.leaseUnpaidBalance ?? null,
    leaseAnnualRate: input.leaseAnnualRate ?? null,
    boundaryDescription: input.boundaryDescription ?? null,
    remarks: input.remarks ?? null,
  };

  await withTransaction(async (tx) => {
    const before = await tx.civilProperty.findUnique({ where: { caseId: input.caseId } });

    await tx.civilProperty.upsert({
      where: { caseId: input.caseId },
      update: data,
      create: { caseId: input.caseId, ...data },
    });
    await invalidateValuation(tx, input.caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: before ? 'CASE_UPDATED' : 'CASE_CREATED',
      entity: 'CivilProperty',
      entityId: input.caseId,
      before: before
        ? { lhcNumber: before.lhcNumber, landHoldingRight: before.landHoldingRight }
        : undefined,
      after: {
        lhcNumber: data.lhcNumber,
        landHoldingRight: data.landHoldingRight,
        category: category.code,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

export async function saveBuilding(
  actor: Actor,
  input: BuildingInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  await editableCase(actor, input.caseId);

  const maxBuildings = await getNumberConfig('case.max_buildings', 40);

  const property = await prisma.civilProperty.findUnique({
    where: { caseId: input.caseId },
    select: { id: true },
  });
  if (!property) {
    throw new BusinessRuleError(
      'PROPERTY_REQUIRED',
      'Record the land and property details before adding buildings.',
    );
  }

  // A building under construction without a progress figure cannot be valued
  // (assumption 3.6); the database enforces this too.
  if (input.constructionStatus === 'UNDER_CONSTRUCTION' && input.progressPercent === undefined) {
    throw new BusinessRuleError(
      'PROGRESS_REQUIRED',
      'A building under construction needs a completion percentage, which its valuation depends on.',
    );
  }

  const category = input.categoryCode
    ? await prisma.propertyCategory.findUnique({ where: { code: input.categoryCode } })
    : null;

  const data = {
    buildingNumber: input.buildingNumber,
    buildingType: input.buildingType,
    categoryId: category?.id ?? null,
    floorCount: input.floorCount ?? null,
    grossArea: input.grossArea ?? null,
    builtUpArea: input.builtUpArea ?? null,
    constructionStatus: input.constructionStatus,
    constructionYear: input.constructionYear ?? null,
    condition: input.condition ?? null,
    progressPercent: input.progressPercent ?? null,
    remarks: input.remarks ?? null,
  };

  await withTransaction(async (tx) => {
    if (!input.buildingId) {
      // Counted inside the transaction, so two concurrent adds cannot both
      // slip past the limit.
      const count = await tx.civilBuilding.count({ where: { propertyId: property.id } });
      if (count >= maxBuildings) {
        throw new BusinessRuleError(
          'TOO_MANY_BUILDINGS',
          `A case may hold at most ${maxBuildings} buildings.`,
        );
      }
    }

    const saved = input.buildingId
      ? await tx.civilBuilding.update({ where: { id: input.buildingId }, data })
      : await tx.civilBuilding.create({ data: { propertyId: property.id, ...data } });
    await invalidateValuation(tx, input.caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: input.buildingId ? 'CASE_UPDATED' : 'CASE_CREATED',
      entity: 'CivilBuilding',
      entityId: saved.id,
      after: {
        caseId: input.caseId,
        buildingNumber: data.buildingNumber,
        buildingType: data.buildingType,
        constructionStatus: data.constructionStatus,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

export async function deleteBuilding(
  actor: Actor,
  caseId: string,
  buildingId: string,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  await editableCase(actor, caseId);

  await withTransaction(async (tx) => {
    const building = await tx.civilBuilding.findUnique({
      where: { id: buildingId },
      include: { property: { select: { caseId: true } } },
    });
    if (!building || building.property.caseId !== caseId) {
      throw new NotFoundError('That building was not found on this case.');
    }

    await tx.civilBuilding.delete({ where: { id: buildingId } });
    await invalidateValuation(tx, caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_UPDATED',
      entity: 'CivilBuilding',
      entityId: buildingId,
      before: { buildingNumber: building.buildingNumber, buildingType: building.buildingType },
      after: { deleted: true, caseId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

// ---------------------------------------------------------------------------
// Mechanical
// ---------------------------------------------------------------------------

export async function loadMechanicalProperty(actor: Actor, caseId: string) {
  assertPermission(actor, PERMISSIONS.CASE_READ);
  await readableCase(actor, caseId);

  return prisma.mechanicalProperty.findUnique({
    where: { caseId },
    include: {
      vehicles: { orderBy: { itemNumber: 'asc' } },
      machinery: { orderBy: { itemNumber: 'asc' } },
    },
  });
}

/** Ensure the mechanical property row exists, so items have somewhere to hang. */
async function ensureMechanicalProperty(caseId: string): Promise<string> {
  const existing = await prisma.mechanicalProperty.findUnique({
    where: { caseId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.mechanicalProperty.create({
    data: { caseId },
    select: { id: true },
  });
  return created.id;
}

export async function saveMechanicalProperty(
  actor: Actor,
  input: {
    caseId: string;
    plantName?: string;
    installationAddress?: string;
    operationalStatus?: string;
    remarks?: string;
  },
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  const owningCase = await editableCase(actor, input.caseId);

  if (owningCase.discipline !== 'MECHANICAL') {
    throw new BusinessRuleError('WRONG_DISCIPLINE', 'This is not a mechanical valuation case.');
  }

  const data = {
    plantName: input.plantName ?? null,
    installationAddress: input.installationAddress ?? null,
    operationalStatus: input.operationalStatus ?? null,
    remarks: input.remarks ?? null,
  };

  await withTransaction(async (tx) => {
    await tx.mechanicalProperty.upsert({
      where: { caseId: input.caseId },
      update: data,
      create: { caseId: input.caseId, ...data },
    });
    await invalidateValuation(tx, input.caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_UPDATED',
      entity: 'MechanicalProperty',
      entityId: input.caseId,
      after: data,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

/** The combined vehicle + machinery count, which is what the 300 limit covers. */
async function assertItemCapacity(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  propertyId: string,
  maxItems: number,
): Promise<void> {
  // Sequential: a transaction's queries share one connection.
  const vehicles = await tx.vehicle.count({ where: { propertyId } });
  const machinery = await tx.machinery.count({ where: { propertyId } });

  if (vehicles + machinery >= maxItems) {
    throw new BusinessRuleError(
      'TOO_MANY_ITEMS',
      `A case may hold at most ${maxItems} mechanical items; this one already has ${vehicles + machinery}.`,
    );
  }
}

/** Next free item number across both vehicles and machinery. */
async function nextItemNumber(
  tx: Parameters<Parameters<typeof withTransaction>[0]>[0],
  propertyId: string,
): Promise<number> {
  const vehicle = await tx.vehicle.findFirst({
    where: { propertyId },
    orderBy: { itemNumber: 'desc' },
    select: { itemNumber: true },
  });
  const machine = await tx.machinery.findFirst({
    where: { propertyId },
    orderBy: { itemNumber: 'desc' },
    select: { itemNumber: true },
  });
  return Math.max(vehicle?.itemNumber ?? 0, machine?.itemNumber ?? 0) + 1;
}

export async function saveVehicle(
  actor: Actor,
  input: VehicleInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  await editableCase(actor, input.caseId);

  const propertyId = await ensureMechanicalProperty(input.caseId);
  const maxItems = await getNumberConfig('case.max_mechanical_items', 300);

  const category = input.categoryCode
    ? await prisma.propertyCategory.findUnique({ where: { code: input.categoryCode } })
    : null;

  const data = {
    categoryId: category?.id ?? null,
    ownerName: input.ownerName ?? null,
    plateNumber: input.plateNumber ?? null,
    chassisNumber: input.chassisNumber ?? null,
    engineNumber: input.engineNumber ?? null,
    make: input.make ?? null,
    model: input.model ?? null,
    manufactureYear: input.manufactureYear ?? null,
    capacity: input.capacity ?? null,
    horsePower: input.horsePower ?? null,
    cylinderCount: input.cylinderCount ?? null,
    axleNumber: input.axleNumber ?? null,
    colour: input.colour ?? null,
    libreReference: input.libreReference ?? null,
    condition: input.condition ?? null,
    mileage: input.mileage ?? null,
    remarks: input.remarks ?? null,
  };

  await withTransaction(async (tx) => {
    if (!input.vehicleId) await assertItemCapacity(tx, propertyId, maxItems);

    const saved = input.vehicleId
      ? await tx.vehicle.update({ where: { id: input.vehicleId }, data })
      : await tx.vehicle.create({
          data: { propertyId, itemNumber: await nextItemNumber(tx, propertyId), ...data },
        });
    await invalidateValuation(tx, input.caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: input.vehicleId ? 'CASE_UPDATED' : 'CASE_CREATED',
      entity: 'Vehicle',
      entityId: saved.id,
      after: {
        caseId: input.caseId,
        plateNumber: data.plateNumber,
        chassisNumber: data.chassisNumber,
        model: data.model,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

export async function saveMachinery(
  actor: Actor,
  input: MachineryInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  await editableCase(actor, input.caseId);

  const propertyId = await ensureMechanicalProperty(input.caseId);
  const maxItems = await getNumberConfig('case.max_mechanical_items', 300);

  const category = input.categoryCode
    ? await prisma.propertyCategory.findUnique({ where: { code: input.categoryCode } })
    : null;

  const data = {
    categoryId: category?.id ?? null,
    ownerName: input.ownerName ?? null,
    equipmentName: input.equipmentName,
    manufacturer: input.manufacturer ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    manufactureYear: input.manufactureYear ?? null,
    capacity: input.capacity ?? null,
    countryOfOrigin: input.countryOfOrigin ?? null,
    installationLocation: input.installationLocation ?? null,
    condition: input.condition ?? null,
    purchasePrice: input.purchasePrice ?? null,
    insuranceValue: input.insuranceValue ?? null,
    cifValue: input.cifValue ?? null,
    remainingLifeYears: input.remainingLifeYears ?? null,
    remarks: input.remarks ?? null,
  };

  await withTransaction(async (tx) => {
    if (!input.machineryId) await assertItemCapacity(tx, propertyId, maxItems);

    const saved = input.machineryId
      ? await tx.machinery.update({ where: { id: input.machineryId }, data })
      : await tx.machinery.create({
          data: { propertyId, itemNumber: await nextItemNumber(tx, propertyId), ...data },
        });
    await invalidateValuation(tx, input.caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: input.machineryId ? 'CASE_UPDATED' : 'CASE_CREATED',
      entity: 'Machinery',
      entityId: saved.id,
      after: {
        caseId: input.caseId,
        equipmentName: data.equipmentName,
        serialNumber: data.serialNumber,
        manufacturer: data.manufacturer,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

export async function deleteMechanicalItem(
  actor: Actor,
  caseId: string,
  itemId: string,
  kind: 'VEHICLE' | 'MACHINERY',
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  await editableCase(actor, caseId);

  await withTransaction(async (tx) => {
    const property = await tx.mechanicalProperty.findUnique({
      where: { caseId },
      select: { id: true },
    });
    if (!property) throw new NotFoundError('That item was not found on this case.');

    if (kind === 'VEHICLE') {
      const item = await tx.vehicle.findUnique({ where: { id: itemId } });
      if (!item || item.propertyId !== property.id) {
        throw new NotFoundError('That item was not found on this case.');
      }
      await tx.vehicle.delete({ where: { id: itemId } });
    } else {
      const item = await tx.machinery.findUnique({ where: { id: itemId } });
      if (!item || item.propertyId !== property.id) {
        throw new NotFoundError('That item was not found on this case.');
      }
      await tx.machinery.delete({ where: { id: itemId } });
    }
    await invalidateValuation(tx, caseId);

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_UPDATED',
      entity: kind === 'VEHICLE' ? 'Vehicle' : 'Machinery',
      entityId: itemId,
      after: { deleted: true, caseId },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

/** Categories available for a discipline, for the registration selects. */
export async function listPropertyCategories(discipline: 'CIVIL' | 'MECHANICAL') {
  return prisma.propertyCategory.findMany({
    where: { discipline, isActive: true },
    orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    select: { code: true, name: true, parent: { select: { name: true } } },
  });
}

/** Whether the caller may edit this case's property data right now. */
export async function canEditProperty(actor: Actor, caseId: string): Promise<boolean> {
  try {
    await editableCase(actor, caseId);
    return true;
  } catch {
    return false;
  }
}
