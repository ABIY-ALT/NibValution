import { BusinessRuleError, PayloadTooLargeError } from '@/lib/errors';

/**
 * Upload validation (spec sections 8 and 26).
 *
 * Pure, so every rule can be tested without a request or a filesystem.
 *
 * The central decision here is that the *declared* content type is treated as a
 * hint and nothing more. A browser will happily send `application/pdf` for an
 * executable, so the real check is the file's own leading bytes. A file whose
 * magic number disagrees with its extension is rejected outright rather than
 * stored under whichever label happened to be believed.
 */

export interface AllowedType {
  readonly mime: string;
  readonly extensions: readonly string[];
  /** Leading-byte signatures, any of which identifies this type. */
  readonly magic: readonly (readonly number[])[];
  readonly label: string;
}

export const ALLOWED_TYPES: readonly AllowedType[] = [
  {
    mime: 'application/pdf',
    extensions: ['pdf'],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    label: 'PDF document',
  },
  {
    mime: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    magic: [[0xff, 0xd8, 0xff]],
    label: 'JPEG image',
  },
  {
    mime: 'image/png',
    extensions: ['png'],
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    label: 'PNG image',
  },
  {
    mime: 'image/tiff',
    extensions: ['tif', 'tiff'],
    magic: [
      [0x49, 0x49, 0x2a, 0x00], // little-endian
      [0x4d, 0x4d, 0x00, 0x2a], // big-endian
    ],
    label: 'TIFF image',
  },
  {
    // DOCX and XLSX are ZIP containers; the signature is the ZIP local header.
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
    label: 'Word document',
  },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'],
    magic: [[0x50, 0x4b, 0x03, 0x04]],
    label: 'Excel workbook',
  },
];

/**
 * Extensions refused regardless of anything else.
 *
 * An allow-list already governs what is accepted, so this is a second line
 * whose value is largely the error message: a user attaching a macro-enabled
 * workbook learns why, rather than seeing a generic "unsupported type".
 */
const ALWAYS_REJECTED = new Set([
  'exe',
  'dll',
  'com',
  'bat',
  'cmd',
  'sh',
  'ps1',
  'psm1',
  'vbs',
  'js',
  'jse',
  'msi',
  'scr',
  'jar',
  'app',
  'apk',
  'lnk',
  'reg',
  'hta',
  'cpl',
  'docm',
  'xlsm',
  'pptm',
  'dotm',
  'xltm',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'iso',
]);

export interface UploadCandidate {
  readonly filename: string;
  readonly declaredMime: string;
  readonly bytes: Buffer;
}

export interface ValidatedUpload {
  readonly filename: string;
  /** The type proven by the file's own bytes, not the one it claimed. */
  readonly mime: string;
  readonly extension: string;
  readonly sizeBytes: number;
}

export function extensionOf(filename: string): string {
  const clean = filename.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot === -1 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1);
}

const PATH_PREFIX = /^.*[/\\]/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const QUOTES_AND_SLASHES = /["\\]/g;
const DOT_RUNS = /\.{2,}/g;
const LEADING_DOTS = /^\.+/;

/**
 * Strip everything that could give a filename meaning to a filesystem.
 *
 * The result is only ever a *display* label — the stored key is random — but a
 * name that reaches a Content-Disposition header must still not be able to
 * carry a path, a quote or a control character.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(PATH_PREFIX, '');

  const cleaned = base
    .replace(CONTROL_CHARS, '')
    .replace(QUOTES_AND_SLASHES, '')
    .replace(DOT_RUNS, '.')
    .replace(LEADING_DOTS, '')
    .trim();

  const safe = cleaned.length > 0 ? cleaned : 'document';
  if (safe.length <= 180) return safe;

  // Truncate the stem but keep the extension, so the name stays meaningful.
  const ext = extensionOf(safe);
  const stem = ext ? safe.slice(0, safe.length - ext.length - 1) : safe;
  return ext ? `${stem.slice(0, 170)}.${ext}` : stem.slice(0, 170);
}

function matchesMagic(bytes: Buffer, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The types a file's own leading bytes identify it as. */
export function sniffType(bytes: Buffer): AllowedType[] {
  return ALLOWED_TYPES.filter((type) => type.magic.some((sig) => matchesMagic(bytes, sig)));
}

export interface ValidationLimits {
  readonly maxFileBytes: number;
  /** Mime types an administrator has enabled; empty means "the built-in list". */
  readonly allowedMimeTypes: readonly string[];
}

/** Validate a candidate upload, or throw explaining precisely what is wrong. */
export function validateUpload(
  candidate: UploadCandidate,
  limits: ValidationLimits,
): ValidatedUpload {
  const filename = sanitizeFilename(candidate.filename);
  const extension = extensionOf(filename);

  if (candidate.bytes.length === 0) {
    throw new BusinessRuleError('EMPTY_FILE', `"${filename}" is empty.`);
  }

  if (candidate.bytes.length > limits.maxFileBytes) {
    const limitMb = Math.floor(limits.maxFileBytes / (1024 * 1024));
    throw new PayloadTooLargeError(
      `"${filename}" is larger than the ${limitMb} MB limit for a single document.`,
    );
  }

  if (extension === '') {
    throw new BusinessRuleError(
      'NO_EXTENSION',
      `"${filename}" has no file extension, so its type cannot be established.`,
    );
  }

  if (ALWAYS_REJECTED.has(extension)) {
    throw new BusinessRuleError(
      'FORBIDDEN_TYPE',
      `Files of type ".${extension}" are never accepted, because they can carry executable content.`,
    );
  }

  const byExtension = ALLOWED_TYPES.filter((type) => type.extensions.includes(extension));
  if (byExtension.length === 0) {
    throw new BusinessRuleError(
      'UNSUPPORTED_TYPE',
      `".${extension}" is not an accepted document type. Accepted types are: ` +
        `${[...new Set(ALLOWED_TYPES.flatMap((t) => t.extensions))].join(', ')}.`,
    );
  }

  // The decisive check: what the bytes actually are.
  const sniffed = sniffType(candidate.bytes);
  if (sniffed.length === 0) {
    throw new BusinessRuleError(
      'CONTENT_MISMATCH',
      `"${filename}" does not contain valid ${byExtension[0]!.label} data. ` +
        'Renaming a file does not change its type.',
    );
  }

  const agreed = sniffed.find((type) => type.extensions.includes(extension));
  if (!agreed) {
    throw new BusinessRuleError(
      'CONTENT_MISMATCH',
      `"${filename}" is named as ${byExtension[0]!.label} but its content is ` +
        `${sniffed[0]!.label}. The file is rejected rather than stored under the wrong type.`,
    );
  }

  // An administrator can narrow the built-in list, never widen it.
  if (limits.allowedMimeTypes.length > 0 && !limits.allowedMimeTypes.includes(agreed.mime)) {
    throw new BusinessRuleError(
      'UNSUPPORTED_TYPE',
      `${agreed.label} files are not currently accepted.`,
    );
  }

  return {
    filename,
    mime: agreed.mime,
    extension,
    sizeBytes: candidate.bytes.length,
  };
}
