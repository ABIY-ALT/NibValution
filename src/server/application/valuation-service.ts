import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, withTransaction, type TransactionClient } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import {
  assertCaseAccess,
  assertPermission,
  canAccessCase,
  type Actor,
} from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import {
  FORMULA_VERSIONS,
  canonicalJson,
  runEngine,
  type EngineInput,
  type EngineName,
} from '@/server/domain/valuation/calculation';
import { tableKeys, type EngineParameters } from '@/server/domain/valuation/common';
import type { CivilEngineInput, CivilEngineOutput } from '@/server/domain/valuation/civil-engine';
import { civilGuide, type CivilGuide } from '@/server/domain/valuation/civil/guide';
import { selectCivilParameters } from '@/server/domain/valuation/civil/select-parameters';
import type {
  MechanicalEngineInput,
  MechanicalEngineOutput,
} from '@/server/domain/valuation/mechanical-engine';
import {
  CASE_STATUS_LABELS,
  type CaseStatus,
  type SiteVisitCheck,
} from '@/server/domain/shared/enums';
import { ON_SITE_CHECKS, assessCheckIn } from '@/server/domain/site-visit/location-check';
import { dec } from '@/lib/money';
import { BusinessRuleError, NotFoundError, assertUuid } from '@/lib/errors';
import type {
  CalculateRequest,
  CivilWorksheet,
  MechanicalWorksheet,
  SiteVisitInput,
} from '@/lib/validation/valuation';
import { getNumberConfig, loadParameterSnapshot } from './configuration-service';
import { canEditProperty, listPropertyCategories } from './property-service';
import { invalidateValuation, verifyCurrentValuation } from './valuation-state';
import { dispatchCaseEvents, eventForSiteVisit } from './notification-dispatch';
import type { RequestContextInput } from './case-service';

/**
 * Valuation (spec sections 9-13, 28 and 29; roadmap Phase 3).
 *
 * The valuator's worksheet and the registered property are assembled into one
 * engine input, run against the parameter set in force on the valuation date,
 * and persisted in a single transaction:
 *
 *   - the current `Valuation` version, with its market and forced-sale values;
 *   - the approach rows (cost, sales, reconciliation, forced sale) a report
 *     reads;
 *   - an append-only `CalculationRun` holding the complete input, the parameter
 *     snapshot and the output, which is what makes the figure reproducible;
 *   - the case's final value, which drives approval routing;
 *   - an audit record.
 *
 * Figures are computed here, on the server, only. The browser sends the inputs
 * and receives the result; it never sends a value to be stored.
 */

/** Statuses in which the assigned Maker may (re)calculate. */
const CALCULABLE = new Set<CaseStatus>(['ON_PROGRESS', 'RETURNED_FOR_CORRECTION']);

/** Statuses in which a site visit may be recorded. */
const VISITABLE = new Set<CaseStatus>([
  'ASSIGNED',
  'ON_PROGRESS',
  'NOT_VISITED',
  'PENDING',
  'RETURNED_FOR_CORRECTION',
]);

const SUBJECT_SELECT = {
  id: true,
  caseNumber: true,
  status: true,
  discipline: true,
  requestingOrgId: true,
  departmentId: true,
  requestedById: true,
  makerId: true,
  checkerId: true,
} as const;

async function loadSubject(caseId: string) {
  return prisma.valuationCase.findUnique({ where: { id: caseId }, select: SUBJECT_SELECT });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function toEngineParameters(snapshot: {
  setCode: string;
  setVersion: number;
  values: Record<string, string>;
  tables: Record<string, unknown>;
}): EngineParameters {
  return {
    setCode: snapshot.setCode,
    setVersion: snapshot.setVersion,
    values: snapshot.values,
    tables: snapshot.tables,
  };
}

/** The reproducibility fingerprint: engine, formula, parameters and input together. */
function inputHash(engine: EngineName, params: EngineParameters, input: EngineInput): string {
  return createHash('sha256')
    .update(canonicalJson({ engine, formulaVersion: FORMULA_VERSIONS[engine], params, input }))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Assembling the engine input
// ---------------------------------------------------------------------------

async function assembleCivil(
  tx: TransactionClient,
  caseId: string,
  worksheet: CivilWorksheet,
): Promise<CivilEngineInput> {
  const property = await tx.civilProperty.findUnique({
    where: { caseId },
    include: { buildings: { orderBy: { buildingNumber: 'asc' } } },
  });
  if (!property) {
    throw new BusinessRuleError(
      'PROPERTY_REQUIRED',
      'Record the land and property details before calculating.',
    );
  }

  const entries = new Map(worksheet.buildings.map((b) => [b.buildingId, b]));

  return {
    valuationDate: worksheet.valuationDate,
    location: worksheet.location,
    land: {
      holdingRight: property.landHoldingRight,
      plotArea: property.plotArea?.toString() ?? null,
      // The coordinates decide which location zone prices the land.
      latitude: property.latitude?.toString() ?? null,
      longitude: property.longitude?.toString() ?? null,
      leaseRemainingYears: property.leaseRemainingYears,
      leaseTotalYears: worksheet.lease.totalYears,
      leaseTotalAmount: worksheet.lease.totalAmount,
      leasePaidAmount: worksheet.lease.paidAmount,
      freeholdArea: worksheet.lease.freeholdArea,
    },
    // Every registered building is valued; the worksheet cannot leave one out,
    // and cannot add one that is not registered.
    buildings: property.buildings.map((building) => {
      const entry = entries.get(building.id);
      if (!entry) {
        throw new BusinessRuleError(
          'VALUATION_INPUT_MISSING',
          `Building ${building.buildingNumber}: choose its building type and components.`,
        );
      }
      return {
        buildingId: building.id,
        buildingNumber: building.buildingNumber,
        name: building.buildingType,
        constructionStatus: building.constructionStatus,
        progressPercent: building.progressPercent?.toString() ?? null,
        floorArea: (building.grossArea ?? building.builtUpArea)?.toString() ?? null,
        builtUpArea: building.builtUpArea?.toString() ?? null,
        costType: entry.costType,
        count: entry.count,
        heightM: entry.heightM,
        components: entry.components,
        newComponents: entry.newComponents,
        defects: entry.defects,
        supplementary: entry.supplementary,
      };
    }),
    siteWorks: worksheet.siteWorks,
    reconciliation: worksheet.reconciliation.override
      ? {
          costWeight: worksheet.reconciliation.costWeight,
          salesWeight: worksheet.reconciliation.salesWeight,
          rationale: worksheet.reconciliation.rationale,
        }
      : null,
    forcedSale: worksheet.forcedSale.override
      ? { percent: worksheet.forcedSale.percent, reason: worksheet.forcedSale.reason }
      : null,
  };
}

async function assembleMechanical(
  tx: TransactionClient,
  caseId: string,
  worksheet: MechanicalWorksheet,
): Promise<MechanicalEngineInput> {
  const property = await tx.mechanicalProperty.findUnique({
    where: { caseId },
    include: {
      vehicles: { orderBy: { itemNumber: 'asc' } },
      machinery: { orderBy: { itemNumber: 'asc' } },
    },
  });

  const entries = new Map(worksheet.items.map((i) => [i.itemId, i]));
  const registered = [
    ...(property?.vehicles ?? []).map((v) => ({
      id: v.id,
      kind: 'VEHICLE' as const,
      itemNumber: v.itemNumber,
      description:
        [v.make, v.model, v.plateNumber ? `(${v.plateNumber})` : null].filter(Boolean).join(' ') ||
        'Vehicle',
      manufactureYear: v.manufactureYear,
      condition: v.condition,
      cifValue: null as string | null,
    })),
    ...(property?.machinery ?? []).map((mc) => ({
      id: mc.id,
      kind: 'MACHINERY' as const,
      itemNumber: mc.itemNumber,
      description: mc.equipmentName,
      manufactureYear: mc.manufactureYear,
      condition: mc.condition,
      cifValue: mc.cifValue?.toString() ?? null,
    })),
  ].sort((a, b) => a.itemNumber - b.itemNumber);

  return {
    valuationDate: worksheet.valuationDate,
    items: registered.map((item) => {
      const entry = entries.get(item.id);
      const label = `${item.kind === 'VEHICLE' ? 'Vehicle' : 'Machine'} ${item.itemNumber}`;
      if (!entry) {
        throw new BusinessRuleError(
          'VALUATION_INPUT_MISSING',
          `${label}: enter how it is to be valued.`,
        );
      }
      return {
        itemId: item.id,
        kind: item.kind,
        itemNumber: item.itemNumber,
        description: item.description,
        manufactureYear: item.manufactureYear,
        condition: item.condition,
        costBasis: entry.costBasis,
        // The worksheet may restate the CIF value from the invoice; otherwise
        // the registered figure is used.
        cifValue: entry.cifValue ?? item.cifValue,
        replacementQuote: entry.replacementQuote,
        equipmentClass: entry.equipmentClass,
        effectiveAgeOverride: entry.effectiveAgeOverride,
        conditionAdjustmentPercent: entry.conditionAdjustmentPercent,
        comparables: entry.comparables,
      };
    }),
    reconciliation: worksheet.reconciliation.override
      ? {
          costWeight: worksheet.reconciliation.costWeight,
          salesWeight: worksheet.reconciliation.salesWeight,
          rationale: worksheet.reconciliation.rationale,
        }
      : null,
    forcedSale: worksheet.forcedSale.override
      ? { percent: worksheet.forcedSale.percent, reason: worksheet.forcedSale.reason }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Persisting the result
// ---------------------------------------------------------------------------

async function clearApproachRows(tx: TransactionClient, valuationId: string): Promise<void> {
  await tx.costApproach.deleteMany({ where: { valuationId } });
  await tx.salesApproach.deleteMany({ where: { valuationId } });
  await tx.reconciliation.deleteMany({ where: { valuationId } });
  await tx.forcedSaleValuation.deleteMany({ where: { valuationId } });
  await tx.mechMarketApproach.deleteMany({ where: { valuationId } });
  await tx.mechCostApproach.deleteMany({ where: { valuationId } });
}

async function writeCivilRows(
  tx: TransactionClient,
  valuationId: string,
  output: CivilEngineOutput,
): Promise<void> {
  const cost = await tx.costApproach.create({
    data: {
      valuationId,
      landValue: output.cost.landValue,
      buildingReplacementCost: output.cost.replacementCost,
      totalDepreciation: output.cost.totalDepreciation,
      adjustments: '0',
      factor: output.cost.factor,
      indicatedValue: output.cost.indicatedValue,
      notes: output.cost.formula,
    },
  });

  // Each row shows the item complete, what was taken off (or held back while
  // it is being built), and what it contributes. The MCF is applied to the
  // total, on the cost-approach row above.
  const progress = output.mode === 'PROGRESS';
  let sequence = 0;
  const works = [
    ...output.siteWorks.civil,
    ...output.siteWorks.gasStation,
    ...output.siteWorks.coffeeSite,
  ];
  const lines: Prisma.CostLineItemCreateManyInput[] = [
    {
      costApproachId: cost.id,
      sequence: ++sequence,
      description: `Land - ${output.land.locationLabel}, ${output.property.city}`,
      unit: 'm²',
      quantity: output.land.plotArea,
      rate: output.land.ratePerSqm,
      formula: `${output.land.holding.formula}; ${output.land.staged.formula}`,
      amount: output.land.locationValue,
      adjustment: dec(output.land.value).minus(output.land.locationValue).toFixed(2),
      adjustedAmount: output.land.value,
    },
    ...output.buildings.map((b) => {
      const stage = progress ? b.current : b.complete;
      return {
        costApproachId: cost.id,
        buildingId: b.buildingId,
        sequence: ++sequence,
        description: `Building ${b.buildingNumber} - ${b.name} (${b.costType})`,
        unit: 'm²',
        quantity: b.costedArea,
        rate: stage.depreciatedRate,
        formula: b.formula,
        amount: b.complete.replacementCost,
        adjustment: dec(b.value).minus(b.complete.replacementCost).toFixed(2),
        adjustedAmount: b.value,
      };
    }),
    ...works.map((w) => ({
      costApproachId: cost.id,
      sequence: ++sequence,
      description: w.description ? `${w.item} - ${w.description}` : w.item,
      unit: null,
      quantity: w.quantity,
      rate: w.rate,
      formula: w.formula,
      amount: w.amount,
      adjustment: dec(w.currentAmount).minus(w.amount).toFixed(2),
      adjustedAmount: w.currentAmount,
    })),
  ];
  await tx.costLineItem.createMany({ data: lines });

  // The guideline's sale approach is a regression, not a set of comparables,
  // so it is one figure with its formula.
  if (output.sales.applicable) {
    await tx.salesApproach.create({
      data: {
        valuationId,
        indicatedValue: output.sales.indicatedValue,
        methodNotes: output.sales.formula,
      },
    });
  }

  await tx.reconciliation.create({
    data: {
      valuationId,
      costValue: output.reconciliation.costValue,
      salesValue: output.reconciliation.salesValue,
      costWeight: output.reconciliation.costWeight,
      salesWeight: output.reconciliation.salesWeight,
      reconciledValue: output.reconciliation.value,
      formula: output.reconciliation.formula,
      rationale: output.reconciliation.rationale,
    },
  });
}

async function writeMechanicalRows(
  tx: TransactionClient,
  valuationId: string,
  output: MechanicalEngineOutput,
): Promise<void> {
  const costItems = output.items.filter((i) => i.cost);
  if (costItems.length > 0) {
    const replacement = dec(output.totals.replacementCost);
    await tx.mechCostApproach.create({
      data: {
        valuationId,
        cifValue: costItems
          .reduce((sum, i) => sum.plus(dec(i.cost?.cifValue ?? '0')), dec(0))
          .toFixed(2),
        loadings: toJson(output.loadings),
        currentReplacementCost: output.totals.replacementCost,
        depreciationAmount: output.totals.depreciation,
        depreciationPercent: replacement.isZero()
          ? '0'
          : dec(output.totals.depreciation).times(100).dividedBy(replacement).toFixed(4),
        conditionAdjustment: output.totals.conditionAdjustment,
        indicatedValue: output.totals.costValue,
        formula: `sum over ${costItems.length} item${costItems.length === 1 ? '' : 's'} valued on cost; each item's working is kept in the calculation run`,
      },
    });
  }

  const marketItems = output.items.filter((i) => i.market);
  if (marketItems.length > 0) {
    const market = await tx.mechMarketApproach.create({
      data: {
        valuationId,
        indicatedValue: output.totals.marketValue,
        notes: `sum over ${marketItems.length} item${marketItems.length === 1 ? '' : 's'} valued on the market`,
      },
    });
    let sequence = 0;
    await tx.comparableEquipment.createMany({
      data: marketItems.flatMap((item) =>
        (item.market?.comparables ?? []).map((c) => ({
          mechMarketApproachId: market.id,
          sequence: ++sequence,
          description: `Item ${item.itemNumber}: ${c.description}`,
          source: c.source,
          marketPrice: c.marketPrice,
          conditionAdjustment: c.conditionAdjustment,
          ageAdjustment: c.ageAdjustment,
          locationAdjustment: c.locationAdjustment,
          otherAdjustment: c.otherAdjustment,
          netAdjustmentPercent: c.netAdjustmentPercent,
          adjustedValue: c.adjustedValue,
        })),
      ),
    });
  }

  await tx.reconciliation.create({
    data: {
      valuationId,
      costValue: output.totals.costValue,
      salesValue: marketItems.length > 0 ? output.totals.marketValue : null,
      costWeight: output.reconciliation.costWeight,
      salesWeight: output.reconciliation.salesWeight,
      reconciledValue: output.reconciliation.value,
      formula: output.reconciliation.formula,
      rationale: output.reconciliation.rationale,
    },
  });
}

// ---------------------------------------------------------------------------
// Calculate
// ---------------------------------------------------------------------------

export interface CalculationSummary {
  marketValue: string;
  forcedSaleValue: string;
  version: number;
}

export async function calculateValuation(
  actor: Actor,
  request: CalculateRequest,
  ctx: RequestContextInput,
): Promise<CalculationSummary> {
  assertPermission(actor, PERMISSIONS.VALUATION_CALCULATE);

  const subject = await loadSubject(request.caseId);
  if (!subject) throw new NotFoundError('The requested case was not found.');
  assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_CALCULATE);

  if (subject.discipline !== request.discipline) {
    throw new BusinessRuleError('WRONG_DISCIPLINE', 'The worksheet does not match this case.');
  }

  const engine: EngineName = request.discipline;
  const valuationDate = new Date(`${request.worksheet.valuationDate}T00:00:00.000Z`);
  // The parameter set in force on the valuation date, not today's: a
  // backdated valuation must use the rules that applied then.
  const snapshot = await loadParameterSnapshot(valuationDate);
  const setParams = toEngineParameters(snapshot);

  return withTransaction(async (tx) => {
    // Serialise against a concurrent submit-for-checking on the same case.
    await tx.$queryRaw`SELECT id FROM valuation_cases WHERE id = ${request.caseId}::uuid FOR UPDATE`;
    const locked = await tx.valuationCase.findUniqueOrThrow({
      where: { id: request.caseId },
      select: { status: true },
    });
    if (!CALCULABLE.has(locked.status as CaseStatus)) {
      throw new BusinessRuleError(
        'CASE_NOT_CALCULABLE',
        `The valuation can be calculated while the case is On Progress or Returned for Correction; it is "${
          CASE_STATUS_LABELS[locked.status as CaseStatus] ?? locked.status
        }".`,
      );
    }

    const input =
      request.discipline === 'CIVIL'
        ? await assembleCivil(tx, request.caseId, request.worksheet)
        : await assembleMechanical(tx, request.caseId, request.worksheet);

    // A civil run keeps the part of the guideline it reads, not all of it: the
    // stored snapshot is then the working of this case and nothing else.
    const params =
      request.discipline === 'CIVIL'
        ? selectCivilParameters(setParams, input as CivilEngineInput)
        : setParams;

    const output = runEngine(engine, input, params);

    const current = await tx.valuation.findFirst({
      where: { caseId: request.caseId, isCurrent: true },
    });
    if (current?.frozenAt) {
      throw new BusinessRuleError(
        'VALUATION_FROZEN',
        'The current valuation has been approved and is frozen; it can no longer be recalculated.',
      );
    }

    const data = {
      status: 'DRAFT' as const,
      discipline: engine,
      preparedById: actor.id,
      marketValue: output.marketValue,
      forcedSaleValue: output.forcedSaleValue,
      formulaVersion: FORMULA_VERSIONS[engine],
      parameterSetId: snapshot.setId,
      valuationDate,
      remarks: request.worksheet.remarks,
    };

    let valuation: { id: string; version: number };
    if (current) {
      valuation = await tx.valuation.update({
        where: { id: current.id },
        data,
        select: { id: true, version: true },
      });
      await clearApproachRows(tx, valuation.id);
    } else {
      const latest = await tx.valuation.findFirst({
        where: { caseId: request.caseId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      valuation = await tx.valuation.create({
        data: {
          caseId: request.caseId,
          version: (latest?.version ?? 0) + 1,
          isCurrent: true,
          ...data,
        },
        select: { id: true, version: true },
      });
    }

    if (engine === 'CIVIL') {
      await writeCivilRows(tx, valuation.id, output as unknown as CivilEngineOutput);
    } else {
      await writeMechanicalRows(tx, valuation.id, output as unknown as MechanicalEngineOutput);
    }

    const forced = (output as unknown as CivilEngineOutput | MechanicalEngineOutput).forcedSale;
    await tx.forcedSaleValuation.create({
      data: {
        valuationId: valuation.id,
        marketValue: forced.marketValue,
        forcedSalePercent: forced.percent,
        forcedSaleValue: forced.value,
        formula: forced.formula,
        isOverridden: forced.isOverridden,
        overrideReason: forced.reason,
      },
    });

    const hash = inputHash(engine, params, input);
    await tx.calculationRun.create({
      data: {
        valuationId: valuation.id,
        engine,
        formulaVersion: FORMULA_VERSIONS[engine],
        parameterSnapshot: toJson({ setId: snapshot.setId, ...params }),
        inputSnapshot: toJson({ engine: input, worksheet: request.worksheet }),
        outputSnapshot: toJson(output),
        inputHash: hash,
        performedById: actor.id,
      },
    });

    await tx.valuationCase.update({
      where: { id: request.caseId },
      data: { finalValue: output.marketValue, forcedSaleValue: output.forcedSaleValue },
    });

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CALCULATION_PERFORMED',
      entity: 'Valuation',
      entityId: valuation.id,
      after: {
        caseId: request.caseId,
        version: valuation.version,
        engine,
        formulaVersion: FORMULA_VERSIONS[engine],
        parameterSet: `${params.setCode} v${params.setVersion}`,
        marketValue: output.marketValue,
        forcedSaleValue: output.forcedSaleValue,
        inputHash: hash,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });

    return {
      marketValue: output.marketValue,
      forcedSaleValue: output.forcedSaleValue,
      version: valuation.version,
    };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ValuationSummary {
  version: number;
  marketValue: string | null;
  forcedSaleValue: string | null;
  valuationDate: string | null;
  calculatedAt: Date | null;
  calculatedBy: string | null;
  /** Calculated once, then cleared by a later property change. */
  stale: boolean;
}

async function currentValuationSummary(caseId: string): Promise<ValuationSummary | null> {
  const valuation = await prisma.valuation.findFirst({
    where: { caseId, isCurrent: true },
    select: {
      id: true,
      version: true,
      marketValue: true,
      forcedSaleValue: true,
      valuationDate: true,
      calculationRuns: {
        orderBy: { performedAt: 'desc' },
        take: 1,
        select: { performedAt: true, performedBy: { select: { fullName: true } } },
      },
    },
  });
  if (!valuation) return null;
  const run = valuation.calculationRuns[0];
  return {
    version: valuation.version,
    marketValue: valuation.marketValue?.toString() ?? null,
    forcedSaleValue: valuation.forcedSaleValue?.toString() ?? null,
    valuationDate: valuation.valuationDate?.toISOString().slice(0, 10) ?? null,
    calculatedAt: run?.performedAt ?? null,
    calculatedBy: run?.performedBy.fullName ?? null,
    stale: valuation.marketValue === null && run !== undefined,
  };
}

/** The headline figures for the case page; null when nothing has been calculated. */
export async function loadValuationSummary(
  actor: Actor,
  caseId: string,
): Promise<ValuationSummary | null> {
  const subject = await loadSubject(caseId);
  if (!subject || !canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ)) return null;
  return currentValuationSummary(caseId);
}

export interface ParameterGuide {
  setCode: string;
  setVersion: number;
  /** Choices for each building, with their economic life in years. */
  constructionTypes: { key: string; years: string }[];
  equipmentClasses: { key: string; years: string }[];
  costWeight: string | null;
  salesWeight: string | null;
  forcedSalePercent: string | null;
  mcf: string | null;
  depreciationMethod: string | null;
  residualPercent: string | null;
  leaseBasis: string | null;
  cifLoadingsPercent: string | null;
  /** The guideline's choice lists; null where its tables are not installed. */
  civil: CivilGuide | null;
}

/** The keys of an economic-life table, DEFAULT last, with their years. */
function lifeOptions(tables: Record<string, unknown>, key: string) {
  const table = (tables[key] ?? {}) as Record<string, number | string>;
  const keys = [...tableKeys(tables, key), ...('DEFAULT' in table ? ['DEFAULT'] : [])];
  return keys.map((k) => ({ key: k, years: String(table[k]) }));
}

function parameterGuide(
  snapshot: Awaited<ReturnType<typeof loadParameterSnapshot>>,
  discipline: 'CIVIL' | 'MECHANICAL',
): ParameterGuide {
  const loadings = snapshot.tables['mechanical.cif_loadings'] as Record<string, number> | undefined;
  return {
    setCode: snapshot.setCode,
    setVersion: snapshot.setVersion,
    constructionTypes: lifeOptions(snapshot.tables, 'depreciation.economic_life'),
    equipmentClasses: lifeOptions(snapshot.tables, 'mechanical.economic_life'),
    costWeight: snapshot.values['reconciliation.cost_weight'] ?? null,
    salesWeight: snapshot.values['reconciliation.sales_weight'] ?? null,
    forcedSalePercent: snapshot.values['forced_sale.percent'] ?? null,
    mcf: snapshot.values['cost_approach.mcf'] ?? null,
    depreciationMethod:
      (snapshot.tables['depreciation.method'] as { method?: string } | undefined)?.method ?? null,
    residualPercent: snapshot.values['depreciation.residual_percent'] ?? null,
    leaseBasis:
      (snapshot.tables['land.lease_valuation_basis'] as { basis?: string } | undefined)?.basis ??
      null,
    cifLoadingsPercent: loadings
      ? Object.values(loadings)
          .reduce((sum, v) => sum.plus(dec(v)), dec(0))
          .toString()
      : null,
    civil: discipline === 'CIVIL' ? civilGuide(snapshot.tables) : null,
  };
}

/** Everything the valuation workspace renders, in one scoped load. */
export async function loadValuationWorkspace(actor: Actor, caseId: string) {
  assertPermission(actor, PERMISSIONS.CASE_READ);
  assertUuid(caseId, 'The requested case was not found.');

  const subject = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: {
      ...SUBJECT_SELECT,
      ownerName: true,
      applicantName: true,
      requestType: { select: { name: true } },
      maker: { select: { fullName: true } },
    },
  });
  if (!subject || !canAccessCase(actor, subject, PERMISSIONS.CASE_READ)) {
    throw new NotFoundError('The requested case was not found.');
  }
  const canRead = canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ);
  if (!canRead) return { subject, canRead: false as const };

  const status = subject.status as CaseStatus;
  const discipline = subject.discipline as 'CIVIL' | 'MECHANICAL';

  const [editable, snapshot, summary, categories, civil, mechanical, run, siteVisits] =
    await Promise.all([
      canEditProperty(actor, caseId),
      loadParameterSnapshot(),
      currentValuationSummary(caseId),
      listPropertyCategories(discipline),
      discipline === 'CIVIL'
        ? prisma.civilProperty.findUnique({
            where: { caseId },
            include: {
              category: { select: { code: true, name: true } },
              buildings: {
                orderBy: { buildingNumber: 'asc' },
                include: { category: { select: { code: true } } },
              },
            },
          })
        : null,
      discipline === 'MECHANICAL'
        ? prisma.mechanicalProperty.findUnique({
            where: { caseId },
            include: {
              vehicles: {
                orderBy: { itemNumber: 'asc' },
                include: { category: { select: { code: true } } },
              },
              machinery: {
                orderBy: { itemNumber: 'asc' },
                include: { category: { select: { code: true } } },
              },
            },
          })
        : null,
      prisma.calculationRun.findFirst({
        where: { valuation: { caseId, isCurrent: true } },
        orderBy: { performedAt: 'desc' },
        select: {
          id: true,
          engine: true,
          formulaVersion: true,
          inputHash: true,
          performedAt: true,
          inputSnapshot: true,
          outputSnapshot: true,
          parameterSnapshot: true,
          performedBy: { select: { fullName: true } },
        },
      }),
      prisma.siteVisit.findMany({
        where: { caseId },
        orderBy: { visitedAt: 'desc' },
        include: {
          visitedBy: { select: { fullName: true } },
          photos: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: 'asc' },
            select: {
              id: true,
              uploadedAt: true,
              scanStatus: true,
              locationCheck: true,
              distanceMeters: true,
              accuracyMeters: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      }),
    ]);

  const canCalculate =
    canAccessCase(actor, subject, PERMISSIONS.VALUATION_CALCULATE) && CALCULABLE.has(status);
  const canRecordVisit =
    canAccessCase(actor, subject, PERMISSIONS.VALUATION_EDIT) && VISITABLE.has(status);
  const maxAccuracyMeters = await getNumberConfig('site_visit.max_accuracy_meters', 100);

  const runParams = run?.parameterSnapshot as unknown as EngineParameters | undefined;
  // Re-run the stored calculation, as the submit and complete-checking guards
  // do, so the checker sees whether the figures stand before relying on them.
  const verified = run ? await verifyCurrentValuation(prisma, caseId) : false;

  return {
    subject,
    canRead: true as const,
    discipline,
    canEditProperty: editable,
    canCalculate,
    canRecordVisit,
    guide: parameterGuide(snapshot, discipline),
    summary,
    categories,
    civil,
    mechanical,
    run: run
      ? {
          id: run.id,
          engine: run.engine as EngineName,
          formulaVersion: run.formulaVersion,
          inputHash: run.inputHash,
          performedAt: run.performedAt,
          performedBy: run.performedBy.fullName,
          parameterSet: runParams ? `${runParams.setCode} v${runParams.setVersion}` : null,
          worksheet: (run.inputSnapshot as unknown as { worksheet?: unknown }).worksheet ?? null,
          output: run.outputSnapshot as unknown,
          current: FORMULA_VERSIONS[run.engine as EngineName] === run.formulaVersion,
        }
      : null,
    siteVisits,
    maxAccuracyMeters,
    verified,
  };
}

// ---------------------------------------------------------------------------
// Site visits
// ---------------------------------------------------------------------------

export async function recordSiteVisit(
  actor: Actor,
  input: SiteVisitInput,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.VALUATION_EDIT);
  const subject = await loadSubject(input.caseId);
  if (!subject) throw new NotFoundError('The requested case was not found.');
  assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_EDIT);

  if (!VISITABLE.has(subject.status as CaseStatus)) {
    throw new BusinessRuleError(
      'CASE_NOT_EDITABLE',
      'A site visit can be recorded while the case is with its valuator.',
    );
  }

  const radiusMeters = await getNumberConfig('site_visit.radius_meters', 200);
  const maxAccuracyMeters = await getNumberConfig('site_visit.max_accuracy_meters', 100);
  const checkIn =
    input.latitude !== null && input.longitude !== null && input.accuracyMeters !== null
      ? {
          latitude: input.latitude,
          longitude: input.longitude,
          accuracyMeters: input.accuracyMeters,
        }
      : null;

  const visit = await withTransaction(async (tx) => {
    // Sequential: a transaction's queries share one connection.
    const civil = await tx.civilProperty.findUnique({
      where: { caseId: input.caseId },
      select: { id: true, latitude: true, longitude: true },
    });
    const mechanical = civil
      ? null
      : await tx.mechanicalProperty.findUnique({
          where: { caseId: input.caseId },
          select: { id: true, latitude: true, longitude: true },
        });
    const property = civil ?? mechanical;
    const located =
      property?.latitude && property.longitude
        ? { latitude: Number(property.latitude), longitude: Number(property.longitude) }
        : null;

    const assessment = assessCheckIn({
      checkIn,
      property: located,
      radiusMeters,
      maxAccuracyMeters,
    });

    // The server's clock, never a date the valuator typed.
    const visit = await tx.siteVisit.create({
      data: {
        caseId: input.caseId,
        visitedById: actor.id,
        visitedAt: new Date(),
        latitude: checkIn?.latitude.toFixed(7) ?? null,
        longitude: checkIn?.longitude.toFixed(7) ?? null,
        accuracyMeters: checkIn?.accuracyMeters.toFixed(2) ?? null,
        distanceMeters: assessment.distanceMeters?.toFixed(2) ?? null,
        radiusMeters,
        maxAccuracyMeters,
        locationCheck: assessment.check,
        accessGained: input.accessGained,
        findings: input.findings,
        remarks: input.remarks,
      },
    });

    // A property with no coordinates takes this check-in's position, so every
    // later visit is judged against where the valuator actually stood. For a
    // civil property the coordinates also choose the location zone that prices
    // the land, so figures calculated without them no longer stand.
    if (assessment.setsPropertyLocation && checkIn && property) {
      const coordinates = {
        latitude: checkIn.latitude.toFixed(7),
        longitude: checkIn.longitude.toFixed(7),
      };
      if (civil) {
        await tx.civilProperty.update({ where: { id: civil.id }, data: coordinates });
        await invalidateValuation(tx, input.caseId);
      } else {
        await tx.mechanicalProperty.update({ where: { id: property.id }, data: coordinates });
      }
    }

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CASE_UPDATED',
      entity: 'SiteVisit',
      entityId: visit.id,
      after: {
        caseId: input.caseId,
        visitedAt: visit.visitedAt.toISOString(),
        accessGained: input.accessGained,
        locationCheck: assessment.check,
        distanceMeters: visit.distanceMeters?.toString() ?? null,
        accuracyMeters: visit.accuracyMeters?.toString() ?? null,
        setPropertyLocation: assessment.setsPropertyLocation,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
    return visit;
  });

  // After the commit, and never throwing: the Maker Manager learns of every
  // visit, and a visit that does not prove presence is raised as a flag.
  await dispatchCaseEvents([eventForSiteVisit(visit.locationCheck)], input.caseId, {
    actorId: actor.id,
    visit: {
      by: actor.fullName,
      check: visit.locationCheck,
      distanceMeters: visit.distanceMeters?.toString() ?? null,
      accessGained: visit.accessGained,
      remarks: visit.remarks,
    },
  });
}

export interface SiteVisitEvidence {
  /** Visits recorded on the case. */
  total: number;
  /** The most recent visit that proves presence at the property, if any. */
  onSite: { visitedAt: Date; visitedBy: string; check: SiteVisitCheck } | null;
  /** The most recent visit, whatever its check. */
  latest: {
    visitedAt: Date;
    visitedBy: string;
    check: SiteVisitCheck;
    distanceMeters: string | null;
  } | null;
}

/** What the case page shows about site visits, for anyone who may read the valuation. */
export async function loadSiteVisitEvidence(
  actor: Actor,
  caseId: string,
): Promise<SiteVisitEvidence | null> {
  const subject = await loadSubject(caseId);
  if (!subject || !canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ)) return null;

  const visits = await prisma.siteVisit.findMany({
    where: { caseId },
    orderBy: { visitedAt: 'desc' },
    select: {
      visitedAt: true,
      locationCheck: true,
      distanceMeters: true,
      visitedBy: { select: { fullName: true } },
    },
  });
  const latest = visits[0];
  const onSite = visits.find((v) => ON_SITE_CHECKS.has(v.locationCheck));
  return {
    total: visits.length,
    onSite: onSite
      ? {
          visitedAt: onSite.visitedAt,
          visitedBy: onSite.visitedBy.fullName,
          check: onSite.locationCheck,
        }
      : null,
    latest: latest
      ? {
          visitedAt: latest.visitedAt,
          visitedBy: latest.visitedBy.fullName,
          check: latest.locationCheck,
          distanceMeters: latest.distanceMeters?.toString() ?? null,
        }
      : null,
  };
}
