import type { ConstructionStatus } from '@/server/domain/shared/enums';

/** Display names and formats for the working a signed report shows. */

export const CONSTRUCTION_LABELS: Record<ConstructionStatus, string> = {
  COMPLETED: 'Completed',
  UNDER_CONSTRUCTION: 'Under construction',
  ABANDONED: 'Abandoned',
};

export const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: 'Straight line',
  AGE_LIFE_CONDITION: 'Age-life with condition',
  DECLINING_BALANCE: 'Declining balance',
};

/** `RCC_FRAME` → `Rcc frame`; configuration keys are not written for reading. */
export function humaniseKey(key: string): string {
  if (key === 'DEFAULT') return 'Other / default';
  const words = key.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An ETB amount for display: grouped, two decimals. Display only. */
export function etb(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const [whole = '0', fraction = ''] = value.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${(fraction + '00').slice(0, 2)}`;
}

/** A stored decimal without its trailing zeros: `500.0000` → `500`. */
export function trimDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}
