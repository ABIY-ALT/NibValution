import { prisma, withTransaction } from '@/server/infrastructure/db/client';
import { record } from '@/server/infrastructure/audit/audit-service';
import { canAccessCase, assertPermission, type Actor } from '@/server/domain/rbac/authorize';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { validateUpload } from '@/server/domain/documents/file-validation';
import { statusForVerdict } from '@/server/domain/ports/scanner';
import { getScanner } from '@/server/infrastructure/scanner';
import { DOCUMENTS_PREFIX, QUARANTINE_PREFIX, getStorage } from '@/server/infrastructure/storage';
import { getArrayConfig, getNumberConfig } from './configuration-service';
import { BusinessRuleError, ForbiddenError, NotFoundError, assertUuid } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { RequestContextInput } from './case-service';

/**
 * Supporting documents (spec section 8).
 *
 * The upload path is: validate → store in quarantine → scan → promote or hold.
 * A file is never written to permanent storage before it has been checked, and
 * a file that could not be scanned stays quarantined rather than being
 * released — see `src/server/infrastructure/scanner`.
 *
 * Clients address documents only by database id. The storage key never leaves
 * this module (rule 6).
 */

const TERMINAL_STATUSES = new Set(['APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED']);

/** Load a case and assert the caller may perform `permission` on it. */
async function caseForDocument(
  actor: Actor,
  caseId: string,
  permission: Parameters<typeof canAccessCase>[2],
) {
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

  // Out of scope and non-existent are indistinguishable, so a case id cannot be
  // probed through the document endpoints.
  if (!record_ || !canAccessCase(actor, record_, permission)) {
    throw new NotFoundError('The requested case was not found.');
  }
  return record_;
}

export interface UploadInput {
  caseId: string;
  categoryCode: string;
  filename: string;
  declaredMime: string;
  bytes: Buffer;
  description?: string | null;
  /** Set when replacing an existing document with a new version. */
  supersedesId?: string | null;
}

export interface UploadResult {
  id: string;
  filename: string;
  scanStatus: string;
  quarantined: boolean;
}

export async function uploadDocument(
  actor: Actor,
  input: UploadInput,
  ctx: RequestContextInput,
): Promise<UploadResult> {
  assertPermission(actor, PERMISSIONS.DOCUMENT_UPLOAD);
  const owningCase = await caseForDocument(actor, input.caseId, PERMISSIONS.DOCUMENT_UPLOAD);

  if (TERMINAL_STATUSES.has(owningCase.status)) {
    throw new BusinessRuleError(
      'CASE_CLOSED',
      'Documents cannot be added to a case that has been approved or closed.',
    );
  }

  const category = await prisma.documentCategory.findUnique({
    where: { code: input.categoryCode },
  });
  if (!category || !category.isActive) {
    throw new BusinessRuleError('UNKNOWN_CATEGORY', 'That document category is not available.');
  }
  if (category.discipline !== null && category.discipline !== owningCase.discipline) {
    throw new BusinessRuleError(
      'CATEGORY_DISCIPLINE_MISMATCH',
      `"${category.name}" does not apply to a ${owningCase.discipline.toLowerCase()} case.`,
    );
  }

  const [maxFileBytes, maxCaseBytes, allowedMimeTypes] = await Promise.all([
    getNumberConfig('upload.max_file_bytes', 26_214_400),
    getNumberConfig('upload.max_case_bytes', 524_288_000),
    getArrayConfig('upload.allowed_mime_types', []),
  ]);

  // 1. Validate before a byte is written anywhere.
  const validated = validateUpload(
    { filename: input.filename, declaredMime: input.declaredMime, bytes: input.bytes },
    { maxFileBytes, allowedMimeTypes },
  );
  const filename = validated.filename;

  // 2. Per-case budget, so one case cannot fill the volume.
  const existing = await prisma.propertyDocument.aggregate({
    where: { caseId: input.caseId, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  const usedBytes = existing._sum.sizeBytes ?? 0;
  if (usedBytes + validated.sizeBytes > maxCaseBytes) {
    throw new BusinessRuleError(
      'CASE_STORAGE_EXCEEDED',
      `This case has reached its ${Math.floor(maxCaseBytes / (1024 * 1024))} MB document allowance.`,
    );
  }

  // 3. Quarantine first. Nothing reaches permanent storage unscanned.
  const storage = getStorage();
  const quarantined = await storage.put(QUARANTINE_PREFIX, input.bytes, validated.mime);

  // 4. Scan.
  const scanner = getScanner();
  let scan;
  try {
    scan = await scanner.scan(input.bytes, validated.filename);
  } catch (error) {
    logger.error({ err: error, scanner: scanner.name }, 'Malware scan failed');
    scan = { verdict: 'UNAVAILABLE' as const, detail: 'The scanner could not be reached.' };
  }

  if (scan.verdict === 'INFECTED') {
    // The bytes are destroyed; only the record of the attempt survives.
    await storage.delete(quarantined.key).catch(() => undefined);
    await record(prisma, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'DOCUMENT_UPLOADED',
      entity: 'PropertyDocument',
      entityId: null,
      after: {
        caseId: input.caseId,
        filename: validated.filename,
        rejected: true,
        reason: 'INFECTED',
        detail: scan.detail,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
    throw new BusinessRuleError(
      'MALWARE_DETECTED',
      `"${validated.filename}" was rejected because it failed the malware scan.`,
    );
  }

  const scanStatus = statusForVerdict(scan.verdict);

  // 5. Promote only a clean file; a quarantined one keeps its quarantine key.
  const storageKey =
    scanStatus === 'CLEAN'
      ? await storage.move(quarantined.key, DOCUMENTS_PREFIX)
      : quarantined.key;

  const created = await withTransaction(async (tx) => {
    if (input.supersedesId) {
      const previous = await tx.propertyDocument.findUnique({
        where: { id: input.supersedesId },
        select: { id: true, caseId: true, version: true, supersededBy: { select: { id: true } } },
      });
      if (!previous || previous.caseId !== input.caseId) {
        throw new NotFoundError('The document being replaced was not found on this case.');
      }
      if (previous.supersededBy) {
        throw new BusinessRuleError(
          'ALREADY_SUPERSEDED',
          'That document has already been replaced by a newer version.',
        );
      }
    }

    const previousVersion = input.supersedesId
      ? ((
          await tx.propertyDocument.findUnique({
            where: { id: input.supersedesId },
            select: { version: true },
          })
        )?.version ?? 0)
      : 0;

    const document = await tx.propertyDocument.create({
      data: {
        caseId: input.caseId,
        categoryId: category.id,
        originalFilename: filename,
        storageKey,
        mimeType: validated.mime,
        sizeBytes: validated.sizeBytes,
        sha256: quarantined.sha256,
        version: previousVersion + 1,
        supersedesId: input.supersedesId ?? null,
        scanStatus,
        scanDetail: scan.detail,
        description: input.description ?? null,
        uploadedById: actor.id,
      },
      select: { id: true, originalFilename: true, scanStatus: true },
    });

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'DOCUMENT_UPLOADED',
      entity: 'PropertyDocument',
      entityId: document.id,
      after: {
        caseId: input.caseId,
        category: category.code,
        filename,
        sizeBytes: validated.sizeBytes,
        mimeType: validated.mime,
        sha256: quarantined.sha256,
        scanStatus,
        // The storage key is deliberately absent: an audit record should prove
        // what happened, not hand out a second copy of the location.
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });

    return document;
  });

  return {
    id: created.id,
    filename: created.originalFilename,
    scanStatus: created.scanStatus,
    quarantined: scanStatus !== 'CLEAN',
  };
}

/** Document metadata for a case. Never includes the storage key. */
export async function listDocuments(actor: Actor, caseId: string) {
  assertPermission(actor, PERMISSIONS.DOCUMENT_READ_METADATA);
  await caseForDocument(actor, caseId, PERMISSIONS.DOCUMENT_READ_METADATA);

  return prisma.propertyDocument.findMany({
    where: { caseId, deletedAt: null },
    orderBy: [{ uploadedAt: 'desc' }],
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      version: true,
      scanStatus: true,
      description: true,
      uploadedAt: true,
      supersedesId: true,
      category: { select: { code: true, name: true, isMandatory: true } },
      uploadedBy: { select: { fullName: true } },
    },
  });
}

export type DocumentRow = Awaited<ReturnType<typeof listDocuments>>[number];

/** Categories that still need a document before the case can be submitted. */
export async function missingMandatoryCategories(
  caseId: string,
  discipline: 'CIVIL' | 'MECHANICAL',
) {
  const [required, present] = await Promise.all([
    prisma.documentCategory.findMany({
      where: { isMandatory: true, isActive: true, OR: [{ discipline: null }, { discipline }] },
      select: { id: true, code: true, name: true },
    }),
    prisma.propertyDocument.findMany({
      where: { caseId, deletedAt: null },
      select: { categoryId: true },
    }),
  ]);

  const have = new Set(present.map((d) => d.categoryId));
  return required.filter((category) => !have.has(category.id));
}

export interface DownloadableDocument {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

/**
 * Fetch a document's bytes for an authorised caller.
 *
 * Every download is authorised and audited. A quarantined or infected file is
 * never served, whatever the caller's permissions.
 */
export async function downloadDocument(
  actor: Actor,
  documentId: string,
  ctx: RequestContextInput,
): Promise<DownloadableDocument> {
  assertPermission(actor, PERMISSIONS.DOCUMENT_DOWNLOAD);
  assertUuid(documentId, 'The requested document was not found.');

  const document = await prisma.propertyDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      caseId: true,
      originalFilename: true,
      mimeType: true,
      storageKey: true,
      scanStatus: true,
      deletedAt: true,
    },
  });

  if (!document || document.deletedAt !== null) {
    throw new NotFoundError('The requested document was not found.');
  }

  await caseForDocument(actor, document.caseId, PERMISSIONS.DOCUMENT_DOWNLOAD);

  if (document.scanStatus !== 'CLEAN') {
    throw new ForbiddenError(
      'This document has not passed the malware scan and cannot be downloaded.',
    );
  }

  const bytes = await getStorage().get(document.storageKey);

  await record(prisma, {
    actorId: actor.id,
    actorRole: actor.roles.join(','),
    action: 'DOCUMENT_DOWNLOADED',
    entity: 'PropertyDocument',
    entityId: document.id,
    after: { caseId: document.caseId, filename: document.originalFilename },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    correlationId: ctx.correlationId,
  });

  return {
    filename: document.originalFilename,
    mimeType: document.mimeType,
    bytes,
  };
}

/**
 * Soft-delete a document.
 *
 * The row and the bytes are both retained (rule 7): a document attached to a
 * case is evidence, so removal is a recorded decision rather than an erasure.
 */
export async function deleteDocument(
  actor: Actor,
  documentId: string,
  reason: string,
  ctx: RequestContextInput,
): Promise<void> {
  assertPermission(actor, PERMISSIONS.DOCUMENT_DELETE);
  assertUuid(documentId, 'The requested document was not found.');

  if (reason.trim().length < 10) {
    throw new BusinessRuleError(
      'REASON_REQUIRED',
      'A reason of at least 10 characters is required to remove a document.',
    );
  }

  const document = await prisma.propertyDocument.findUnique({
    where: { id: documentId },
    select: { id: true, caseId: true, originalFilename: true, uploadedById: true, deletedAt: true },
  });
  if (!document || document.deletedAt !== null) {
    throw new NotFoundError('The requested document was not found.');
  }

  const owningCase = await caseForDocument(actor, document.caseId, PERMISSIONS.DOCUMENT_DELETE);

  if (TERMINAL_STATUSES.has(owningCase.status)) {
    throw new BusinessRuleError(
      'CASE_CLOSED',
      'Documents on an approved or closed case are retained and cannot be removed.',
    );
  }

  await withTransaction(async (tx) => {
    await tx.propertyDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date(), deletedById: actor.id, deletedReason: reason.trim() },
    });

    await record(tx, {
      actorId: actor.id,
      actorRole: actor.roles.join(','),
      action: 'DOCUMENT_DELETED',
      entity: 'PropertyDocument',
      entityId: documentId,
      before: { filename: document.originalFilename, deleted: false },
      after: { deleted: true, reason: reason.trim() },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      correlationId: ctx.correlationId,
    });
  });
}

/** Document categories valid for a case's discipline. */
export async function listDocumentCategories(discipline: 'CIVIL' | 'MECHANICAL') {
  return prisma.documentCategory.findMany({
    where: { isActive: true, OR: [{ discipline: null }, { discipline }] },
    orderBy: [{ isMandatory: 'desc' }, { sortOrder: 'asc' }],
    select: { code: true, name: true, isMandatory: true },
  });
}
