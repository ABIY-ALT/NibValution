import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type TransactionClient } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import {
  canAccessCase,
  satisfiesScope,
  type Actor,
  type CaseAccessSubject,
} from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { resolveFinalLetterAuthority } from '@/server/domain/approval/routing';
import { canonicalJson } from '@/server/domain/valuation/calculation';
import type { CaseStatus, RoleCode } from '@/server/domain/shared/enums';
import { BusinessRuleError, NotFoundError, assertUuid } from '@/lib/errors';
import { amountInWords, dec } from '@/lib/money';
import { issuerTitle, resolveLetterFormat } from '@/server/domain/documents/letter-format';
import { loadFinalLetterRules } from './configuration-service';

/**
 * Case documents (spec sections 15, 18 and 29; roadmap Phase 6).
 *
 * Each document is a frozen data snapshot stored as an immutable, versioned
 * `Report`: the cover page when the Maker submits for approval, the valuation
 * report when it is signed (signature-service), and the final letter when the
 * resolved authority issues it. A document is rendered from its snapshot and
 * nothing else, so re-opening a two-year-old letter shows exactly what was
 * issued - not today's case data (the Phase 6 exit criterion).
 */

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

type ReportType = 'VALUATION' | 'COVER_PAGE' | 'FINAL_LETTER';

async function storeDocument(
  tx: TransactionClient,
  input: {
    caseId: string;
    valuationId: string | null;
    type: ReportType;
    document: Record<string, unknown>;
    generatedById: string;
    actorRole: string;
  },
) {
  const canonical = canonicalJson(input.document);
  const previous = await tx.report.findFirst({
    where: { caseId: input.caseId, type: input.type },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const report = await tx.report.create({
    data: {
      caseId: input.caseId,
      valuationId: input.valuationId,
      type: input.type,
      version: (previous?.version ?? 0) + 1,
      dataSnapshot: JSON.parse(canonical) as Prisma.InputJsonValue,
      sha256: sha256(canonical),
      isImmutable: true,
      generatedById: input.generatedById,
    },
  });
  await record(tx, {
    actorId: input.generatedById,
    actorRole: input.actorRole,
    action: 'REPORT_GENERATED',
    entity: 'Report',
    entityId: report.id,
    after: {
      caseId: input.caseId,
      type: input.type,
      version: report.version,
      sha256: report.sha256,
    },
  });
  return report;
}

async function caseParticulars(tx: TransactionClient, caseId: string) {
  return tx.valuationCase.findUniqueOrThrow({
    where: { id: caseId },
    select: {
      caseNumber: true,
      discipline: true,
      ownerName: true,
      applicantName: true,
      purpose: true,
      currency: true,
      requestedAt: true,
      createdAt: true,
      checkedAt: true,
      finalValue: true,
      forcedSaleValue: true,
      requestType: { select: { code: true, name: true } },
      requestingOrg: { select: { name: true } },
      department: { select: { name: true } },
      maker: { select: { fullName: true } },
      checker: { select: { fullName: true } },
      civilProperty: {
        select: {
          lhcNumber: true,
          subCity: true,
          woreda: true,
          kebele: true,
          houseNumber: true,
          geographicLocation: true,
          landHoldingRight: true,
          plotArea: true,
          category: { select: { name: true } },
          buildings: { select: { grossArea: true, constructionStatus: true } },
        },
      },
      mechanicalProperty: {
        select: {
          plantName: true,
          installationAddress: true,
          _count: { select: { vehicles: true, machinery: true } },
        },
      },
    },
  });
}

function propertySummary(c: Awaited<ReturnType<typeof caseParticulars>>) {
  if (c.civilProperty) {
    const p = c.civilProperty;
    const buildingArea = p.buildings.reduce(
      (sum, b) => (b.grossArea ? sum.plus(b.grossArea.toString()) : sum),
      dec(0),
    );
    return {
      kind: 'CIVIL',
      category: p.category.name,
      location: [
        p.subCity,
        p.woreda ? `Woreda ${p.woreda}` : null,
        p.kebele ? `Kebele ${p.kebele}` : null,
        p.houseNumber ? `House ${p.houseNumber}` : null,
      ]
        .filter(Boolean)
        .join(', '),
      lhcNumber: p.lhcNumber,
      landHoldingRight: p.landHoldingRight,
      plotArea: p.plotArea?.toString() ?? null,
      buildingCount: p.buildings.length,
      buildingArea: buildingArea.isZero() ? null : buildingArea.toFixed(2),
    };
  }
  if (c.mechanicalProperty) {
    const p = c.mechanicalProperty;
    return {
      kind: 'MECHANICAL',
      plantName: p.plantName,
      location: p.installationAddress,
      vehicleCount: p._count.vehicles,
      machineryCount: p._count.machinery,
    };
  }
  return { kind: c.discipline };
}

async function currentValuation(tx: TransactionClient, caseId: string) {
  const valuation = await tx.valuation.findFirst({
    where: { caseId, isCurrent: true },
    include: { parameterSet: { select: { code: true, version: true } } },
  });
  if (!valuation || valuation.marketValue === null) {
    throw new BusinessRuleError('NO_VALUATION', 'The case has no calculated valuation.');
  }
  return valuation;
}

// ---------------------------------------------------------------------------
// Cover page (section 15) - on submission for approval
// ---------------------------------------------------------------------------

export async function generateCoverPage(
  tx: TransactionClient,
  input: {
    caseId: string;
    actor: Actor;
    actorRole: string;
    approvalChain: readonly RoleCode[];
    generatedAt: Date;
  },
): Promise<void> {
  // Sequential: a transaction's queries share one connection.
  const c = await caseParticulars(tx, input.caseId);
  const valuation = await currentValuation(tx, input.caseId);

  await storeDocument(tx, {
    caseId: input.caseId,
    valuationId: valuation.id,
    type: 'COVER_PAGE',
    generatedById: input.actor.id,
    actorRole: input.actorRole,
    document: {
      documentType: 'COVER_PAGE',
      schemaVersion: 1,
      case: {
        caseNumber: c.caseNumber,
        requestType: c.requestType.name,
        discipline: c.discipline,
        requestingUnit: c.requestingOrg.name,
        department: c.department.name,
        owner: c.ownerName,
        applicant: c.applicantName,
        purpose: c.purpose,
        requestedAt: (c.requestedAt ?? c.createdAt).toISOString(),
      },
      property: propertySummary(c),
      valuation: {
        version: valuation.version,
        marketValue: valuation.marketValue!.toFixed(2),
        forcedSaleValue: valuation.forcedSaleValue?.toFixed(2) ?? null,
        currency: c.currency,
        valuationDate: valuation.valuationDate?.toISOString().slice(0, 10) ?? null,
        parameterSet: valuation.parameterSet
          ? `${valuation.parameterSet.code} v${valuation.parameterSet.version}`
          : null,
        formulaVersion: valuation.formulaVersion,
      },
      preparedBy: c.maker?.fullName ?? null,
      checkedBy: c.checker?.fullName ?? null,
      checkedAt: c.checkedAt?.toISOString() ?? null,
      approvalRoute: input.approvalChain.filter((role) => role !== 'CHECKER'),
      generatedBy: input.actor.fullName,
      generatedAt: input.generatedAt.toISOString(),
    },
  });
}

// ---------------------------------------------------------------------------
// Final letter (section 18) - by the authority the amount resolves to
// ---------------------------------------------------------------------------

export async function issueFinalLetter(
  tx: TransactionClient,
  input: { caseId: string; actor: Actor; actorRole: string; issuedAt: Date },
): Promise<void> {
  // Sequential: a transaction's queries share one connection.
  const c = await caseParticulars(tx, input.caseId);
  const valuation = await currentValuation(tx, input.caseId);

  // The rules in force on the request date, like every other threshold: a
  // later change to the ladder must not re-route a letter already in train.
  const rules = await loadFinalLetterRules();
  const authority = resolveFinalLetterAuthority(
    rules,
    valuation.marketValue!.toString(),
    c.requestedAt ?? c.createdAt,
  );
  const isAdministrator = input.actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER);
  if (!input.actor.roles.includes(authority.issuerRole) && !isAdministrator) {
    throw new BusinessRuleError(
      'LETTER_AUTHORITY',
      `The final letter for this value is issued by the ${authority.issuerRole
        .toLowerCase()
        .replace('_', ' ')} (${authority.name}).`,
    );
  }

  const existing = await tx.report.findFirst({
    where: { caseId: input.caseId, type: 'FINAL_LETTER', valuationId: valuation.id },
    select: { id: true },
  });
  if (existing) {
    throw new BusinessRuleError(
      'LETTER_ALREADY_ISSUED',
      'The final letter for this valuation has already been issued.',
    );
  }

  const signed = await tx.report.findFirst({
    where: { caseId: input.caseId, type: 'VALUATION', isImmutable: true },
    orderBy: { version: 'desc' },
    select: { version: true, sha256: true },
  });

  const version =
    ((
      await tx.report.findFirst({
        where: { caseId: input.caseId, type: 'FINAL_LETTER' },
        orderBy: { version: 'desc' },
        select: { version: true },
      })
    )?.version ?? 0) + 1;

  // Schema 2 is the Division's covering-letter format. Everything the letter
  // states - including the figure and its wording - is frozen here, so a later
  // change to the wording rules cannot alter a letter already issued.
  const format = resolveLetterFormat({
    requestTypeCode: c.requestType.code,
    constructionStatuses: c.civilProperty?.buildings.map((b) => b.constructionStatus) ?? [],
  });
  const stated =
    format === 'COMPLETED'
      ? valuation.marketValue!
      : format === 'LOAN_RECOVERY'
        ? valuation.forcedSaleValue
        : null;
  if (format === 'LOAN_RECOVERY' && !stated) {
    throw new BusinessRuleError(
      'NO_FORCED_SALE_VALUE',
      'A loan-recovery letter states the foreclosure value, and this valuation has none.',
    );
  }
  const property = propertySummary(c);

  await storeDocument(tx, {
    caseId: input.caseId,
    valuationId: valuation.id,
    type: 'FINAL_LETTER',
    generatedById: input.actor.id,
    actorRole: input.actorRole,
    document: {
      documentType: 'FINAL_LETTER',
      schemaVersion: 2,
      reference: `${c.caseNumber}/FL-${version}`,
      date: input.issuedAt.toISOString().slice(0, 10),
      addressee: c.requestingOrg.name,
      case: {
        caseNumber: c.caseNumber,
        requestType: c.requestType.name,
        discipline: c.discipline,
        owner: c.ownerName,
        applicant: c.applicantName,
        purpose: c.purpose,
      },
      property,
      valuation: {
        marketValue: valuation.marketValue!.toFixed(2),
        forcedSaleValue: valuation.forcedSaleValue?.toFixed(2) ?? null,
        currency: c.currency,
        valuationDate: valuation.valuationDate?.toISOString().slice(0, 10) ?? null,
      },
      letter: {
        format,
        requestedOn: (c.requestedAt ?? c.createdAt).toISOString().slice(0, 10),
        location:
          ('location' in property && property.location) ||
          c.civilProperty?.geographicLocation ||
          null,
        identifier: c.civilProperty?.lhcNumber ?? null,
        statedValue: stated
          ? { amount: stated.toFixed(2), ...amountInWords(stated.toString()) }
          : null,
      },
      signedReport: signed ? { version: signed.version, sha256: signed.sha256 } : null,
      issuer: {
        name: input.actor.fullName,
        role: input.actorRole,
        title: issuerTitle(input.actorRole, c.department.name),
      },
      authority: authority.name,
      department: c.department.name,
    },
  });
}

/** Delivery hands the requester the final letter, so it must exist first. */
export async function assertReadyToDeliver(tx: TransactionClient, caseId: string): Promise<void> {
  const letter = await tx.report.findFirst({
    where: { caseId, type: 'FINAL_LETTER' },
    select: { id: true },
  });
  if (!letter) {
    throw new BusinessRuleError(
      'FINAL_LETTER_REQUIRED',
      'Issue the final letter before delivering the case to the requester.',
    );
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const SUBJECT_SELECT = {
  id: true,
  status: true,
  requestingOrgId: true,
  departmentId: true,
  requestedById: true,
  makerId: true,
  checkerId: true,
} as const;

/** Statuses after which the requester may open the final documents. */
const DELIVERED = new Set<CaseStatus>(['COMPLETED', 'ARCHIVED']);

/**
 * Who may open which document. The department side - the case's valuator and
 * checker, its department, oversight readers - sees every document as soon as
 * it exists. The requesting side sees only the valuation report and the final
 * letter, and only once the case has been delivered: until then they are the
 * department's working papers.
 */
function visibleTypes(
  actor: Actor,
  subject: CaseAccessSubject & { status: string },
): Set<ReportType> {
  if (!canAccessCase(actor, subject, PERMISSIONS.CASE_READ)) return new Set();
  const departmentSide =
    satisfiesScope(actor, subject, 'DEPT') ||
    subject.makerId === actor.id ||
    subject.checkerId === actor.id ||
    actor.permissions.has(PERMISSIONS.CASE_READ_ALL) ||
    actor.permissions.has(PERMISSIONS.SYSTEM_ADMINISTER);
  if (departmentSide) return new Set(['VALUATION', 'COVER_PAGE', 'FINAL_LETTER']);
  if (
    DELIVERED.has(subject.status as CaseStatus) &&
    canAccessCase(actor, subject, PERMISSIONS.REPORT_DOWNLOAD_FINAL)
  ) {
    return new Set(['VALUATION', 'FINAL_LETTER']);
  }
  return new Set();
}

export interface CaseDocumentEntry {
  id: string;
  type: ReportType;
  version: number;
  generatedAt: Date;
  generatedBy: string;
  sha256: string | null;
  signed: boolean;
}

export async function listCaseDocuments(
  actor: Actor,
  caseId: string,
): Promise<CaseDocumentEntry[]> {
  const subject = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: SUBJECT_SELECT,
  });
  if (!subject) return [];
  const types = visibleTypes(actor, subject);
  if (types.size === 0) return [];

  const rows = await prisma.report.findMany({
    where: { caseId, type: { in: [...types] } },
    orderBy: [{ generatedAt: 'desc' }],
    include: {
      generatedBy: { select: { fullName: true } },
      _count: { select: { signatures: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as ReportType,
    version: r.version,
    generatedAt: r.generatedAt,
    generatedBy: r.generatedBy.fullName,
    sha256: r.sha256,
    signed: r._count.signatures > 0,
  }));
}

/** One document for the viewer, with its integrity re-checked on every open. */
export async function loadCaseDocument(actor: Actor, caseId: string, reportId: string) {
  assertUuid(caseId, 'The requested document was not found.');
  assertUuid(reportId, 'The requested document was not found.');
  const subject = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: { ...SUBJECT_SELECT, caseNumber: true },
  });
  if (!subject) throw new NotFoundError('The requested document was not found.');

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { generatedBy: { select: { fullName: true } } },
  });
  if (
    !report ||
    report.caseId !== caseId ||
    !visibleTypes(actor, subject).has(report.type as ReportType)
  ) {
    // One answer for "missing", "another case's" and "not yours to see".
    throw new NotFoundError('The requested document was not found.');
  }

  return {
    id: report.id,
    caseNumber: subject.caseNumber,
    type: report.type as ReportType,
    version: report.version,
    generatedAt: report.generatedAt,
    generatedBy: report.generatedBy.fullName,
    sha256: report.sha256,
    intact: report.sha256 === sha256(canonicalJson(report.dataSnapshot)),
    document: report.dataSnapshot as Record<string, unknown>,
  };
}
