import { describe, expect, it } from 'vitest';
import { publishParameterSchema } from '@/lib/validation/parameters';
import {
  formatNumericParameter,
  humanizeEntry,
  isUnconfirmed,
  tableEntries,
} from '@/lib/parameters';

const base = {
  setCode: 'DEFAULT',
  key: 'forced_sale.percent',
  name: 'Forced-sale percentage',
  type: 'PERCENT',
  numericValue: '75',
  table: [],
  discipline: 'ALL',
  effectiveFrom: '2026-10-01',
  reason: 'Confirmed by PVD',
};

function errorsOf(input: Record<string, unknown>) {
  const parsed = publishParameterSchema.safeParse(input);
  return parsed.success ? {} : (parsed.error.flatten().fieldErrors as Record<string, string[]>);
}

describe('publishing a parameter - schema', () => {
  it('accepts a valid percentage and maps "All properties" to no discipline', () => {
    const parsed = publishParameterSchema.parse(base);
    expect(parsed.numericValue).toBe('75');
    expect(parsed.discipline).toBeNull();
    expect(parsed.table).toEqual([]);
  });

  it('lower-cases the key and rejects one that is not dotted words', () => {
    expect(publishParameterSchema.parse({ ...base, key: 'Forced_Sale.Percent' }).key).toBe(
      'forced_sale.percent',
    );
    expect(errorsOf({ ...base, key: 'forced sale' }).key).toBeDefined();
    expect(errorsOf({ ...base, key: 'nodot' }).key).toBeDefined();
  });

  it('keeps percentages between 0 and 100 and factors above zero', () => {
    expect(errorsOf({ ...base, numericValue: '101' }).numericValue).toBeDefined();
    expect(errorsOf({ ...base, type: 'FACTOR', numericValue: '0' }).numericValue).toBeDefined();
    expect(errorsOf({ ...base, numericValue: '1,5' }).numericValue).toBeDefined();
    expect(errorsOf({ ...base, numericValue: '0.1234567' }).numericValue).toBeDefined();
  });

  it('requires table rows with unique, well-formed entry names and a value each', () => {
    const table = { ...base, type: 'TABLE', numericValue: '' };
    expect(errorsOf({ ...table, table: [] }).table).toBeDefined();
    expect(errorsOf({ ...table, table: [{ entry: '1ABC', value: '1' }] }).table).toBeDefined();
    expect(
      errorsOf({
        ...table,
        table: [
          { entry: 'A', value: '1' },
          { entry: 'A', value: '2' },
        ],
      }).table,
    ).toBeDefined();
    expect(errorsOf({ ...table, table: [{ entry: 'A', value: '' }] }).table).toBeDefined();

    const parsed = publishParameterSchema.parse({
      ...table,
      table: [
        { entry: 'RCC_FRAME', value: '60' },
        { entry: '', value: '' },
      ],
    });
    // Blank trailing rows are dropped, and a table carries no single figure.
    expect(parsed.table).toEqual([{ entry: 'RCC_FRAME', value: '60' }]);
    expect(parsed.numericValue).toBeNull();
  });

  it('requires a reason and a date', () => {
    expect(errorsOf({ ...base, reason: '' }).reason).toBeDefined();
    expect(errorsOf({ ...base, effectiveFrom: '' }).effectiveFrom).toBeDefined();
  });
});

describe('parameter display', () => {
  it('formats a figure with the unit its type implies', () => {
    expect(formatNumericParameter('PERCENT', '75', '%')).toBe('75%');
    expect(formatNumericParameter('FACTOR', '1', null)).toBe('× 1');
    expect(formatNumericParameter('YEARS', '50', null)).toBe('50 years');
    expect(formatNumericParameter('RATE', '1200', 'ETB/m²')).toBe('1200 ETB/m²');
  });

  it('reads table entry names as words, keeping short acronyms', () => {
    expect(humanizeEntry('RCC_FRAME')).toBe('RCC frame');
    expect(humanizeEntry('includeUnpaidLeaseBalance')).toBe('Include unpaid lease balance');
    expect(humanizeEntry('DUTY_PERCENT')).toBe('Duty percent');
  });

  it('lists DEFAULT last', () => {
    expect(tableEntries({ DEFAULT: 50, MASONRY: 50, TIMBER: 25 }).map((e) => e.entry)).toEqual([
      'MASONRY',
      'TIMBER',
      'DEFAULT',
    ]);
  });

  it('flags provisional notes', () => {
    expect(isUnconfirmed('UNCONFIRMED. The source names MCF…')).toBe(true);
    expect(isUnconfirmed('Awaiting PVD confirmation (assumption 3.2).')).toBe(true);
    expect(isUnconfirmed('Depreciation never goes below this floor.')).toBe(false);
    expect(isUnconfirmed(null)).toBe(false);
  });
});
