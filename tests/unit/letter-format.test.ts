import { describe, expect, it } from 'vitest';
import { issuerTitle, resolveLetterFormat } from '@/server/domain/documents/letter-format';

describe('covering-letter format', () => {
  it('sends a foreclosure as a loan-recovery memorandum, whatever the building', () => {
    expect(
      resolveLetterFormat({ requestTypeCode: 'FORECLOSURE', constructionStatuses: ['COMPLETED'] }),
    ).toBe('LOAN_RECOVERY');
    expect(
      resolveLetterFormat({
        requestTypeCode: 'FORECLOSURE',
        constructionStatuses: ['UNDER_CONSTRUCTION'],
      }),
    ).toBe('LOAN_RECOVERY');
  });

  it('uses the under-construction format when any building is unfinished', () => {
    expect(
      resolveLetterFormat({
        requestTypeCode: 'NEW',
        constructionStatuses: ['COMPLETED', 'UNDER_CONSTRUCTION'],
      }),
    ).toBe('UNDER_CONSTRUCTION');
    expect(
      resolveLetterFormat({ requestTypeCode: 'NEW', constructionStatuses: ['ABANDONED'] }),
    ).toBe('UNDER_CONSTRUCTION');
    expect(resolveLetterFormat({ requestTypeCode: 'PROGRESS', constructionStatuses: [] })).toBe(
      'UNDER_CONSTRUCTION',
    );
  });

  it('uses the completed format otherwise, including mechanical cases', () => {
    expect(
      resolveLetterFormat({ requestTypeCode: 'NEW', constructionStatuses: ['COMPLETED'] }),
    ).toBe('COMPLETED');
    expect(
      resolveLetterFormat({ requestTypeCode: 'RE_ESTIMATION', constructionStatuses: [] }),
    ).toBe('COMPLETED');
  });

  it('titles the issuer as the samples do', () => {
    expect(issuerTitle('DIRECTOR', 'Property Valuation Division')).toBe(
      'Director - Property Valuation Division',
    );
    expect(issuerTitle('MAKER_MANAGER', 'Property Valuation Division')).toBe(
      'Manager - Property Valuation Division (Maker)',
    );
  });
});
