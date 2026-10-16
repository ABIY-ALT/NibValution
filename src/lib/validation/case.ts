import { z } from 'zod';
import { CASE_STATUSES } from '@/server/domain/shared/enums';

/**
 * Request-intake input schemas.
 *
 * Shared with the client form for immediate feedback, but the server parses
 * independently rather than trusting that the client did (rule 4).
 *
 * Note what is *not* here: case number, status, department, requesting
 * organisation and the requester are all derived server-side. Accepting them
 * from the form would be a mass-assignment hole — a Process Owner could file a
 * case against another branch, or open one directly in an approved state.
 */

const personName = z
  .string()
  .trim()
  .min(2, 'Enter the full name.')
  .max(160, 'That name is too long.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

const phone = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9()\-\s]*$/, 'Use digits, spaces and + ( ) - only.')
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const createCaseSchema = z.object({
  requestTypeCode: z.string().trim().min(1, 'Choose a request type.').max(40),
  discipline: z.enum(['CIVIL', 'MECHANICAL'], {
    message: 'Choose whether this is a civil or mechanical valuation.',
  }),

  applicantName: personName,
  applicantPhone: phone,
  applicantTin: optionalText(32),

  ownerName: personName,
  ownerPhone: phone,
  ownerIdNumber: optionalText(64),

  purpose: optionalText(400),
  remarks: optionalText(1000),

  /** Required for re-estimation, appeal and progress; enforced server-side. */
  priorCaseNumber: optionalText(40),
});
export type CreateCaseInputSchema = z.infer<typeof createCaseSchema>;

/**
 * A workflow transition posted from the UI.
 *
 * `expectedVersion` is what makes concurrent editing safe: the server refuses
 * the transition if the case has moved since the page was rendered (rule 14).
 */
export const transitionSchema = z.object({
  caseId: z.string().uuid('That is not a valid case reference.'),
  action: z.string().trim().min(1).max(48),
  expectedVersion: z.coerce.number().int().min(1),
  comment: z.string().trim().max(2000).optional(),
  reasonCode: z.string().trim().max(64).optional(),
  assigneeId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});
export type TransitionInput = z.infer<typeof transitionSchema>;

export const caseFilterSchema = z.object({
  status: z.enum(CASE_STATUSES).optional(),
  discipline: z.enum(['CIVIL', 'MECHANICAL']).optional(),
  requestTypeCode: z.string().trim().max(40).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
});
