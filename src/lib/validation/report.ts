import { z } from 'zod';
import { CASE_STATUSES } from '@/server/domain/shared/enums';

/**
 * Report filters.
 *
 * Every filter lives in the query string rather than in component state, so a
 * report is a URL: it can be bookmarked, sent to a colleague, and — critically
 * — handed to the CSV endpoint unchanged, which is what guarantees the export
 * and the screen describe the same set of cases.
 *
 * Unknown values are dropped by the caller rather than rejected. A stale
 * bookmark should render the unfiltered report, not an error page.
 */
export const reportFilterSchema = z.object({
  /** Inclusive, on the case creation date, interpreted as UTC days. */
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  status: z.enum(CASE_STATUSES).optional(),
  discipline: z.enum(['CIVIL', 'MECHANICAL']).optional(),
  /** Requesting organisation id. */
  orgId: z.string().uuid().optional(),
  requestTypeCode: z.string().trim().max(40).optional(),

  /** Only cases carrying a final value — the basis for value reporting. */
  valuedOnly: z
    .union([z.literal('1'), z.literal('true'), z.literal('')])
    .optional()
    .transform((v) => v === '1' || v === 'true'),

  page: z.coerce.number().int().min(1).optional(),
});

export type ReportFilterInput = z.infer<typeof reportFilterSchema>;

/**
 * The columns a user may put in an export, and their headers.
 *
 * Declared once and shared by the picker and the CSV writer, so a column
 * offered in the dialog cannot be one the writer does not know how to emit.
 */
export const EXPORT_COLUMNS = [
  { key: 'caseNumber', label: 'Case number' },
  { key: 'status', label: 'Status' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'requestType', label: 'Request type' },
  { key: 'requestingOrg', label: 'Requesting unit' },
  { key: 'department', label: 'Department' },
  { key: 'applicantName', label: 'Applicant' },
  { key: 'ownerName', label: 'Owner' },
  { key: 'maker', label: 'Maker' },
  { key: 'checker', label: 'Checker' },
  { key: 'finalValue', label: 'Market value (ETB)' },
  { key: 'forcedSaleValue', label: 'Forced sale (ETB)' },
  { key: 'currency', label: 'Currency' },
  { key: 'createdAt', label: 'Raised (UTC)' },
  { key: 'requestedAt', label: 'Submitted (UTC)' },
  { key: 'approvedAt', label: 'Approved (UTC)' },
  { key: 'completedAt', label: 'Completed (UTC)' },
  { key: 'slaStatus', label: 'SLA status' },
  { key: 'slaDueAt', label: 'SLA due (UTC)' },
  { key: 'elapsedWorkingDays', label: 'Elapsed working days' },
] as const;

export type ExportColumnKey = (typeof EXPORT_COLUMNS)[number]['key'];

export const EXPORT_COLUMN_KEYS = EXPORT_COLUMNS.map((c) => c.key) as readonly ExportColumnKey[];

/** What the export defaults to before a user has expressed a preference. */
export const DEFAULT_EXPORT_COLUMNS: readonly ExportColumnKey[] = [
  'caseNumber',
  'status',
  'discipline',
  'requestType',
  'requestingOrg',
  'ownerName',
  'finalValue',
  'forcedSaleValue',
  'createdAt',
  'slaStatus',
];

/**
 * Export options, parsed from the query string of the download request.
 *
 * `columns` is a comma-separated list. Unknown keys are discarded rather than
 * rejected, and an empty result falls back to the default set — a saved
 * preference from an older build should still produce a usable file.
 */
export const exportOptionsSchema = z.object({
  columns: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [...DEFAULT_EXPORT_COLUMNS];
      const wanted = new Set(value.split(',').map((c) => c.trim()));
      const chosen = EXPORT_COLUMN_KEYS.filter((key) => wanted.has(key));
      return chosen.length > 0 ? chosen : [...DEFAULT_EXPORT_COLUMNS];
    }),
  /** Excel outside en-US opens comma files badly; a semicolon is offered. */
  delimiter: z
    .enum(['comma', 'semicolon'])
    .optional()
    .transform((v) => (v === 'semicolon' ? ';' : ',')),
  /** Prepend a UTF-8 BOM so Excel renders Amharic and é correctly. */
  bom: z
    .union([z.literal('0'), z.literal('1'), z.literal('')])
    .optional()
    .transform((v) => v !== '0'),
});

export type ExportOptions = z.infer<typeof exportOptionsSchema>;
