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
  FORMULA_VERSION,
  canonicalJson,
  enteredOutput,
  type EngineName,
  type ValuationEntry,
} from '@/server/domain/valuation/calculation';
import { CASE_STATUS_LABELS, type CaseStatus } from '@/server/domain/shared/enums';
import { BusinessRuleError, NotFoundError } from '@/lib/errors';
import type { ValuationFiguresInput } from '@/lib/validation/valuation';
import type { RequestContextInput } from './case-service';

/**
 * Valuation (spec sections 9-13, 28 and 29; roadmap Phase 3).
 *
 * The assigned valuator enters the case's market and forced-sale values on the
 * case page, and they are persisted in a single transaction:
 *
 *   - the current `Valuation` version, with its market and forced-sale values;
 *   - an append-only `CalculationRun` holding what was entered and the figures
 *     it set, with their hash, which is what the submit guard checks the case
 *     against;
 *   - the case's final value, which drives approval routing;
 *   - an audit record.
 *
 * The system does not calculate the figures: it stores what the valuator
 * enters, as entered.
 */

/** Statuses in which the assigned Maker may enter (or re-enter) the figures. */
const CALCULABLE = new Set<CaseStatus>(['ON_PROGRESS', 'RETURNED_FOR_CORRECTION']);

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

/** The fingerprint of an entry: discipline, formula and what was entered together. */
function inputHash(engine: EngineName, entry: ValuationEntry): string {
  return createHash('sha256')
    .update(canonicalJson({ engine, formulaVersion: FORMULA_VERSION, input: entry }))
    .digest('hex');
}

/**
 * The approach rows a retired calculation engine wrote for this version. An
 * entry has none, so re-entering the figures of a calculated draft removes
 * working that no longer describes them.
 */
async function clearApproachRows(tx: TransactionClient, valuationId: string): Promise<void> {
  await tx.costApproach.deleteMany({ where: { valuationId } });
  await tx.salesApproach.deleteMany({ where: { valuationId } });
  await tx.reconciliation.deleteMany({ where: { valuationId } });
  await tx.forcedSaleValuation.deleteMany({ where: { valuationId } });
  await tx.mechMarketApproach.deleteMany({ where: { valuationId } });
  await tx.mechCostApproach.deleteMany({ where: { valuationId } });
}

// ---------------------------------------------------------------------------
// Entering the figures
// ---------------------------------------------------------------------------

export interface ValuationEntrySummary {
  marketValue: string;
  forcedSaleValue: string;
  version: number;
}

export async function recordValuation(
  actor: Actor,
  input: ValuationFiguresInput,
  ctx: RequestContextInput,
): Promise<ValuationEntrySummary> {
  assertPermission(actor, PERMISSIONS.VALUATION_CALCULATE);

  const subject = await loadSubject(input.caseId);
  if (!subject) throw new NotFoundError('The requested case was not found.');
  assertCaseAccess(actor, subject, PERMISSIONS.VALUATION_CALCULATE);

  const engine = subject.discipline as EngineName;
  const entry: ValuationEntry = {
    valuationDate: input.valuationDate,
    marketValue: input.marketValue,
    forcedSaleValue: input.forcedSaleValue,
    remarks: input.remarks,
  };
  const output = enteredOutput(entry);
  const valuationDate = new Date(`${input.valuationDate}T00:00:00.000Z`);

  return withTransaction(async (tx) => {
    // Serialise against a concurrent submit-for-checking on the same case.
    await tx.$queryRaw`SELECT id FROM valuation_cases WHERE id = ${input.caseId}::uuid FOR UPDATE`;
    const locked = await tx.valuationCase.findUniqueOrThrow({
      where: { id: input.caseId },
      select: { status: true },
    });
    if (!CALCULABLE.has(locked.status as CaseStatus)) {
      throw new BusinessRuleError(
        'CASE_NOT_CALCULABLE',
        `The valuation can be entered while the case is On Progress or Returned for Correction; it is "${
          CASE_STATUS_LABELS[locked.status as CaseStatus] ?? locked.status
        }".`,
      );
    }

    const current = await tx.valuation.findFirst({
      where: { caseId: input.caseId, isCurrent: true },
    });
    if (current?.frozenAt) {
      throw new BusinessRuleError(
        'VALUATION_FROZEN',
        'The current valuation has been approved and is frozen; its figures can no longer be changed.',
      );
    }

    const data = {
      status: 'DRAFT' as const,
      discipline: engine,
      preparedById: actor.id,
      marketValue: output.marketValue,
      forcedSaleValue: output.forcedSaleValue,
      formulaVersion: FORMULA_VERSION,
      // No parameter set prices an entered figure.
      parameterSetId: null,
      valuationDate,
      remarks: input.remarks,
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
        where: { caseId: input.caseId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      valuation = await tx.valuation.create({
        data: {
          caseId: input.caseId,
          version: (latest?.version ?? 0) + 1,
          isCurrent: true,
          ...data,
        },
        select: { id: true, version: true },
      });
    }

    const hash = inputHash(engine, entry);
    await tx.calculationRun.create({
      data: {
        valuationId: valuation.id,
        engine,
        formulaVersion: FORMULA_VERSION,
        parameterSnapshot: {},
        inputSnapshot: toJson({ worksheet: entry }),
        outputSnapshot: toJson(output),
        inputHash: hash,
        performedById: actor.id,
      },
    });

    await tx.valuationCase.update({
      where: { id: input.caseId },
      data: { finalValue: output.marketValue, forcedSaleValue: output.forcedSaleValue },
    });

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'CALCULATION_PERFORMED',
      entity: 'Valuation',
      entityId: valuation.id,
      after: {
        caseId: input.caseId,
        version: valuation.version,
        engine,
        formulaVersion: FORMULA_VERSION,
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
  /**
   * Entered once, then cleared by a later property change - possible only on a
   * case from before property details were dropped. It must be entered again.
   */
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

export interface ValuationCard {
  /** The current figures; null when nothing has been entered. */
  summary: ValuationSummary | null;
  /** Whether this actor - the assigned valuator, in a status that allows it - may enter them now. */
  canEnterFigures: boolean;
  /** The last entry, to start the form from; a calculated run had no figures typed. */
  figures: {
    valuationDate: string | null;
    marketValue: string | null;
    forcedSaleValue: string | null;
    remarks: string | null;
  };
}

const textOf = (value: unknown) => (typeof value === 'string' ? value : null);

/** The case page's valuation card; null for an actor who may not read the valuation. */
export async function loadValuationCard(
  actor: Actor,
  caseId: string,
): Promise<ValuationCard | null> {
  const subject = await loadSubject(caseId);
  if (!subject || !canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ)) return null;

  const [summary, run] = await Promise.all([
    currentValuationSummary(caseId),
    prisma.calculationRun.findFirst({
      where: { valuation: { caseId, isCurrent: true } },
      orderBy: { performedAt: 'desc' },
      select: { inputSnapshot: true },
    }),
  ]);
  const worksheet = (run?.inputSnapshot as { worksheet?: Record<string, unknown> } | undefined)
    ?.worksheet;

  return {
    summary,
    canEnterFigures:
      canAccessCase(actor, subject, PERMISSIONS.VALUATION_CALCULATE) &&
      CALCULABLE.has(subject.status as CaseStatus),
    figures: {
      valuationDate: textOf(worksheet?.valuationDate) ?? summary?.valuationDate ?? null,
      marketValue: textOf(worksheet?.marketValue) ?? summary?.marketValue ?? null,
      forcedSaleValue: textOf(worksheet?.forcedSaleValue) ?? summary?.forcedSaleValue ?? null,
      remarks: textOf(worksheet?.remarks),
    },
  };
}
