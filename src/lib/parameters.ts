import type { ParameterType } from '@/server/domain/shared/enums';

/**
 * How valuation parameters read on screen.
 *
 * Shared by the parameters page and its publish dialog, so a percentage looks
 * the same in the register as it does in the form that changes it. Display
 * only: the engine reads the stored values, never these strings.
 */

export const PARAMETER_TYPE_INFO: Record<ParameterType, { label: string; blurb: string }> = {
  PERCENT: { label: 'Percentage', blurb: 'A share of a figure, from 0 to 100 — e.g. 75%.' },
  FACTOR: { label: 'Factor', blurb: 'A multiplier applied to a figure. 1 means no change.' },
  RATE: { label: 'Rate', blurb: 'A price per unit, such as ETB per square metre.' },
  AMOUNT: { label: 'Amount', blurb: 'A fixed sum of money.' },
  YEARS: { label: 'Years', blurb: 'A length of time, such as an economic life.' },
  TABLE: {
    label: 'Table',
    blurb: 'One value per category — e.g. economic life for each construction type.',
  },
};

/**
 * The areas a key's first segment names, with what each governs. A key whose
 * prefix is not listed still groups under a readable form of that prefix.
 */
const AREAS: Record<string, { title: string; blurb: string; order: number }> = {
  reconciliation: {
    title: 'Reconciliation',
    blurb: 'How the cost and sales approaches are weighted into one market value.',
    order: 1,
  },
  cost_approach: {
    title: 'Cost approach',
    blurb: 'Adjustments applied to the replacement-cost figure.',
    order: 2,
  },
  depreciation: {
    title: 'Depreciation',
    blurb: 'How age and condition reduce a property’s value.',
    order: 3,
  },
  construction: {
    title: 'Construction progress',
    blurb: 'How complete a property under construction is judged to be.',
    order: 4,
  },
  land: { title: 'Land', blurb: 'How land held on lease is valued.', order: 5 },
  mechanical: {
    title: 'Vehicles & machinery',
    blurb: 'Import loadings and economic life for mechanical items.',
    order: 6,
  },
  forced_sale: {
    title: 'Forced sale',
    blurb: 'The value used when a property must be sold quickly, e.g. on foreclosure.',
    order: 7,
  },
  excel_fixes: {
    title: 'Workbook corrections',
    blurb:
      'Known issues in the Excel estimation template. Each is corrected only when switched on here.',
    order: 8,
  },
  guideline: {
    title: 'Valuation guideline tables',
    blurb:
      'Rates, factors and lists from the guideline, read by the civil engine. Published with a guideline release.',
    order: 9,
  },
};

/**
 * A guideline reference table: a `guideline.*` parameter, published whole by a
 * guideline release. The register lists it but does not open it for editing.
 */
export function isGuidelineTable(key: string): boolean {
  return key.startsWith('guideline.');
}

export function parameterArea(key: string): {
  id: string;
  title: string;
  blurb: string | null;
  order: number;
} {
  const id = key.split('.')[0] ?? key;
  const known = AREAS[id];
  return known ? { id, ...known } : { id, title: humanizeEntry(id), blurb: null, order: 99 };
}

/** A parameter whose note says it awaits PVD confirmation is flagged in the UI. */
export function isUnconfirmed(notes: string | null | undefined): boolean {
  if (!notes) return false;
  return /UNCONFIRMED|Awaiting PVD|open question|assumption/i.test(notes);
}

/**
 * `RCC_FRAME` → `RCC frame`; `includeUnpaidLeaseBalance` → `Include unpaid
 * lease balance`. Short all-capital words are kept as acronyms.
 */
export function humanizeEntry(code: string): string {
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_.\s-]+/)
    .filter(Boolean)
    .map((word) =>
      word.length <= 3 && word === word.toUpperCase() && /[A-Z]/.test(word)
        ? word
        : word.toLowerCase(),
    );
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** A table cell as a reader sees it: yes/no for flags, words for codes. */
export function formatTableValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return /^-?\d+(\.\d+)?$/.test(value) ? value : humanizeEntry(value);
  }
  return JSON.stringify(value);
}

/** Entries of a keyed table in stored order, with the DEFAULT fallback last. */
export function tableEntries(value: unknown): { entry: string; value: unknown }[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const entries = Object.entries(value as Record<string, unknown>).map(([entry, v]) => ({
    entry,
    value: v,
  }));
  return [
    ...entries.filter((e) => e.entry !== 'DEFAULT'),
    ...entries.filter((e) => e.entry === 'DEFAULT'),
  ];
}

/** A single figure with the unit its type implies, e.g. `75%`, `× 1`, `50 years`. */
export function formatNumericParameter(
  type: ParameterType,
  value: string,
  unit: string | null | undefined,
): string {
  switch (type) {
    case 'PERCENT':
      return `${value}%`;
    case 'FACTOR':
      return `× ${value}`;
    case 'YEARS':
      return `${value} ${value === '1' ? 'year' : 'years'}`;
    case 'AMOUNT':
      return `${unit || 'ETB'} ${Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
    default:
      return unit ? `${value} ${unit}` : value;
  }
}
