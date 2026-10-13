import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  sanitizeFilename,
  sniffType,
  validateUpload,
} from '@/server/domain/documents/file-validation';
import { statusForVerdict } from '@/server/domain/ports/scanner';
import { BusinessRuleError, ConfigurationError, PayloadTooLargeError } from '@/lib/errors';
import {
  LocalStorageProvider,
  defaultStorageRoot,
} from '@/server/infrastructure/storage/local-storage';

/**
 * Upload validation is the highest-risk surface in the application: it accepts
 * arbitrary bytes from a branch user and stores them where other staff will
 * later open them. These tests pin the rules that stop a renamed executable,
 * a path-traversal filename, or an unscanned file from getting through.
 */

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const MZ_EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]); // Windows PE
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

const LIMITS = { maxFileBytes: 25 * 1024 * 1024, allowedMimeTypes: [] as string[] };

function candidate(filename: string, bytes: Buffer, declaredMime = 'application/pdf') {
  return { filename, declaredMime, bytes };
}

describe('accepted uploads', () => {
  it('accepts a genuine PDF', () => {
    const result = validateUpload(candidate('lhc-certificate.pdf', PDF), LIMITS);
    expect(result.mime).toBe('application/pdf');
    expect(result.filename).toBe('lhc-certificate.pdf');
  });

  it('accepts site photographs', () => {
    expect(validateUpload(candidate('front.jpg', JPEG, 'image/jpeg'), LIMITS).mime).toBe('image/jpeg');
    expect(validateUpload(candidate('plan.png', PNG, 'image/png'), LIMITS).mime).toBe('image/png');
  });

  it('accepts an Office document by its ZIP container signature', () => {
    const result = validateUpload(candidate('schedule.xlsx', ZIP), LIMITS);
    expect(result.mime).toContain('spreadsheetml');
  });
});

describe('rejecting executables disguised as documents', () => {
  it('rejects a Windows executable renamed to .pdf', () => {
    // The whole point of sniffing: the extension and the declared MIME both
    // say PDF, and the bytes say otherwise.
    expect(() => validateUpload(candidate('invoice.pdf', MZ_EXE), LIMITS)).toThrow(
      /does not contain valid PDF/i,
    );
  });

  it('rejects an ELF binary renamed to .jpg', () => {
    expect(() => validateUpload(candidate('photo.jpg', ELF, 'image/jpeg'), LIMITS)).toThrow(
      BusinessRuleError,
    );
  });

  it('rejects HTML renamed to .pdf, which would otherwise be a stored-XSS vector', () => {
    expect(() => validateUpload(candidate('report.pdf', HTML), LIMITS)).toThrow(
      /does not contain valid/i,
    );
  });

  it('rejects a real PNG carrying a .pdf extension', () => {
    // Both are permitted types, but storing one under the other's label would
    // make the served Content-Type wrong.
    expect(() => validateUpload(candidate('scan.pdf', PNG), LIMITS)).toThrow(/content is PNG image/i);
  });

  it.each(['exe', 'dll', 'bat', 'cmd', 'sh', 'ps1', 'vbs', 'js', 'msi', 'scr', 'jar', 'hta'])(
    'refuses .%s outright',
    (ext) => {
      expect(() => validateUpload(candidate(`payload.${ext}`, PDF), LIMITS)).toThrow(
        /never accepted/i,
      );
    },
  );

  it.each(['docm', 'xlsm', 'pptm'])('refuses macro-enabled .%s', (ext) => {
    expect(() => validateUpload(candidate(`book.${ext}`, ZIP), LIMITS)).toThrow(/never accepted/i);
  });

  it.each(['zip', 'rar', '7z', 'tar', 'gz', 'iso'])('refuses the archive format .%s', (ext) => {
    // An archive hides its contents from the scanner.
    expect(() => validateUpload(candidate(`bundle.${ext}`, ZIP), LIMITS)).toThrow(/never accepted/i);
  });
});

describe('filename handling', () => {
  it('strips a traversal path from the display name', () => {
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\windows\\system32\\cmd')).toBe('cmd');
    expect(sanitizeFilename('/absolute/path/deed.pdf')).toBe('deed.pdf');
  });

  it('removes characters that would break a Content-Disposition header', () => {
    const nasty = 'in"voice\r\n.pdf';
    const clean = sanitizeFilename(nasty);
    expect(clean).not.toContain('"');
    expect(clean).not.toContain('\r');
    expect(clean).not.toContain('\n');
  });

  it('collapses dot runs so a name cannot smuggle a traversal segment', () => {
    expect(sanitizeFilename('report..pdf')).toBe('report.pdf');
    expect(sanitizeFilename('....pdf')).toBe('pdf');
  });

  it('never returns an empty name', () => {
    expect(sanitizeFilename('')).toBe('document');
    expect(sanitizeFilename('///')).toBe('document');
  });

  it('truncates a very long name but keeps its extension', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const clean = sanitizeFilename(long);
    expect(clean.length).toBeLessThanOrEqual(180);
    expect(clean.endsWith('.pdf')).toBe(true);
  });

  it('rejects a file with no extension at all', () => {
    expect(() => validateUpload(candidate('deed', PDF), LIMITS)).toThrow(/no file extension/i);
  });

  it('reads the extension case-insensitively', () => {
    expect(extensionOf('DEED.PDF')).toBe('pdf');
    expect(validateUpload(candidate('DEED.PDF', PDF), LIMITS).mime).toBe('application/pdf');
  });
});

describe('size limits', () => {
  it('rejects an empty file', () => {
    expect(() => validateUpload(candidate('empty.pdf', Buffer.alloc(0)), LIMITS)).toThrow(
      /is empty/i,
    );
  });

  it('rejects a file over the configured limit', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(2048)]);
    expect(() => validateUpload(candidate('big.pdf', big), { ...LIMITS, maxFileBytes: 1024 })).toThrow(
      PayloadTooLargeError,
    );
  });
});

describe('administrator-configured type list', () => {
  it('lets an administrator narrow the accepted types', () => {
    const pdfOnly = { ...LIMITS, allowedMimeTypes: ['application/pdf'] };
    expect(validateUpload(candidate('deed.pdf', PDF), pdfOnly).mime).toBe('application/pdf');
    expect(() => validateUpload(candidate('photo.png', PNG, 'image/png'), pdfOnly)).toThrow(
      /not currently accepted/i,
    );
  });

  it('does not let configuration widen the built-in list', () => {
    // Even if an administrator lists a dangerous type, the extension and magic
    // checks still refuse it.
    const permissive = { ...LIMITS, allowedMimeTypes: ['application/x-msdownload'] };
    expect(() => validateUpload(candidate('tool.exe', MZ_EXE), permissive)).toThrow(
      /never accepted/i,
    );
  });
});

describe('content sniffing', () => {
  it('identifies each supported type from its leading bytes', () => {
    expect(sniffType(PDF).map((t) => t.mime)).toContain('application/pdf');
    expect(sniffType(PNG).map((t) => t.mime)).toContain('image/png');
    expect(sniffType(JPEG).map((t) => t.mime)).toContain('image/jpeg');
  });

  it('identifies nothing for an unknown binary', () => {
    expect(sniffType(MZ_EXE)).toHaveLength(0);
    expect(sniffType(ELF)).toHaveLength(0);
  });

  it('does not crash on a file shorter than a signature', () => {
    expect(sniffType(Buffer.from([0x25]))).toHaveLength(0);
  });
});

describe('scanner verdicts (fail-closed)', () => {
  it('releases only a clean file', () => {
    expect(statusForVerdict('CLEAN')).toBe('CLEAN');
  });

  it('marks an infected file as infected', () => {
    expect(statusForVerdict('INFECTED')).toBe('INFECTED');
  });

  it('quarantines when the scanner could not run', () => {
    // The decisive rule: an unscanned file must never become downloadable
    // merely because the scanner was unavailable.
    expect(statusForVerdict('UNAVAILABLE')).toBe('QUARANTINED');
  });
});

describe('storage location', () => {
  it('refuses to store uploads inside the application directory', () => {
    expect(() => new LocalStorageProvider('./storage')).toThrow(ConfigurationError);
    expect(() => new LocalStorageProvider(process.cwd())).toThrow(ConfigurationError);
  });

  it('defaults to a sibling folder outside the code', () => {
    expect(defaultStorageRoot()).toBe(path.resolve(process.cwd(), '..', 'NibValutionStorage'));
    expect(() => new LocalStorageProvider(defaultStorageRoot())).not.toThrow();
  });
});
