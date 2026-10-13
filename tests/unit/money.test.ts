import { describe, expect, it } from 'vitest';
import {
  Decimal,
  amountInWords,
  MoneyError,
  assertNonNegative,
  assertPercent,
  dec,
  divide,
  formatAmount,
  formatCompact,
  formatCurrency,
  increaseByPercent,
  money,
  multiply,
  percentOf,
  reduceByPercent,
  sum,
  toMoneyString,
  weightedSum,
} from '@/lib/money';

/**
 * These tests exist because spec section 28 and rule 15 make decimal arithmetic
 * a correctness requirement, not an implementation detail. The float-comparison
 * cases below are the whole point: each one is a figure that JavaScript's
 * native arithmetic gets wrong by a fraction of a cent, which is a
 * reconciliation defect once it reaches a collateral report.
 */
describe('money arithmetic', () => {
  it('adds values that IEEE floating point cannot represent exactly', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in native arithmetic.
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('preserves the decimal a user typed rather than its binary approximation', () => {
    // Passing a JS number still routes through String(), so 1.005 stays 1.005.
    expect(money(1.005).toString()).toBe('1.01');
    expect(dec(1.1).plus(dec(2.2)).toString()).toBe('3.3');
  });

  it('sums a long column of ETB amounts without drift', () => {
    const hundredCents = Array.from({ length: 1000 }, () => '0.01');
    expect(sum(hundredCents).toString()).toBe('10');
  });

  it('rounds half-up at money scale', () => {
    expect(money('2.345').toFixed(2)).toBe('2.35');
    expect(money('2.344').toFixed(2)).toBe('2.34');
    expect(money('-2.345').toFixed(2)).toBe('-2.35');
  });

  it('computes a percentage of a large collateral value exactly', () => {
    // A realistic case: forced sale at 75% of ETB 84,375,000.
    expect(percentOf('84375000', '75').toFixed(2)).toBe('63281250.00');
  });

  it('reduces and increases by percentage', () => {
    expect(reduceByPercent('1000000', '12.5').toFixed(2)).toBe('875000.00');
    expect(increaseByPercent('1000000', '12.5').toFixed(2)).toBe('1125000.00');
  });

  it('multiplies quantity by rate at money scale', () => {
    expect(multiply('123.456', '7890.12').toFixed(2)).toBe('974082.65');
  });

  it('refuses division by zero rather than producing Infinity', () => {
    // A silent Infinity here would propagate into a reported valuation.
    expect(() => divide('100', '0')).toThrow(MoneyError);
    expect(divide('100', '3', 4).toString()).toBe('33.3333');
  });

  it('computes a weighted reconciliation', () => {
    const result = weightedSum([
      { value: '10000000', weightPercent: '60' },
      { value: '12000000', weightPercent: '40' },
    ]);
    expect(result.toFixed(2)).toBe('10800000.00');
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => dec('abc')).toThrow(MoneyError);
    expect(() => dec(Number.NaN)).toThrow(MoneyError);
    expect(() => dec(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => dec(null)).toThrow(MoneyError);
  });

  it('accepts null when an explicit fallback is supplied', () => {
    expect(dec(null, '0').toString()).toBe('0');
    expect(dec(undefined, 5).toString()).toBe('5');
    expect(dec('', '12.5').toString()).toBe('12.5');
  });

  it('guards non-negative amounts and percentage ranges', () => {
    expect(() => assertNonNegative('-1', 'Replacement cost')).toThrow(/must not be negative/);
    expect(assertNonNegative('0', 'Replacement cost').toString()).toBe('0');
    expect(() => assertPercent('101', 'Weight')).toThrow(/between 0 and 100/);
    expect(() => assertPercent('-0.01', 'Weight')).toThrow(/between 0 and 100/);
    expect(assertPercent('100', 'Weight').toString()).toBe('100');
  });

  it('serialises money as a string so precision survives the wire', () => {
    // A large ETB amount as a JSON number would lose its last digits.
    expect(toMoneyString('123456789012345.67')).toBe('123456789012345.67');
    expect(typeof toMoneyString('1')).toBe('string');
  });

  it('formats amounts with thousands separators', () => {
    expect(formatAmount('1234567.5')).toBe('1,234,567.50');
    expect(formatAmount('-1234567.5')).toBe('-1,234,567.50');
    expect(formatAmount('999')).toBe('999.00');
    expect(formatAmount('0')).toBe('0.00');
    expect(formatCurrency('84375000')).toBe('ETB 84,375,000.00');
  });

  it('formats compact figures for tiles', () => {
    expect(formatCompact('0')).toBe('0');
    expect(formatCompact('940.4')).toBe('940');
    expect(formatCompact('12000')).toBe('12K');
    expect(formatCompact('860549000')).toBe('860.5M');
    expect(formatCompact('1243567000.00')).toBe('1.2B');
    expect(formatCompact('-2500000')).toBe('-2.5M');
    // The unit below would round these up to 1000 of itself.
    expect(formatCompact('999.7')).toBe('1K');
    expect(formatCompact('999960')).toBe('1M');
  });

  it('does not use exponential notation for values in the ETB range', () => {
    const large = money('99999999999999.99');
    expect(large.toFixed(2)).toBe('99999999999999.99');
    expect(large.toString()).not.toContain('e');
  });

  it('treats Decimal instances as first-class inputs', () => {
    expect(sum([new Decimal('1.5'), '2.5', 3]).toString()).toBe('7');
  });
});

describe('amount in words', () => {
  it('writes amounts as the Division’s letters do', () => {
    // The figures from the Division's own sample letters.
    expect(amountInWords('151588663.36')).toEqual({
      words:
        'One Hundred Fifty One Million Five Hundred Eighty Eight Thousand Six Hundred Sixty Three',
      cents: '36',
    });
    expect(amountInWords('12938950.93')).toEqual({
      words: 'Twelve Million Nine Hundred Thirty Eight Thousand Nine Hundred Fifty',
      cents: '93',
    });
  });

  it('skips empty groups and handles the edges', () => {
    expect(amountInWords('1000000').words).toBe('One Million');
    expect(amountInWords('2000015.5')).toEqual({ words: 'Two Million Fifteen', cents: '50' });
    expect(amountInWords('0.75')).toEqual({ words: 'Zero', cents: '75' });
    expect(amountInWords('999999999999999999.99').words).toMatch(
      /^Nine Hundred Ninety Nine Quadrillion/,
    );
  });

  it('refuses a negative amount', () => {
    expect(() => amountInWords('-1')).toThrow(MoneyError);
  });
});
