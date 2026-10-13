import { prisma } from '@/server/infrastructure/db/client';
import { ConfigurationError } from '@/lib/errors';
import { dec, Decimal } from '@/lib/money';
import type { RoleCode } from '@/server/domain/shared/enums';
import type { ApprovalThresholdRule, FinalLetterRule } from '@/server/domain/approval/routing';

/**
 * Reads runtime configuration (spec section 37).
 *
 * Values are cached for a short TTL rather than for the process lifetime. A
 * change an administrator makes must take effect promptly - a threshold that
 * only applies after a restart is not really configurable - but re-reading the
 * table on every calculation would be wasteful at 40 concurrent users. Thirty
 * seconds is the compromise; the cache is cleared explicitly whenever the admin
 * UI writes, so in practice a change is visible immediately on the instance
 * that made it.
 */

const CACHE_TTL_MS = 30_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T): T {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Invalidate the cache. Called by every administrative write. */
export function invalidateConfigurationCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

// ---------------------------------------------------------------------------
// System configuration values
// ---------------------------------------------------------------------------

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const cached = getCached<T>(`config:${key}`);
  if (cached !== undefined) return cached;

  const row = await prisma.systemConfiguration.findUnique({ where: { key } });
  if (!row) return setCached(`config:${key}`, fallback);
  return setCached(`config:${key}`, row.value as T);
}

export async function getNumberConfig(key: string, fallback: number): Promise<number> {
  const value = await getConfig<unknown>(key, fallback);
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getStringConfig(key: string, fallback: string): Promise<string> {
  const value = await getConfig<unknown>(key, fallback);
  return typeof value === 'string' ? value : fallback;
}

export async function getArrayConfig(key: string, fallback: string[]): Promise<string[]> {
  const value = await getConfig<unknown>(key, fallback);
  return Array.isArray(value) ? value.map(String) : fallback;
}

// ---------------------------------------------------------------------------
// Approval thresholds (spec section 17)
// ---------------------------------------------------------------------------

export async function loadApprovalThresholds(): Promise<ApprovalThresholdRule[]> {
  const cached = getCached<ApprovalThresholdRule[]>('approval-thresholds');
  if (cached) return cached;

  const rows = await prisma.approvalThreshold.findMany({
    where: { isActive: true },
    orderBy: { minAmount: 'asc' },
  });

  if (rows.length === 0) {
    throw new ConfigurationError(
      'No approval thresholds are configured. Valuation cases cannot be routed for approval.',
    );
  }

  const rules: ApprovalThresholdRule[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    minAmount: dec(row.minAmount.toString()),
    maxAmount: row.maxAmount === null ? null : dec(row.maxAmount.toString()),
    approvalChain: parseRoleChain(row.approvalChain, row.name),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));

  return setCached('approval-thresholds', rules);
}

function parseRoleChain(value: unknown, ruleName: string): RoleCode[] {
  if (!Array.isArray(value)) {
    throw new ConfigurationError(
      `Approval threshold "${ruleName}" has a malformed approval chain; an ordered array of role codes is required.`,
    );
  }
  return value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new ConfigurationError(
        `Approval threshold "${ruleName}" contains a non-string entry in its approval chain.`,
      );
    }
    return entry as RoleCode;
  });
}

export async function loadFinalLetterRules(): Promise<FinalLetterRule[]> {
  const cached = getCached<FinalLetterRule[]>('final-letter-rules');
  if (cached) return cached;

  const rows = await prisma.finalLetterAuthority.findMany({
    where: { isActive: true },
    orderBy: { minAmount: 'asc' },
  });

  if (rows.length === 0) {
    throw new ConfigurationError(
      'No final-letter authority is configured. Completed cases cannot be issued.',
    );
  }

  const rules: FinalLetterRule[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    minAmount: dec(row.minAmount.toString()),
    maxAmount: row.maxAmount === null ? null : dec(row.maxAmount.toString()),
    issuerRole: row.issuerRole as RoleCode,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  }));

  return setCached('final-letter-rules', rules);
}

// ---------------------------------------------------------------------------
// Valuation parameters (spec sections 9-13)
// ---------------------------------------------------------------------------

export interface ParameterSnapshot {
  setId: string;
  setCode: string;
  setVersion: number;
  values: Record<string, string>;
  tables: Record<string, unknown>;
}

/**
 * Load the parameter set in force at a given date.
 *
 * A valuation records the set it used, so a historical figure stays
 * reproducible after the parameters change (spec section 28). Passing a date
 * rather than always taking "current" is what makes that recomputation possible.
 */
export async function loadParameterSnapshot(at: Date = new Date()): Promise<ParameterSnapshot> {
  const cacheKey = `parameters:${at.toISOString().slice(0, 10)}`;
  const cached = getCached<ParameterSnapshot>(cacheKey);
  if (cached) return cached;

  const set = await prisma.valuationParameterSet.findFirst({
    where: {
      isActive: true,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    include: { parameters: true },
  });

  if (!set) {
    throw new ConfigurationError(
      `No valuation parameter set is in force at ${at.toISOString()}. Calculations cannot proceed.`,
    );
  }

  const values: Record<string, string> = {};
  const tables: Record<string, unknown> = {};

  for (const parameter of set.parameters) {
    if (parameter.numericValue !== null) {
      values[parameter.key] = parameter.numericValue.toString();
    }
    if (parameter.jsonValue !== null && parameter.jsonValue !== undefined) {
      tables[parameter.key] = parameter.jsonValue;
    }
  }

  const snapshot: ParameterSnapshot = {
    setId: set.id,
    setCode: set.code,
    setVersion: set.version,
    values,
    tables,
  };

  return setCached(cacheKey, snapshot);
}

/** Read a numeric parameter, failing loudly rather than defaulting silently. */
export function requireParameter(snapshot: ParameterSnapshot, key: string): Decimal {
  const raw = snapshot.values[key];
  if (raw === undefined) {
    throw new ConfigurationError(
      `Valuation parameter "${key}" is not defined in parameter set ${snapshot.setCode} v${snapshot.setVersion}.`,
    );
  }
  return dec(raw);
}

/** Read a numeric parameter with an explicit fallback. */
export function parameterOr(snapshot: ParameterSnapshot, key: string, fallback: string): Decimal {
  const raw = snapshot.values[key];
  return dec(raw ?? fallback);
}

export function requireTable<T>(snapshot: ParameterSnapshot, key: string): T {
  const table = snapshot.tables[key];
  if (table === undefined) {
    throw new ConfigurationError(
      `Valuation parameter table "${key}" is not defined in parameter set ${snapshot.setCode} v${snapshot.setVersion}.`,
    );
  }
  return table as T;
}

// ---------------------------------------------------------------------------
// SLA policy (spec section 22)
// ---------------------------------------------------------------------------

export interface SlaPolicyConfig {
  id: string;
  code: string;
  name: string;
  totalWorkingDays: number;
  warningPercent: number;
  stageBudgets: Record<string, number>;
  workingDaysOfWeek: number[];
  countCalendarDays: boolean;
}

export async function loadSlaPolicy(code = 'STANDARD'): Promise<SlaPolicyConfig> {
  const cached = getCached<SlaPolicyConfig>(`sla:${code}`);
  if (cached) return cached;

  const policy = await prisma.slaPolicy.findUnique({ where: { code } });
  if (!policy || !policy.isActive) {
    throw new ConfigurationError(`SLA policy "${code}" is not configured or is inactive.`);
  }

  const config: SlaPolicyConfig = {
    id: policy.id,
    code: policy.code,
    name: policy.name,
    totalWorkingDays: policy.totalWorkingDays,
    warningPercent: policy.warningPercent,
    stageBudgets: (policy.stageBudgets as Record<string, number> | null) ?? {},
    workingDaysOfWeek: (policy.workingDaysOfWeek as number[] | null) ?? [1, 2, 3, 4, 5],
    countCalendarDays: policy.countCalendarDays,
  };

  return setCached(`sla:${code}`, config);
}

export interface HolidayConfig {
  date: Date;
  /** Falls on the same date every year; only its month and day matter. */
  isRecurring: boolean;
}

export async function loadHolidays(): Promise<HolidayConfig[]> {
  const cached = getCached<HolidayConfig[]>('holidays');
  if (cached) return cached;

  const rows = await prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  return setCached(
    'holidays',
    rows.map((row) => ({ date: row.date, isRecurring: row.isRecurring })),
  );
}
