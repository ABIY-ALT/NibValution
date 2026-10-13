import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy (formerly 'middleware'): the Content-Security-Policy, correlation
 * ids and a cheap first gate.
 *
 * This is **not** the authorisation boundary. It cannot be - the session store
 * and permission tables live in PostgreSQL. All it does is bounce requests that
 * carry no session cookie at all, saving a render, and stamp a correlation id
 * onto every request so logs and audit records can be tied together.
 *
 * Real authentication happens in `requireActor()` and real authorisation in
 * `authorize()`, both of which run on every protected server action and route
 * handler regardless of what this file decides.
 */

const SESSION_COOKIE_NAME = 'nib_session';

// /api/cron authenticates with its own bearer token, not a session.
const PUBLIC_PATHS = ['/login', '/api/health', '/api/cron'];

/** A caller-supplied correlation id is kept only if it looks like one. */
const CORRELATION_ID = /^[A-Za-z0-9._-]{8,64}$/;

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The page policy (spec section 26). Scripts run only with this request's
 * nonce - Next.js reads it from the request header and stamps it on its own
 * bootstrap scripts - and whatever those scripts load ('strict-dynamic'), so an
 * injected `<script>` cannot run. Styles keep 'unsafe-inline' because
 * component libraries set style attributes, which a nonce cannot cover.
 */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === 'development';
  return [
    "default-src 'self'",
    // React uses eval only in development, to rebuild server error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // An incoming id is echoed into logs and the audit trail, so anything that
  // is not a plain token is replaced rather than trusted.
  const offered = request.headers.get('x-correlation-id');
  const correlationId = offered && CORRELATION_ID.test(offered) ? offered : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-correlation-id', correlationId);

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie && !isPublic(pathname)) {
    const loginUrl = new URL('/login', request.url);
    // Preserve the intended destination so the user lands where they meant to
    // go after signing in - but only same-origin paths, never an absolute URL
    // supplied by a caller, which would make this an open redirect.
    if (pathname !== '/' && pathname.startsWith('/') && !pathname.startsWith('//')) {
      loginUrl.searchParams.set('next', `${pathname}${search}`);
    }
    const response = NextResponse.redirect(loginUrl);
    response.headers.set('x-correlation-id', correlationId);
    return response;
  }

  // API responses are data, not pages; the document routes set their own,
  // stricter policy ("default-src 'none'; sandbox").
  const isPage = !pathname.startsWith('/api/');
  let policy: string | null = null;
  if (isPage) {
    const nonce = createNonce();
    policy = contentSecurityPolicy(nonce);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', policy);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('x-correlation-id', correlationId);
  if (policy) response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
