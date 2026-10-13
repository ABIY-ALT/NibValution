import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONDITION_MODIFIERS,
  calculateDepreciation,
  effectiveAgeFromYear,
  lifeConsumedPercent,
  remainingUsefulLife,
} from '@/server/domain/valuation/depreciation';
import { BusinessRuleError } from '@/lib/errors';

describe('depreciation', () => {
  describe('straight line', () => {
    it('depreciates in proportion to age over economic life', () => {
      const result = calculateDepreciation({
        method: 'STRAIGHT_LINE',
        baseAmount: '10000000',
        effectiveAgeYears: 15,
        economicLifeYears: 50,
      });

      expect(result.ratePercent.toFixed(2)).toBe('30.00');
      expect(result.amount.toFixed(2)).toBe('3000000.00');
      expect(result.depreciatedValue.toFixed(2)).toBe('7000000.00');
      expect(result.formula).toContain('effective age 15');
      expect(result.formula).toContain('economic life 50');
    });

    it('caps depreciation at the residual floor rather than reaching zero', () => {
      // A 60-year-old building on a 50-year life is fully consumed on paper,
      // but a standing structure retains value - hence the floor.
      const result = calculateDepreciation({
        method: 'STRAIGHT_LINE',
        baseAmount: '10000000',
        effectiveAgeYears: 60,
        economicLifeYears: 50,
        residualPercent: 10,
      });

      expect(result.ratePercent.toFixed(2)).toBe('90.00');
      expect(result.depreciatedValue.toFixed(2)).toBe('1000000.00');
      expect(result.formula).toContain('capped at 90%');
    });

    it('returns zero depreciation for a brand-new property', () => {
      const result = calculateDepreciation({
        method: 'STRAIGHT_LINE',
        baseAmount: '5000000',
        effectiveAgeYears: 0,
        economicLifeYears: 50,
      });

      expect(result.amount.toFixed(2)).toBe('0.00');
      expect(result.depreciatedValue.toFixed(2)).toBe('5000000.00');
    });
  });

  describe('age-life with condition', () => {
    it('treats a well-maintained property as effectively younger', () => {
      const excellent = calculateDepreciation({
        method: 'AGE_LIFE_CONDITION',
        baseAmount: '10000000',
        effectiveAgeYears: 20,
        economicLifeYears: 50,
        condition: 'EXCELLENT',
      });
      const good = calculateDepreciation({
        method: 'AGE_LIFE_CONDITION',
        baseAmount: '10000000',
        effectiveAgeYears: 20,
        economicLifeYears: 50,
        condition: 'GOOD',
      });

      // 20 x 0.70 / 50 = 28%, against 20 x 1.00 / 50 = 40%.
      expect(excellent.ratePercent.toFixed(2)).toBe('28.00');
      expect(good.ratePercent.toFixed(2)).toBe('40.00');
      expect(excellent.depreciatedValue.greaterThan(good.depreciatedValue)).toBe(true);
      expect(excellent.formula).toContain('EXCELLENT');
    });

    it('treats a poorly maintained property as effectively older', () => {
      const poor = calculateDepreciation({
        method: 'AGE_LIFE_CONDITION',
        baseAmount: '10000000',
        effectiveAgeYears: 20,
        economicLifeYears: 50,
        condition: 'POOR',
      });
      expect(poor.ratePercent.toFixed(2)).toBe('54.00');
    });

    it('requires a condition grade', () => {
      expect(() =>
        calculateDepreciation({
          method: 'AGE_LIFE_CONDITION',
          baseAmount: '1000000',
          effectiveAgeYears: 10,
          economicLifeYears: 50,
        }),
      ).toThrow(BusinessRuleError);
    });

    it('uses configured modifiers rather than the built-in defaults', () => {
      const result = calculateDepreciation(
        {
          method: 'AGE_LIFE_CONDITION',
          baseAmount: '10000000',
          effectiveAgeYears: 20,
          economicLifeYears: 50,
          condition: 'GOOD',
        },
        { ...DEFAULT_CONDITION_MODIFIERS, GOOD: '0.50' },
      );
      expect(result.ratePercent.toFixed(2)).toBe('20.00');
    });
  });

  describe('declining balance', () => {
    it('compounds the annual rate over the effective age', () => {
      const result = calculateDepreciation({
        method: 'DECLINING_BALANCE',
        baseAmount: '1000000',
        effectiveAgeYears: 3,
        economicLifeYears: 20,
        annualRatePercent: 10,
      });

      // 1 - 0.9^3 = 0.271
      expect(result.ratePercent.toFixed(4)).toBe('27.1000');
      expect(result.depreciatedValue.toFixed(2)).toBe('729000.00');
    });

    it('requires an annual rate', () => {
      expect(() =>
        calculateDepreciation({
          method: 'DECLINING_BALANCE',
          baseAmount: '1000000',
          effectiveAgeYears: 3,
          economicLifeYears: 20,
        }),
      ).toThrow(BusinessRuleError);
    });
  });

  describe('input validation', () => {
    it('rejects a zero or negative economic life', () => {
      expect(() =>
        calculateDepreciation({
          method: 'STRAIGHT_LINE',
          baseAmount: '1000000',
          effectiveAgeYears: 5,
          economicLifeYears: 0,
        }),
      ).toThrow(/Economic life must be greater than zero/);
    });

    it('rejects a negative replacement cost', () => {
      expect(() =>
        calculateDepreciation({
          method: 'STRAIGHT_LINE',
          baseAmount: '-1',
          effectiveAgeYears: 5,
          economicLifeYears: 50,
        }),
      ).toThrow(/must not be negative/);
    });
  });

  describe('helpers', () => {
    it('derives effective age from a construction year', () => {
      const valuationDate = new Date('2026-06-15T00:00:00Z');
      expect(effectiveAgeFromYear(2006, valuationDate).toString()).toBe('20');
    });

    it('never reports a negative age for a future construction year', () => {
      const valuationDate = new Date('2026-06-15T00:00:00Z');
      expect(effectiveAgeFromYear(2030, valuationDate).toString()).toBe('0');
    });

    it('accepts an age override where a renovation extended the life', () => {
      const valuationDate = new Date('2026-06-15T00:00:00Z');
      expect(effectiveAgeFromYear(1980, valuationDate, 12).toString()).toBe('12');
    });

    it('computes remaining useful life, floored at zero', () => {
      expect(remainingUsefulLife(15, 50).toString()).toBe('35');
      expect(remainingUsefulLife(60, 50).toString()).toBe('0');
    });

    it('computes the proportion of life consumed', () => {
      expect(lifeConsumedPercent(25, 50).toFixed(2)).toBe('50.00');
      expect(lifeConsumedPercent(75, 50).toFixed(2)).toBe('100.00');
    });
  });
});
