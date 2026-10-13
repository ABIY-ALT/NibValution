import { z } from 'zod';

/**
 * SLA configuration (spec section 22; `sla:config`).
 *
 * Shared with the admin form so an impossible value is caught before a round
 * trip; the server parses again rather than trusting that the client did.
 */

/** 0 = Sunday ... 6 = Saturday, as the engine and `Date#getUTCDay` count them. */
export const WEEKDAYS = [
  { day: 1, short: 'Mon', label: 'Monday' },
  { day: 2, short: 'Tue', label: 'Tuesday' },
  { day: 3, short: 'Wed', label: 'Wednesday' },
  { day: 4, short: 'Thu', label: 'Thursday' },
  { day: 5, short: 'Fri', label: 'Friday' },
  { day: 6, short: 'Sat', label: 'Saturday' },
  { day: 0, short: 'Sun', label: 'Sunday' },
] as const;

export const slaPolicySchema = z.object({
  totalWorkingDays: z.coerce
    .number()
    .int('Enter a whole number of days.')
    .min(1, 'The allowance must be at least one day.')
    .max(60, 'The allowance cannot exceed 60 days.'),
  warningPercent: z.coerce
    .number()
    .int('Enter a whole percentage.')
    .min(50, 'The warning point must be at least 50% of the allowance.')
    .max(95, 'The warning point must leave some time before the breach (95% at most).'),
  workingDaysOfWeek: z
    .array(z.coerce.number().int().min(0).max(6))
    .min(1, 'Choose at least one working day.')
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  countCalendarDays: z.boolean(),
});

export type SlaPolicyInput = z.infer<typeof slaPolicySchema>;

export const holidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.')
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()), {
      message: 'Choose a valid date.',
    }),
  name: z
    .string()
    .trim()
    .min(2, 'Enter the holiday name.')
    .max(80, 'The name must be 80 characters or fewer.'),
  isRecurring: z.boolean(),
});

export type HolidayInput = z.infer<typeof holidaySchema>;
