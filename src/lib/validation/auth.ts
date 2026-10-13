import { z } from 'zod';

/**
 * Authentication input schemas.
 *
 * Shared by the client form and the server action - but the server parses
 * independently rather than trusting that the client did (rule 4). The client
 * copy exists only to give immediate feedback.
 */

/**
 * Sign-in accepts an institutional email address, matching the NIB Board
 * Governance Portal. An employee ID is also accepted in the same field for
 * seeded and service accounts, so the rule is deliberately permissive here and
 * the actual lookup happens server-side.
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, 'Enter your institutional email address.')
    .max(254, 'That is too long to be an email address.'),
  password: z.string().min(1, 'Enter your password.').max(256, 'Password is too long.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    // Length is policy, and policy lives in configuration - the server checks
    // it against `security.password_min_length`. This is only a sanity bound so
    // an empty field is caught before a round trip.
    newPassword: z.string().min(1, 'Enter a new password.').max(256),
    confirmPassword: z.string().min(1, 'Confirm the new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'The new password must differ from the current one.',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Choosing a password from an emailed set-up or reset link. */
export const setPasswordSchema = z
  .object({
    token: z.string().min(1).max(100),
    newPassword: z.string().min(1, 'Enter a new password.').max(256),
    confirmPassword: z.string().min(1, 'Confirm the new password.'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your institutional email address.').max(254),
});

export const reauthenticateSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.').max(256),
});
