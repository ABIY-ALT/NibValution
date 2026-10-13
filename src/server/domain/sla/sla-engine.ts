/**
 * The SLA engine (spec section 22; assumptions 4.1-4.5).
 *
 * Pure and clock-free: the caller passes `now`, so the same record evaluates
 * the same way in a test, in the nightly sweep and on a page load.
 *
 * Time is counted in working days against the configured calendar - working
 * days of the week plus the holiday table - unless the policy says to count
 * calendar days. Days are whole UTC dates: a case requested on a Monday
 * afternoon has used one working day by Tuesday.
 *
 * A pause (the case back with the requester, assumption 4.3) stops the clock:
 * its working days are added to the due date and excluded from the net figure,
 * while the gross figure still includes them, so both are reportable and a
 * pause cannot quietly flatter the department's KPI.
 */

export interface SlaCalendar {
  /** 0 = Sunday ... 6 = Saturday. */
  readonly workingDaysOfWeek: readonly number[];
  /**
   * Holidays as YYYY-MM-DD, or MM-DD for one that falls on the same date every
   * year (Enkutatash, Meskel, Timket...), so it need not be re-entered yearly.
   */
  readonly holidays: ReadonlySet<string>;
  readonly countCalendarDays: boolean;
}

export type SlaState = 'GREEN' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'CLOSED';

const DAY_MS = 86_400_000;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);
const startOfDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export function isWorkingDay(date: Date, calendar: SlaCalendar): boolean {
  if (calendar.countCalendarDays) return true;
  return (
    calendar.workingDaysOfWeek.includes(date.getUTCDay()) &&
    !calendar.holidays.has(dayKey(date)) &&
    !calendar.holidays.has(dayKey(date).slice(5))
  );
}

/** Working days after `from`'s date, up to and including `to`'s date. */
export function workingDaysBetween(from: Date, to: Date, calendar: SlaCalendar): number {
  let day = startOfDay(from);
  const end = startOfDay(to);
  let count = 0;
  // Bounded, so a misconfigured calendar can never spin.
  for (let i = 0; i < 3660 && day < end; i += 1) {
    day = new Date(day.getTime() + DAY_MS);
    if (isWorkingDay(day, calendar)) count += 1;
  }
  return count;
}

/** The date `days` working days after `from`, keeping `from`'s time of day. */
export function addWorkingDays(from: Date, days: number, calendar: SlaCalendar): Date {
  const due = new Date(from);
  let counted = 0;
  for (let i = 0; i < 3660 && counted < days; i += 1) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (isWorkingDay(due, calendar)) counted += 1;
  }
  return due;
}

export interface SlaInput {
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly totalWorkingDays: number;
  /** "Approaching" once this share of the allowance is used (assumption 4.5). */
  readonly warningPercent: number;
  readonly pauses: readonly { pausedAt: Date; resumedAt: Date | null }[];
  readonly now: Date;
}

export interface SlaEvaluation {
  readonly state: SlaState;
  /** Working days since the clock started, pauses included. */
  readonly elapsedWorkingDays: number;
  /** The same, pauses excluded - the KPI figure. */
  readonly netWorkingDays: number;
  readonly pausedWorkingDays: number;
  readonly pausedSeconds: number;
  /** The due date moved out by the working days spent paused. */
  readonly dueAt: Date;
}

export function evaluateSla(input: SlaInput, calendar: SlaCalendar): SlaEvaluation {
  const end = input.completedAt ?? input.now;

  let pausedWorkingDays = 0;
  let pausedSeconds = 0;
  let paused = false;
  for (const pause of input.pauses) {
    const resumed = pause.resumedAt ?? end;
    if (pause.resumedAt === null && input.completedAt === null) paused = true;
    pausedWorkingDays += workingDaysBetween(pause.pausedAt, resumed, calendar);
    pausedSeconds += Math.max(0, Math.round((resumed.getTime() - pause.pausedAt.getTime()) / 1000));
  }

  const elapsedWorkingDays = workingDaysBetween(input.startedAt, end, calendar);
  const netWorkingDays = Math.max(0, elapsedWorkingDays - pausedWorkingDays);
  const dueAt = addWorkingDays(
    input.startedAt,
    input.totalWorkingDays + pausedWorkingDays,
    calendar,
  );

  let state: SlaState;
  if (input.completedAt) state = 'CLOSED';
  else if (paused) state = 'PAUSED';
  else if (input.now > dueAt) state = 'BREACHED';
  else if (netWorkingDays * 100 >= input.totalWorkingDays * input.warningPercent) state = 'WARNING';
  else state = 'GREEN';

  return { state, elapsedWorkingDays, netWorkingDays, pausedWorkingDays, pausedSeconds, dueAt };
}
