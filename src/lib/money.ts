import Decimal from 'decimal.js';

/**
 * Monetary and rate arithmetic for the valuation engine.
 *
 * Spec section 28 and rule 15: ETB amounts must never be computed or stored as
 * IEEE floats. `0.1 + 0.2 !== 0.3` is a rounding curiosity in most software and
 * a reconciliation defect in a bank. Every figure that reaches a report or the
 * database passes through this module.
 *
 * Decimal.js is configured once, globally, so no call site can quietly use a
 * different precision or rounding mode than another.
 */
Decimal.set({
  // Generous working precision; results are quantised explicitly on the way out.
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export { Decimal };

/** Anything that can be interpreted as a decimal quantity. */
export type Numeric = string | number | Decimal;

/** Scale used for stored and reported ETB amounts. */
export const MONEY_SCALE = 2;

/** Scale used for rates, factors and percentages before they are applied. */
export const RATE_SCALE = 6;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Convert an input to Decimal, rejecting anything that is not a finite number.
 *
 * Numbers are accepted (form input and JSON inevitably produce them) but are
 * routed through `String()` so the decimal literal the user actually typed is
 * preserved rather than its nearest binary approximation.
 */
export function dec(value: Numeric | null | undefined, fallback?: Numeric): Decimal {
  if (value === null || value === undefined || value === '') {
    if (fallback === undefined) {
      throw new MoneyError('A numeric value is required but was null, undefined or empty.');
    }
    return dec(fallback);
  }
  if (value instanceof Decimal) {
    if (!value.isFinite()) throw new MoneyError(`Non-finite decimal: ${value.toString()}`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError(`Non-finite number: ${value}`);
    return new Decimal(String(value));
  }
  const trimmed = value.trim();
  let parsed: Decimal;
  try {
    parsed = new Decimal(trimmed);
  } catch {
    throw new MoneyError(`Not a valid decimal string: "${value}"`);
  }
  if (!parsed.isFinite()) throw new MoneyError(`Non-finite decimal string: "${value}"`);
  return parsed;
}

/** Zero, as a Decimal. */
export const ZERO = new Decimal(0);
/** One hundred, used pervasively for percentage arithmetic. */
export const HUNDRED = new Decimal(100);

/** Round to money scale, half-up. Applied to every value that is stored. */
export function money(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Round to rate scale, half-up. */
export function rate(value: Numeric): Decimal {
  return dec(value).toDecimalPlaces(RATE_SCALE, Decimal.ROUND_HALF_UP);
}

/** Sum a list of amounts at money scale. An empty list sums to zero. */
export function sum(values: Numeric[]): Decimal {
  return money(values.reduce<Decimal>((acc, v) => acc.plus(dec(v)), ZERO));
}

/** `base x (percent / 100)`, at money scale. */
export function percentOf(base: Numeric, percent: Numeric): Decimal {
  return money(dec(base).times(dec(percent)).dividedBy(HUNDRED));
}

/** `base x (1 - percent / 100)`, at money scale. */
export function reduceByPercent(base: Numeric, percent: Numeric): Decimal {
  return money(
    dec(base)
      .times(HUNDRED.minus(dec(percent)))
      .dividedBy(HUNDRED),
  );
}

/** `base x (1 + percent / 100)`, at money scale. */
export function increaseByPercent(base: Numeric, percent: Numeric): Decimal {
  return money(
    dec(base)
      .times(HUNDRED.plus(dec(percent)))
      .dividedBy(HUNDRED),
  );
}

/** `quantity x unitRate`, at money scale. */
export function multiply(quantity: Numeric, unitRate: Numeric): Decimal {
  return money(dec(quantity).times(dec(unitRate)));
}

/**
 * Divide, refusing a zero denominator rather than yielding Infinity.
 * A silent Infinity here would propagate into a reported valuation.
 */
export function divide(numerator: Numeric, denominator: Numeric, scale = MONEY_SCALE): Decimal {
  const d = dec(denominator);
  if (d.isZero()) throw new MoneyError('Division by zero in a valuation calculation.');
  return dec(numerator).dividedBy(d).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

/** Weighted sum: `sum(value_i x weight_i / 100)`. Weights are percentages. */
export function weightedSum(parts: Array<{ value: Numeric; weightPercent: Numeric }>): Decimal {
  return money(
    parts.reduce<Decimal>(
      (acc, p) => acc.plus(dec(p.value).times(dec(p.weightPercent)).dividedBy(HUNDRED)),
      ZERO,
    ),
  );
}

/** True when the value is greater than or equal to zero. */
export function isNonNegative(value: Numeric): boolean {
  return dec(value).greaterThanOrEqualTo(ZERO);
}

/** Assert a value is non-negative, naming the field in the error. */
export function assertNonNegative(value: Numeric, field: string): Decimal {
  const d = dec(value);
  if (d.lessThan(ZERO)) {
    throw new MoneyError(`${field} must not be negative (received ${d.toString()}).`);
  }
  return d;
}

/** Assert a percentage lies within [0, 100]. */
export function assertPercent(value: Numeric, field: string): Decimal {
  const d = dec(value);
  if (d.lessThan(ZERO) || d.greaterThan(HUNDRED)) {
    throw new MoneyError(`${field} must be between 0 and 100 (received ${d.toString()}).`);
  }
  return d;
}

/**
 * Serialise for transport. Money crosses the wire as a string, never a JSON
 * number, so a large ETB amount cannot lose precision in a client parser.
 */
export function toMoneyString(value: Numeric): string {
  return money(value).toFixed(MONEY_SCALE);
}

/** Format for display, e.g. `1,234,567.00`. Grouping only - no currency symbol. */
export function formatAmount(value: Numeric): string {
  const parts = money(value).toFixed(MONEY_SCALE).split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1] ?? '00';
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}

const COMPACT_UNITS: readonly [Decimal, string][] = [
  [new Decimal('1e12'), 'T'],
  [new Decimal('1e9'), 'B'],
  [new Decimal('1e6'), 'M'],
  [new Decimal('1e3'), 'K'],
];

/**
 * Format for a figure tile, e.g. `1.2B`, `860.5M`, `12K`, `940`. Display only:
 * the rounding here is for reading at a glance, never for arithmetic.
 */
export function formatCompact(value: Numeric): string {
  const d = dec(value);
  for (const [size, suffix] of COMPACT_UNITS) {
    // Promote a value the unit below would round up to `1000`: 999,960 reads
    // as `1M`, not `1000K`.
    if (d.abs().greaterThanOrEqualTo(size.times('0.9995'))) {
      const scaled = d.dividedBy(size).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
      return `${scaled.toFixed(1).replace(/\.0$/, '')}${suffix}`;
    }
  }
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

/** Format with the currency code, e.g. `ETB 1,234,567.00`. */
export function formatCurrency(value: Numeric, currency = 'ETB'): string {
  return `${currency} ${formatAmount(value)}`;
}

const UNITS = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
/** Enough for the 18 whole digits a Decimal(20,2) column can hold. */
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion', 'Quadrillion'];

function groupInWords(group: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(group / 100);
  const rest = group % 100;
  if (hundreds > 0) words.push(UNITS[hundreds]!, 'Hundred');
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]!);
    if (rest % 10 > 0) words.push(UNITS[rest % 10]!);
  } else if (rest > 0) {
    words.push(UNITS[rest]!);
  }
  return words;
}

/**
 * An amount in words, as the Property Valuation Division's letters write it:
 * title case, no "and", no hyphens - 151,588,663.36 is "One Hundred Fifty One
 * Million Five Hundred Eighty Eight Thousand Six Hundred Sixty Three", with
 * the cents returned separately as the two digits of the trailing "36/100".
 */
export function amountInWords(value: Numeric): { words: string; cents: string } {
  const [whole = '0', cents = '00'] = assertNonNegative(money(value), 'Amount')
    .toFixed(MONEY_SCALE)
    .split('.');

  const groups: number[] = [];
  for (let end = whole.length; end > 0; end -= 3) {
    groups.unshift(Number(whole.slice(Math.max(0, end - 3), end)));
  }
  if (groups.length > SCALES.length) {
    throw new MoneyError(`Amount too large to write in words: ${whole}`);
  }

  const words = groups.flatMap((group, index) => {
    if (group === 0) return [];
    const scale = SCALES[groups.length - 1 - index]!;
    return scale ? [...groupInWords(group), scale] : groupInWords(group);
  });

  return { words: words.length > 0 ? words.join(' ') : 'Zero', cents };
}
