import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { UnauthenticatedError } from '@/lib/errors';
import { newCorrelationId } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import { clientIpFrom } from '@/lib/http/client-ip';
import type { Actor } from '@/server/domain/rbac/authorize';
import {
  SESSION_COOKIE_NAME,
  resolveSession,
  type ResolvedSession,
} from '@/server/infrastructure/auth/session';

/**
 * Resolving the caller for a request.
 *
 * `cache()` memoises for the lifetime of one request, so a page that renders
 * six server components does one session lookup rather than six - while a
 * permission revoked mid-session still takes effect on the *next* request
 * rather than at next login.
 */

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string;
}

export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const headerList = await headers();
  // Only the entries our own proxies appended are believed; see clientIpFrom.
  const ipAddress = clientIpFrom(headerList, serverEnv.TRUSTED_PROXY_HOPS);

  return {
    ipAddress,
    userAgent: headerList.get('user-agent'),
    // The proxy has already replaced any malformed caller-supplied id.
    correlationId: headerList.get('x-correlation-id') ?? newCorrelationId(),
  };
});

export const getSession = cache(async (): Promise<ResolvedSession | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return resolveSession(token);
});

/** The current actor, or `null` when unauthenticated. */
export async function getActor(): Promise<Actor | null> {
  const session = await getSession();
  return session?.actor ?? null;
}

/**
 * The current actor, or a thrown `UnauthenticatedError`.
 *
 * Every protected server action and route handler starts here. It throws rather
 * than redirecting so that a forgotten call is a failure, not a page that
 * quietly renders with no user.
 */
export async function requireActor(): Promise<Actor> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session.actor;
}

/** The actor together with the session, for operations that need signing state. */
export async function requireSession(): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}
