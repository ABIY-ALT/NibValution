import { describe, expect, it } from 'vitest';
import { dec } from '@/lib/money';
import {
  assertApprovalTurn,
  findThreshold,
  nextApprovalStep,
  resolveFinalLetterAuthority,
  resolveRouting,
  validateThresholdSet,
  type ApprovalThresholdRule,
  type FinalLetterRule,
} from '@/server/domain/approval/routing';
import { BusinessRuleError, ConfigurationError } from '@/lib/errors';

const EPOCH = new Date('2020-01-01T00:00:00Z');

/**
 * The bands mirror what the seed writes, which in turn mirrors spec section 17.
 * The 5,000,000.01 boundary is deliberate: "up to ETB 5 million" reads as
 * inclusive and "above ETB 5 million" as exclusive, and amounts are held to two
 * decimals, so the smallest amount genuinely above 5 million is 5,000,000.01.
 */
function seededThresholds(): ApprovalThresholdRule[] {
  return [
    {
      id: '1',
      name: 'Up to ETB 5 million',
      minAmount: dec('0'),
      maxAmount: dec('5000000.01'),
      approvalChain: ['CHECKER'],
      effectiveFrom: EPOCH,
      effectiveTo: null,
    },
    {
      id: '2',
      name: 'Above ETB 5 million and below ETB 80 million',
      minAmount: dec('5000000.01'),
      maxAmount: dec('80000000'),
      approvalChain: ['CHECKER', 'MAKER_MANAGER'],
      effectiveFrom: EPOCH,
      effectiveTo: null,
    },
    {
      id: '3',
      name: 'ETB 80 million and above',
      minAmount: dec('80000000'),
      maxAmount: null,
      approvalChain: ['CHECKER', 'MAKER_MANAGER', 'DIRECTOR'],
      effectiveFrom: EPOCH,
      effectiveTo: null,
    },
  ];
}

describe('approval routing', () => {
  describe('band selection', () => {
    it.each([
      ['0', 'Up to ETB 5 million'],
      ['1500000', 'Up to ETB 5 million'],
      ['5000000', 'Up to ETB 5 million'],
      ['5000000.01', 'Above ETB 5 million and below ETB 80 million'],
      ['5000001', 'Above ETB 5 million and below ETB 80 million'],
      ['79999999.99', 'Above ETB 5 million and below ETB 80 million'],
      ['80000000', 'ETB 80 million and above'],
      ['250000000', 'ETB 80 million and above'],
    ])('routes %s to "%s"', (amount, expectedBand) => {
      expect(findThreshold(seededThresholds(), amount).name).toBe(expectedBand);
    });

    it('rejects a negative valuation amount', () => {
      expect(() => findThreshold(seededThresholds(), '-1')).toThrow(BusinessRuleError);
    });
  });

  describe('resolved chains', () => {
    it('finalises a small case at checking, with no further approver', () => {
      const routing = resolveRouting(seededThresholds(), '4000000');
      expect(routing.approvalChain).toEqual([]);
      expect(routing.highestLevel).toBe('CHECKER');
      expect(routing.nextStatusAfterChecking).toBe('APPROVED');
    });

    it('routes a mid-band case to the manager', () => {
      const routing = resolveRouting(seededThresholds(), '20000000');
      expect(routing.approvalChain).toEqual(['MAKER_MANAGER']);
      expect(routing.highestLevel).toBe('MANAGER');
      expect(routing.nextStatusAfterChecking).toBe('PENDING_MANAGER_APPROVAL');
    });

    it('routes a high-value case through the manager and then the director', () => {
      const routing = resolveRouting(seededThresholds(), '95000000');
      expect(routing.approvalChain).toEqual(['MAKER_MANAGER', 'DIRECTOR']);
      expect(routing.highestLevel).toBe('DIRECTOR');
      // Cumulative, not a jump straight to the director.
      expect(routing.nextStatusAfterChecking).toBe('PENDING_MANAGER_APPROVAL');
    });
  });

  describe('approval order', () => {
    it('advances to the director only after the manager has approved', () => {
      const routing = resolveRouting(seededThresholds(), '95000000');

      expect(nextApprovalStep(routing, []).nextRole).toBe('MAKER_MANAGER');
      expect(nextApprovalStep(routing, ['MAKER_MANAGER']).status).toBe(
        'PENDING_DIRECTOR_APPROVAL',
      );
      expect(nextApprovalStep(routing, ['MAKER_MANAGER', 'DIRECTOR']).status).toBe('APPROVED');
      expect(nextApprovalStep(routing, ['MAKER_MANAGER', 'DIRECTOR']).nextRole).toBeNull();
    });

    it('refuses a director approval that would skip the manager', () => {
      const routing = resolveRouting(seededThresholds(), '95000000');
      expect(() => assertApprovalTurn(routing, [], 'DIRECTOR')).toThrow(BusinessRuleError);
      expect(() => assertApprovalTurn(routing, [], 'MAKER_MANAGER')).not.toThrow();
    });

    it('refuses an approval once the chain is complete', () => {
      const routing = resolveRouting(seededThresholds(), '20000000');
      expect(() => assertApprovalTurn(routing, ['MAKER_MANAGER'], 'DIRECTOR')).toThrow(
        /already received every approval/,
      );
    });
  });

  describe('configuration validation', () => {
    it('accepts the seeded ladder', () => {
      expect(() => validateThresholdSet(seededThresholds())).not.toThrow();
    });

    /** Replace one band with a modified copy - the rules are readonly by design. */
    function withBand(index: number, patch: Partial<ApprovalThresholdRule>) {
      return seededThresholds().map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    }

    it('rejects a ladder that does not start at zero', () => {
      expect(() => validateThresholdSet(withBand(0, { minAmount: dec('1000') }))).toThrow(
        /must start at 0/,
      );
    });

    it('rejects a gap between bands', () => {
      expect(() => validateThresholdSet(withBand(1, { maxAmount: dec('70000000') }))).toThrow(
        /gap between/,
      );
    });

    it('rejects overlapping bands', () => {
      expect(() => validateThresholdSet(withBand(1, { maxAmount: dec('90000000') }))).toThrow(
        /overlap between/,
      );
    });

    it('rejects a ladder with no unbounded top band', () => {
      expect(() => validateThresholdSet(withBand(2, { maxAmount: dec('500000000') }))).toThrow(
        /must be unbounded/,
      );
    });

    it('rejects an empty approval chain', () => {
      expect(() => validateThresholdSet(withBand(1, { approvalChain: [] }))).toThrow(
        /empty approval chain/,
      );
    });

    it('rejects a configuration with no rules in force', () => {
      expect(() => validateThresholdSet([])).toThrow(ConfigurationError);
    });
  });

  describe('temporal rules', () => {
    it('applies the ladder that was in force on the case date, not today', () => {
      // Raising a threshold must not retroactively make last year's approvals
      // look non-compliant.
      const historic: ApprovalThresholdRule[] = [
        {
          id: 'old-low',
          name: 'Old: up to ETB 2 million',
          minAmount: dec('0'),
          maxAmount: dec('2000000'),
          approvalChain: ['CHECKER'],
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          effectiveTo: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'old-high',
          name: 'Old: above ETB 2 million',
          minAmount: dec('2000000'),
          maxAmount: null,
          approvalChain: ['CHECKER', 'MAKER_MANAGER'],
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          effectiveTo: new Date('2026-01-01T00:00:00Z'),
        },
        ...seededThresholds().map((rule) => ({
          ...rule,
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        })),
      ];

      const underOldRules = resolveRouting(historic, '3000000', new Date('2025-06-01T00:00:00Z'));
      expect(underOldRules.approvalChain).toEqual(['MAKER_MANAGER']);

      const underNewRules = resolveRouting(historic, '3000000', new Date('2026-06-01T00:00:00Z'));
      expect(underNewRules.approvalChain).toEqual([]);
    });
  });

  describe('final letter authority (spec section 18)', () => {
    const letterRules: FinalLetterRule[] = [
      {
        id: 'a',
        name: 'Below ETB 100 million',
        minAmount: dec('0'),
        maxAmount: dec('100000000'),
        issuerRole: 'MAKER_MANAGER',
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
      {
        id: 'b',
        name: 'ETB 100 million and above',
        minAmount: dec('100000000'),
        maxAmount: null,
        issuerRole: 'DIRECTOR',
        effectiveFrom: EPOCH,
        effectiveTo: null,
      },
    ];

    it('assigns the letter to the manager below the letter threshold', () => {
      expect(resolveFinalLetterAuthority(letterRules, '99999999.99').issuerRole).toBe(
        'MAKER_MANAGER',
      );
    });

    it('assigns the letter to the director at and above the letter threshold', () => {
      expect(resolveFinalLetterAuthority(letterRules, '100000000').issuerRole).toBe('DIRECTOR');
    });

    it('is independent of the approval ladder', () => {
      // A case at ETB 90 million needs director *approval* (>= 80M) but the
      // manager still issues the letter (< 100M). The two ladders differ, and
      // conflating them would put the wrong signature on the letter.
      const routing = resolveRouting(seededThresholds(), '90000000');
      expect(routing.highestLevel).toBe('DIRECTOR');
      expect(resolveFinalLetterAuthority(letterRules, '90000000').issuerRole).toBe('MAKER_MANAGER');
    });
  });
});
