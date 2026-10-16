import { z } from 'zod';
import { dec } from '@/lib/money';

/**
 * The valuator's figures - the market and forced-sale values the Maker enters
 * for the registered property (spec sections 9-13).
 *
 * Amounts stay strings end to end, exactly as in property registration: an ETB
 * figure parsed into a JavaScript number to be validated has already been
 * rounded.
 */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable());

/** An ETB amount as the valuation columns hold it: up to 18 digits and 2 decimals. */
const ETB_AMOUNT = /^\d{1,18}(\.\d{1,2})?$/;

const etb = (label: string) =>
  z.preprocess(
    // "1,250,000" is how a figure is written; the separators carry no value.
    (v) => (typeof v === 'string' ? v.replace(/,/g, '') : v),
    z
      .string({ error: `${label} is required.` })
      .trim()
      .min(1, { message: `${label} is required.`, abort: true })
      .regex(ETB_AMOUNT, {
        message: `${label} must be an amount in ETB, e.g. 1250000.50.`,
        abort: true,
      })
      .refine((v) => /[1-9]/.test(v), { message: `${label} must be above zero.` }),
  );

const valuationDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the valuation date.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: 'Enter a real date.' })
  .refine((v) => v >= '2000-01-01', { message: 'The valuation date looks too early.' })
  .refine((v) => v <= new Date().toISOString().slice(0, 10), {
    message: 'The valuation date cannot be in the future.',
  });

export const valuationFiguresSchema = z
  .object({
    caseId: z.string().uuid(),
    valuationDate,
    marketValue: etb('Market value'),
    forcedSaleValue: etb('Forced-sale value'),
    remarks: text(4000),
  })
  .superRefine((value, ctx) => {
    // Zod runs this even when a field above failed; compare only real amounts.
    if (!ETB_AMOUNT.test(value.marketValue) || !ETB_AMOUNT.test(value.forcedSaleValue)) return;
    if (dec(value.forcedSaleValue).greaterThan(value.marketValue)) {
      ctx.addIssue({
        code: 'custom',
        path: ['forcedSaleValue'],
        message: 'The forced-sale value cannot exceed the market value.',
      });
    }
  });
export type ValuationFiguresInput = z.infer<typeof valuationFiguresSchema>;
