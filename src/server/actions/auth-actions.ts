'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { changePassword, login, logout } from '@/server/application/auth-service';
import { getRequestContext, getSession } from '@/server/application/actor';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/server/infrastructure/auth/session';
import { changePasswordSchema, loginSchema } from '@/lib/validation/auth';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Authentication server actions.
 *
 * Failures are returned as form state rather than thrown, so the page can
 * re-render with a message. What is *not* returned is any detail that would
 * distinguish an unknown employee ID from a wrong password or a locked account:
 * the service layer collapses those into one message, and this layer does not
 * undo that.
 */

export type FormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

function collectFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get('identifier'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const context = await getRequestContext();

  let mustChangePassword = false;
  try {
    const result = await login(parsed.data.identifier, parsed.data.password, context);
    mustChangePassword = result.mustChangePassword;

    const cookieStore = await cookies();
    const maxAge = Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000);
    const options = sessionCookieOptions(result.session.token, maxAge);
    cookieStore.set(options.name, options.value, {
      httpOnly: options.httpOnly,
      secure: options.secure,
      sameSite: options.sameSite,
      path: options.path,
      maxAge: options.maxAge,
    });
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, message: error.safeDetail ?? error.message };
    }
    logger.error({ err: error, correlationId: context.correlationId }, 'Unexpected login failure');
    return { ok: false, message: 'Sign-in is temporarily unavailable. Please try again.' };
  }

  // redirect() signals by throwing, so it must sit outside the try/catch above
  // or it would be caught and reported as a login failure.
  redirect(mustChangePassword ? '/change-password?required=1' : '/dashboard');
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  const context = await getRequestContext();

  if (session) {
    await logout(session.sessionId, session.actor.id, context);
  }

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);

  redirect('/login');
}

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) {
    return { ok: false, message: 'Your session has expired. Please sign in again.' };
  }

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Please correct the highlighted fields.',
      fieldErrors: collectFieldErrors(parsed.error.issues),
    };
  }

  const context = await getRequestContext();

  try {
    await changePassword(
      session.actor.id,
      session.sessionId,
      parsed.data.currentPassword,
      parsed.data.newPassword,
      context,
    );
  } catch (error) {
    if (isAppError(error)) {
      const fieldErrors =
        'fieldErrors' in error && error.fieldErrors
          ? (error.fieldErrors as Record<string, string[]>)
          : undefined;
      return { ok: false, message: error.safeDetail ?? error.message, fieldErrors };
    }
    logger.error({ err: error, correlationId: context.correlationId }, 'Password change failed');
    return { ok: false, message: 'The password could not be changed. Please try again.' };
  }

  redirect('/dashboard?password-changed=1');
}
