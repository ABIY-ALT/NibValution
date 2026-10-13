/**
 * The covering letter the Property Valuation Division sends with an estimation
 * comes in three formats, taken from the Division's own samples:
 *
 *  - LOAN_RECOVERY: a foreclosure valuation. An inter-department memorandum
 *    stating the foreclosure (forced-sale) value.
 *  - UNDER_CONSTRUCTION: a building that is not finished. The letter states no
 *    figure; the value is given only in the attached estimation.
 *  - COMPLETED: everything else. The letter states the estimated value.
 *
 * Foreclosure takes precedence: a foreclosed building that is unfinished still
 * goes to the recovery unit as a memorandum stating what it would fetch.
 */
export const LETTER_FORMATS = ['COMPLETED', 'UNDER_CONSTRUCTION', 'LOAN_RECOVERY'] as const;
export type LetterFormat = (typeof LETTER_FORMATS)[number];

export function resolveLetterFormat(input: {
  requestTypeCode: string;
  constructionStatuses: readonly string[];
}): LetterFormat {
  if (input.requestTypeCode === 'FORECLOSURE') return 'LOAN_RECOVERY';
  if (
    input.requestTypeCode === 'PROGRESS' ||
    input.constructionStatuses.some((status) => status !== 'COMPLETED')
  ) {
    return 'UNDER_CONSTRUCTION';
  }
  return 'COMPLETED';
}

const ISSUER_TITLES: Record<string, string> = {
  DIRECTOR: 'Director',
  MAKER_MANAGER: 'Manager',
  ADMIN: 'Administrator',
};

/**
 * The "From" line under the issuer's name, e.g. "Director - Property Valuation
 * Division" or "Manager - Property Valuation Division (Maker)". The unit is the
 * case's department as configured, not a fixed string.
 */
export function issuerTitle(role: string, department: string): string {
  const title = ISSUER_TITLES[role] ?? role;
  return `${title} - ${department}${role === 'MAKER_MANAGER' ? ' (Maker)' : ''}`;
}
