import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma, type TransactionClient } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import { getSignatureProvider } from '@/server/infrastructure/signature';
import { canAccessCase, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { canonicalJson } from '@/server/domain/valuation/calculation';
import type { SignatureCheck } from '@/server/domain/ports/signature';
import { BusinessRuleError } from '@/lib/errors';

/**
 * Signing an approved valuation (spec section 19; roadmap Phase 5).
 *
 * What is signed is a frozen document, not a live query: the case particulars,
 * the approved valuation and its calculation fingerprint, and every approval in
 * the round that led to it. The document is stored as an immutable VALUATION
 * report - the database refuses any later change to it - and the signature is
 * taken over the SHA-256 of its canonical form. Re-hashing the stored document
 * and checking the signature against it is therefore a complete verification:
 * if a single figure had changed, the hash would not match.
 *
 * The rendered report (Phase 6) is a presentation of this same document.
 */

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export async function signApprovedValuation(
  tx: TransactionClient,
  input: { caseId: string; signer: Actor; signerRole: string; signedAt: Date },
): Promise<void> {
  const valuation = await tx.valuation.findFirst({
    where: { caseId: input.caseId, isCurrent: true },
    include: {
      parameterSet: { select: { code: true, version: true } },
      calculationRuns: {
        orderBy: { performedAt: 'desc' },
        take: 1,
        select: { id: true, inputHash: true, formulaVersion: true, outputSnapshot: true },
      },
    },
  });
  if (!valuation?.frozenAt || valuation.marketValue === null) {
    throw new BusinessRuleError(
      'NOT_APPROVED',
      'Only an approved valuation can be signed, and this one has not been frozen by approval.',
    );
  }
  const run = valuation.calculationRuns[0];
  if (!run) {
    throw new BusinessRuleError(
      'NO_CALCULATION',
      'The approved valuation has no recorded figures to sign.',
    );
  }

  const theCase = await tx.valuationCase.findUniqueOrThrow({
    where: { id: input.caseId },
    select: {
      caseNumber: true,
      discipline: true,
      ownerName: true,
      applicantName: true,
      currency: true,
      approvalLevel: true,
      requestType: { select: { name: true } },
      requestingOrg: { select: { name: true } },
      department: { select: { name: true } },
      maker: { select: { fullName: true } },
      checker: { select: { fullName: true } },
    },
  });

  // The approvals of the round that produced this valuation - the same set
  // the approval guard counted.
  const lastReturn = await tx.correctionCycle.findFirst({
    where: { caseId: input.caseId },
    orderBy: { returnedAt: 'desc' },
    select: { returnedAt: true },
  });
  const approvals = await tx.approval.findMany({
    where: {
      caseId: input.caseId,
      decision: 'APPROVED',
      ...(lastReturn ? { decidedAt: { gt: lastReturn.returnedAt } } : {}),
    },
    orderBy: { decidedAt: 'asc' },
    include: { approver: { select: { fullName: true } } },
  });

  // The site inspection: every visit with its check-in verdict, and the photos
  // taken on it. Each photo is named by its fingerprint, so the signature
  // covers the exact images the report shows.
  const visits = await tx.siteVisit.findMany({
    where: { caseId: input.caseId },
    orderBy: { visitedAt: 'asc' },
    select: {
      visitedAt: true,
      accessGained: true,
      findings: true,
      latitude: true,
      longitude: true,
      accuracyMeters: true,
      distanceMeters: true,
      locationCheck: true,
      visitedBy: { select: { fullName: true } },
      photos: {
        where: { deletedAt: null, scanStatus: 'CLEAN' },
        orderBy: { uploadedAt: 'asc' },
        select: {
          id: true,
          sha256: true,
          uploadedAt: true,
          latitude: true,
          longitude: true,
          accuracyMeters: true,
          distanceMeters: true,
          locationCheck: true,
        },
      },
    },
  });
  const text = (value: { toString(): string } | null) => (value === null ? null : value.toString());

  const document = {
    documentType: 'VALUATION',
    schemaVersion: 1,
    case: {
      id: input.caseId,
      caseNumber: theCase.caseNumber,
      requestType: theCase.requestType.name,
      discipline: theCase.discipline,
      requestingUnit: theCase.requestingOrg.name,
      department: theCase.department.name,
      owner: theCase.ownerName,
      applicant: theCase.applicantName,
      valuator: theCase.maker?.fullName ?? null,
      checker: theCase.checker?.fullName ?? null,
    },
    valuation: {
      id: valuation.id,
      version: valuation.version,
      marketValue: valuation.marketValue.toFixed(2),
      forcedSaleValue: valuation.forcedSaleValue?.toFixed(2) ?? null,
      currency: theCase.currency,
      valuationDate: valuation.valuationDate?.toISOString().slice(0, 10) ?? null,
      formulaVersion: valuation.formulaVersion,
      parameterSet: valuation.parameterSet
        ? `${valuation.parameterSet.code} v${valuation.parameterSet.version}`
        : null,
      approvedAt: valuation.frozenAt.toISOString(),
      approvalLevel: theCase.approvalLevel,
      remarks: valuation.remarks,
    },
    calculation: {
      runId: run.id,
      formulaVersion: run.formulaVersion,
      inputHash: run.inputHash,
      outputSha256: sha256(canonicalJson(run.outputSnapshot)),
      output: run.outputSnapshot,
    },
    approvals: approvals.map((a) => ({
      level: a.level,
      approver: a.approver.fullName,
      decision: a.decision,
      valueAtDecision: a.valueAtDecision.toFixed(2),
      decidedAt: a.decidedAt.toISOString(),
      comment: a.comment,
    })),
    siteInspection: visits.map((v) => ({
      visitedAt: v.visitedAt.toISOString(),
      visitedBy: v.visitedBy.fullName,
      accessGained: v.accessGained,
      findings: v.findings,
      check: v.locationCheck,
      latitude: text(v.latitude),
      longitude: text(v.longitude),
      accuracyMeters: text(v.accuracyMeters),
      distanceMeters: text(v.distanceMeters),
      photos: v.photos.map((p) => ({
        id: p.id,
        sha256: p.sha256,
        takenAt: p.uploadedAt.toISOString(),
        check: p.locationCheck,
        latitude: text(p.latitude),
        longitude: text(p.longitude),
        accuracyMeters: text(p.accuracyMeters),
        distanceMeters: text(p.distanceMeters),
      })),
    })),
    signer: { id: input.signer.id, name: input.signer.fullName, role: input.signerRole },
    signedAt: input.signedAt.toISOString(),
  };

  const canonical = canonicalJson(document);
  const documentSha256 = sha256(canonical);

  const previous = await tx.report.findFirst({
    where: { caseId: input.caseId, type: 'VALUATION' },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const report = await tx.report.create({
    data: {
      caseId: input.caseId,
      valuationId: valuation.id,
      type: 'VALUATION',
      version: (previous?.version ?? 0) + 1,
      dataSnapshot: JSON.parse(canonical) as Prisma.InputJsonValue,
      sha256: documentSha256,
      isImmutable: true,
      generatedById: input.signer.id,
    },
  });

  const provider = getSignatureProvider();
  const signed = await provider.sign(documentSha256);
  const signature = await tx.digitalSignature.create({
    data: {
      caseId: input.caseId,
      reportId: report.id,
      signerId: input.signer.id,
      signerRole: input.signerRole,
      documentSha256,
      signature: signed.signature,
      provider: provider.name,
      certificateRef: signed.keyFingerprint,
      signedAt: input.signedAt,
    },
  });

  await record(tx, {
    actorId: input.signer.id,
    actorRole: input.signerRole,
    action: 'SIGNATURE_APPLIED',
    entity: 'DigitalSignature',
    entityId: signature.id,
    after: {
      caseId: input.caseId,
      reportId: report.id,
      reportVersion: report.version,
      documentSha256,
      provider: provider.name,
      keyFingerprint: signed.keyFingerprint,
    },
  });
}

// ---------------------------------------------------------------------------
// Reading and verification
// ---------------------------------------------------------------------------

export interface ApprovalEntry {
  id: string;
  level: string;
  approver: string;
  decision: string;
  comment: string | null;
  valueAtDecision: string;
  decidedAt: Date;
}

export interface SignatureEntry {
  signer: string;
  signerRole: string;
  signedAt: Date;
  reportVersion: number | null;
  documentSha256: string;
  keyFingerprint: string | null;
  provider: string;
  /** Re-hash of the stored document, then the signature checked against it. */
  check: SignatureCheck | 'DOCUMENT_CHANGED' | 'REVOKED';
}

/** The approval decisions and signature on a case, for anyone who may read its valuation. */
export async function loadApprovalRecord(
  actor: Actor,
  caseId: string,
): Promise<{ approvals: ApprovalEntry[]; signature: SignatureEntry | null } | null> {
  const subject = await prisma.valuationCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      requestingOrgId: true,
      departmentId: true,
      requestedById: true,
      makerId: true,
      checkerId: true,
    },
  });
  if (!subject || !canAccessCase(actor, subject, PERMISSIONS.VALUATION_READ)) return null;

  const [approvals, latest] = await Promise.all([
    prisma.approval.findMany({
      where: { caseId },
      orderBy: { decidedAt: 'asc' },
      include: { approver: { select: { fullName: true } } },
    }),
    prisma.digitalSignature.findFirst({
      where: { caseId },
      orderBy: { signedAt: 'desc' },
      include: {
        signer: { select: { fullName: true } },
        report: { select: { version: true, dataSnapshot: true, sha256: true } },
      },
    }),
  ]);

  let signature: SignatureEntry | null = null;
  if (latest) {
    let check: SignatureEntry['check'];
    if (latest.status === 'REVOKED') {
      check = 'REVOKED';
    } else if (
      !latest.report ||
      sha256(canonicalJson(latest.report.dataSnapshot)) !== latest.documentSha256
    ) {
      check = 'DOCUMENT_CHANGED';
    } else {
      check = await getSignatureProvider()
        .verify(latest.documentSha256, latest.signature, latest.certificateRef ?? '')
        .catch(() => 'UNKNOWN_KEY' as const);
    }
    signature = {
      signer: latest.signer.fullName,
      signerRole: latest.signerRole,
      signedAt: latest.signedAt,
      reportVersion: latest.report?.version ?? null,
      documentSha256: latest.documentSha256,
      keyFingerprint: latest.certificateRef,
      provider: latest.provider,
      check,
    };
  }

  return {
    approvals: approvals.map((a) => ({
      id: a.id,
      level: a.level,
      approver: a.approver.fullName,
      decision: a.decision,
      comment: a.comment,
      valueAtDecision: a.valueAtDecision.toFixed(2),
      decidedAt: a.decidedAt,
    })),
    signature,
  };
}
