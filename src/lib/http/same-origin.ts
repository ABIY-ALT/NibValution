/**
 * Cross-site request refusal for route handlers (spec section 26, CSRF).
 *
 * Server actions get this from Next.js, which compares `Origin` with `Host`.
 * Route handlers do not, and the session cookie's `SameSite=Lax` stops other
 * *sites* but not a sibling subdomain, which counts as the same site. So a
 * state-changing route handler asks the browser where the request came from.
 *
 * Browsers send `Origin` on every POST and DELETE, and `Sec-Fetch-Site` on
 * every request. A request carrying neither did not come from a browser page,
 * so it cannot be a forged one - the cookie would have to be stolen first, and
 * then CSRF is not the problem.
 */
export function isSameOriginRequest(headers: Headers, appUrl: string): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = headers.get('origin');
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    // Includes the literal "null" a sandboxed frame or file:// page sends.
    return false;
  }

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(appUrl).host);
  } catch {
    // An unparseable APP_URL is caught by env validation; ignore it here.
  }
  // Behind a reverse proxy the public host arrives as X-Forwarded-Host.
  const forwardedHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headers.get('host');
  if (host) allowed.add(host);

  return allowed.has(originHost);
}
