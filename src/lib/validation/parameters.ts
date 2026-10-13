import { z } from 'zod';
import { PARAMETER_TYPES } from '@/server/domain/shared/enums';

/**
 * Publishing a valuation parameter.
 *
 * A parameter is never edited in place: adding one, or changing one, publishes
 * a new version of its set. This schema establishes the shape of that request;
 * whether the date is allowed and whether the type may change are decided in
 * `admin-service`, which can see the versions already published.
 */

/** Lower-case words joined by dots, e.g. `depreciation.residual_percent`. */
export const PARAMETER_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** A table entry name as the engine looks it up, e.g. `RCC_FRAME` or `basis`. */
export const TABLE_ENTRY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Fits the `Decimal(20, 6)` column the value is stored in. */
const DECIMAL_PATTERN = /^-?\d{1,14}(\.\d{1,6})?$/;

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null));

export const publishParameterSchema = z
  .object({
    setCode: z.string().trim().min(1, 'Choose a parameter set.').max(40),
    key: z
      .string()
      .trim()
      .toLowerCase()
      .max(80, 'The key must be 80 characters or fewer.')
      .regex(
        PARAMETER_KEY_PATTERN,
        'Use lower-case words joined by dots, e.g. depreciation.residual_percent.',
      ),
    name: z
      .string()
      .trim()
      .min(3, 'Enter a name of at least three characters.')
      .max(120, 'The name must be 120 characters or fewer.'),
    type: z.enum(PARAMETER_TYPES, 'Choose what kind of value this is.'),
    numericValue: z.string().trim().optional(),
    table: z.array(z.object({ entry: z.string().trim(), value: z.string().trim() })).default([]),
    unit: optionalText(20, 'The unit'),
    discipline: z
      .enum(['ALL', 'CIVIL', 'MECHANICAL'])
      .transform((value) => (value === 'ALL' ? null : value)),
    notes: optionalText(1000, 'Notes'),
    effectiveFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date this takes effect.')
      .refine(
        (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
        'That is not a valid date.',
      ),
    reason: z
      .string()
      .trim()
      .min(5, 'Say briefly why this is being added or changed.')
      .max(500, 'The reason must be 500 characters or fewer.'),
  })
  .superRefine((input, ctx) => {
    if (input.type === 'TABLE') {
      const rows = input.table.filter((row) => row.entry !== '' || row.value !== '');
      if (rows.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['table'], message: 'Add at least one row.' });
        return;
      }
      const seen = new Set<string>();
      for (const row of rows) {
        if (!TABLE_ENTRY_PATTERN.test(row.entry)) {
          ctx.addIssue({
            code: 'custom',
            path: ['table'],
            message: `“${row.entry || '(blank)'}” is not a valid entry name. Use letters, digits and underscores, e.g. RCC_FRAME.`,
          });
          return;
        }
        if (seen.has(row.entry)) {
          ctx.addIssue({
            code: 'custom',
            path: ['table'],
            message: `“${row.entry}” appears twice.`,
          });
          return;
        }
        seen.add(row.entry);
        if (row.value === '') {
          ctx.addIssue({
            code: 'custom',
            path: ['table'],
            message: `Enter a value for “${row.entry}”.`,
          });
          return;
        }
      }
      return;
    }

    const raw = input.numericValue ?? '';
    if (!DECIMAL_PATTERN.test(raw)) {
      ctx.addIssue({
        code: 'custom',
        path: ['numericValue'],
        message: 'Enter a number, using a full stop for decimals (up to 6 places).',
      });
      return;
    }
    const value = Number(raw);
    if (input.type === 'PERCENT' && (value < 0 || value > 100)) {
      ctx.addIssue({
        code: 'custom',
        path: ['numericValue'],
        message: 'A percentage must be between 0 and 100.',
      });
    }
    if ((input.type === 'FACTOR' || input.type === 'YEARS') && value <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['numericValue'],
        message: 'This must be greater than zero.',
      });
    }
    if ((input.type === 'RATE' || input.type === 'AMOUNT') && value < 0) {
      ctx.addIssue({ code: 'custom', path: ['numericValue'], message: 'This cannot be negative.' });
    }
  })
  .transform((input) => ({
    ...input,
    numericValue: input.type === 'TABLE' ? null : (input.numericValue ?? null),
    table:
      input.type === 'TABLE'
        ? input.table.filter((row) => row.entry !== '' || row.value !== '')
        : [],
  }));

export type PublishParameterInput = z.infer<typeof publishParameterSchema>;
