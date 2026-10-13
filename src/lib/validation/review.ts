import { z } from 'zod';

/**
 * Checker review comments (spec section 33; roadmap Phase 4).
 *
 * A comment is tagged with the part of the valuation it concerns, so a return
 * for correction can record which sections were flagged and the maker can go
 * straight to them.
 */

export const REVIEW_SECTIONS = [
  'GENERAL',
  'PROPERTY',
  'LAND',
  'BUILDINGS',
  'ITEMS',
  'COMPARABLES',
  'RECONCILIATION',
  'FORCED_SALE',
  'DOCUMENTS',
  'SITE_VISIT',
] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export const REVIEW_SECTION_LABELS: Record<ReviewSection, string> = {
  GENERAL: 'General',
  PROPERTY: 'Property details',
  LAND: 'Land',
  BUILDINGS: 'Buildings',
  ITEMS: 'Vehicles and machinery',
  COMPARABLES: 'Comparables',
  RECONCILIATION: 'Reconciliation',
  FORCED_SALE: 'Forced sale',
  DOCUMENTS: 'Documents',
  SITE_VISIT: 'Site visit',
};

export const raiseCommentSchema = z.object({
  caseId: z.string().uuid(),
  section: z.enum(REVIEW_SECTIONS),
  body: z.string().trim().min(1, 'Write the comment.').max(4000),
});
export type RaiseCommentInput = z.infer<typeof raiseCommentSchema>;

export const replyCommentSchema = z.object({
  caseId: z.string().uuid(),
  parentId: z.string().uuid(),
  body: z.string().trim().min(2, 'Write a reply.').max(4000),
});
export type ReplyCommentInput = z.infer<typeof replyCommentSchema>;

export const resolveCommentSchema = z.object({
  caseId: z.string().uuid(),
  commentId: z.string().uuid(),
  resolved: z.enum(['true', 'false']).transform((v) => v === 'true'),
});
export type ResolveCommentInput = z.infer<typeof resolveCommentSchema>;
