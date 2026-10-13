import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  evaluateSla,
  workingDaysBetween,
  type SlaCalendar,
} from '@/server/domain/sla/sla-engine';

/**
 * September 2026: the 1st is a Tuesday. Working days Monday-Friday, with a
 * holiday on Friday the 11th (Ethiopian New Year falls on 11 September).
 */
const CALENDAR: SlaCalendar = {
  workingDaysOfWeek: [1, 2, 3, 4, 5],
  holidays: new Set(['2026-09-11']),
  countCalendarDays: false,
};
const at = (day: number, hour = 9) => new Date(Date.UTC(2026, 8, day, hour));

describe('working-day arithmetic', () => {
  it('skips weekends and holidays', () => {
    // Mon 7 -> Mon 14: Tue 8, Wed 9, Thu 10, (Fri 11 holiday), Mon 14
    expect(workingDaysBetween(at(7), at(14), CALENDAR)).toBe(4);
  });

  it('adds working days, stepping over a holiday and a weekend', () => {
    // 5 working days from Mon 7: 8, 9, 10, 14, 15 -> Tue 15
    expect(addWorkingDays(at(7), 5, CALENDAR).toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('skips a recurring holiday in any year', () => {
    // Meskel, 27 September, entered once as a recurring holiday. In 2027 it
    // falls on a Monday: Fri 24 -> Tue 28 is then one working day, not two.
    const meskel = { ...CALENDAR, holidays: new Set(['09-27']) };
    const friday = new Date('2027-09-24T09:00:00Z');
    const tuesday = new Date('2027-09-28T09:00:00Z');
    expect(workingDaysBetween(friday, tuesday, meskel)).toBe(1);
    expect(workingDaysBetween(friday, tuesday, CALENDAR)).toBe(2);
  });

  it('counts calendar days when the policy says so', () => {
    expect(workingDaysBetween(at(7), at(14), { ...CALENDAR, countCalendarDays: true })).toBe(7);
  });
});

describe('SLA states', () => {
  const base = {
    startedAt: at(7),
    completedAt: null,
    totalWorkingDays: 5,
    warningPercent: 80,
    pauses: [],
  };

  it('is green early on', () => {
    const result = evaluateSla({ ...base, now: at(8) }, CALENDAR);
    expect(result.state).toBe('GREEN');
    expect(result.netWorkingDays).toBe(1);
  });

  it('warns once 80% of the allowance is used', () => {
    // Four working days used of five.
    const result = evaluateSla({ ...base, now: at(14) }, CALENDAR);
    expect(result.state).toBe('WARNING');
  });

  it('breaches after the due date', () => {
    const result = evaluateSla({ ...base, now: at(16) }, CALENDAR);
    expect(result.state).toBe('BREACHED');
    expect(result.dueAt.toISOString().slice(0, 10)).toBe('2026-09-15');
  });

  it('pauses the clock and moves the due date out by the paused working days', () => {
    const result = evaluateSla(
      {
        ...base,
        // Back with the requester Tue 8 to Thu 10: two working days.
        pauses: [{ pausedAt: at(8), resumedAt: at(10) }],
        now: at(16),
      },
      CALENDAR,
    );
    expect(result.pausedWorkingDays).toBe(2);
    expect(result.elapsedWorkingDays).toBe(6);
    expect(result.netWorkingDays).toBe(4);
    // Seven working days from Mon 7: 8, 9, 10, 14, 15, 16, 17 -> Thu 17.
    expect(result.dueAt.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(result.state).toBe('WARNING');
  });

  it('reads as paused while a pause is open', () => {
    const result = evaluateSla(
      { ...base, pauses: [{ pausedAt: at(8), resumedAt: null }], now: at(21) },
      CALENDAR,
    );
    expect(result.state).toBe('PAUSED');
  });

  it('closes when the case completes', () => {
    const result = evaluateSla({ ...base, completedAt: at(9), now: at(30) }, CALENDAR);
    expect(result.state).toBe('CLOSED');
    expect(result.elapsedWorkingDays).toBe(2);
  });
});
