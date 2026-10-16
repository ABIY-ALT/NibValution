/**
 * The parts of a valuation a checker's review comment could be tagged with
 * (spec section 33; roadmap Phase 4).
 *
 * Review comments are no longer raised, but correction cycles recorded before
 * then still name the sections they flagged, and the case page shows them by
 * these labels.
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
