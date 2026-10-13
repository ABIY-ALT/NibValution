/**
 * The caller's address, for the audit trail and the sign-in limiter.
 *
 * Each proxy *appends* the address it received the request from to
 * X-Forwarded-For, so only the entries our own proxies added can be believed -
 * and they are at the right-hand end. Everything to their left is whatever the
 * client chose to send. Reading the first entry, as this code once did, let
 * any caller write a fictitious address into the audit log and slip past the
 * per-address sign-in limit by changing it on every attempt.
 *
 * `trustedHops` is the number of proxies in front of the application that
 * append to the header (TRUSTED_PROXY_HOPS; one reverse proxy is 1). With no
 * proxy at all Next.js itself fills the header from the socket when it is
 * absent, so 1 is also right for a developer machine.
 */
export function clientIpFrom(headers: Headers, trustedHops: number): string | null {
  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (forwarded && forwarded.length > 0 && trustedHops > 0) {
    // With more entries than trusted proxies the client prepended some; with
    // fewer, the request bypassed a proxy - take the leftmost we have.
    const index = Math.max(0, forwarded.length - trustedHops);
    return normalise(forwarded[index]!);
  }

  const realIp = headers.get('x-real-ip')?.trim();
  return realIp ? normalise(realIp) : null;
}

/** Strip an IPv4-mapped IPv6 prefix, so one client does not appear as two. */
function normalise(address: string): string {
  const value = address.startsWith('::ffff:') ? address.slice(7) : address;
  return value.slice(0, 64);
}
