import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import proxy from '@/proxy';
import { isSameOriginRequest } from '@/lib/http/same-origin';
import { clientIpFrom } from '@/lib/http/client-ip';
import { NotFoundError, assertUuid } from '@/lib/errors';

/**
 * Request-level hardening (roadmap Phase 8, spec section 26): the page policy,
 * the correlation id, cross-site refusal for route handlers, and malformed ids.
 */

const APP_URL = 'https://valuation.nibbank.example';

function request(path: string, headers: Record<string, string> = {}, withSession = true) {
  return new NextRequest(`${APP_URL}${path}`, {
    headers: { ...headers, ...(withSession ? { cookie: 'nib_session=token' } : {}) },
  });
}

describe('content security policy', () => {
  it('gives every page a fresh nonce and allows no other inline script', () => {
    const first = proxy(request('/dashboard')).headers.get('content-security-policy') ?? '';
    const second = proxy(request('/dashboard')).headers.get('content-security-policy') ?? '';

    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(first)?.[1];
    expect(nonce).toBeDefined();
    expect(nonce!.length).toBeGreaterThanOrEqual(22);
    expect(second).not.toContain(nonce!);

    const scriptSrc = first.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(first).toContain("frame-ancestors 'none'");
    expect(first).toContain("object-src 'none'");
    expect(first).toContain("base-uri 'self'");
  });

  it('passes the nonce to the renderer so Next.js can stamp its own scripts', () => {
    // NextResponse.next({ request }) forwards overridden request headers as
    // x-middleware-request-* response headers.
    const response = proxy(request('/requests'));
    const policy = response.headers.get('content-security-policy') ?? '';
    const forwardedNonce = response.headers.get('x-middleware-request-x-nonce');
    expect(forwardedNonce).toBeTruthy();
    expect(policy).toContain(`'nonce-${forwardedNonce}'`);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });

  it('leaves API responses to set their own policy', () => {
    const response = proxy(request('/api/documents/upload'));
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});

describe('correlation id', () => {
  it('keeps a well-formed id from the caller', () => {
    const response = proxy(request('/dashboard', { 'x-correlation-id': 'lb-2f9c1e7a-0001' }));
    expect(response.headers.get('x-correlation-id')).toBe('lb-2f9c1e7a-0001');
  });

  it.each([
    'bad<script>alert(1)</script>',
    'id with spaces; and=semicolons',
    'x'.repeat(200),
    'short',
  ])('replaces a malformed one rather than writing it to the audit log: %s', (offered) => {
    const response = proxy(request('/dashboard', { 'x-correlation-id': offered }));
    const id = response.headers.get('x-correlation-id') ?? '';
    expect(id).not.toBe(offered);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('sign-in redirect', () => {
  it('sends a visitor without a session to the login page, remembering only a local path', () => {
    const response = proxy(request('/requests/abc?tab=docs', {}, false));
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/login');
    expect(location.origin).toBe(APP_URL);
    expect(location.searchParams.get('next')).toBe('/requests/abc?tab=docs');
  });

  it('lets the health check and the scheduler through without a session', () => {
    for (const path of ['/api/health', '/api/cron/sla', '/api/cron/maintenance']) {
      expect(proxy(request(path, {}, false)).headers.get('location')).toBeNull();
    }
  });
});

describe('cross-site requests to route handlers', () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it('accepts the application itself', () => {
    expect(
      isSameOriginRequest(
        headers({
          origin: APP_URL,
          host: 'valuation.nibbank.example',
          'sec-fetch-site': 'same-origin',
        }),
        APP_URL,
      ),
    ).toBe(true);
  });

  it('accepts the public host a reverse proxy forwards', () => {
    expect(
      isSameOriginRequest(
        headers({
          origin: 'https://valuation.nibbank.example',
          host: '10.0.4.12:3000',
          'x-forwarded-host': 'valuation.nibbank.example',
        }),
        'http://10.0.4.12:3000',
      ),
    ).toBe(true);
  });

  it('refuses another site and a sibling subdomain', () => {
    for (const origin of ['https://evil.example', 'https://intranet.nibbank.example']) {
      expect(
        isSameOriginRequest(headers({ origin, host: 'valuation.nibbank.example' }), APP_URL),
      ).toBe(false);
    }
  });

  it('refuses what the browser itself labels cross-site, and the opaque "null" origin', () => {
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'cross-site' }), APP_URL)).toBe(false);
    expect(isSameOriginRequest(headers({ 'sec-fetch-site': 'same-site' }), APP_URL)).toBe(false);
    expect(
      isSameOriginRequest(headers({ origin: 'null', host: 'valuation.nibbank.example' }), APP_URL),
    ).toBe(false);
  });

  it('allows a non-browser client, which cannot be the vehicle of a forged request', () => {
    expect(isSameOriginRequest(headers({ host: 'valuation.nibbank.example' }), APP_URL)).toBe(true);
  });
});

describe('ids taken from URLs', () => {
  it('passes a UUID through', () => {
    expect(() => assertUuid('0b6f3a52-7c1e-4d8a-9f10-2a3b4c5d6e7f')).not.toThrow();
  });

  it.each(['', 'abc', '1 OR 1=1', '../../etc/passwd', '0b6f3a52-7c1e-4d8a-9f10-2a3b4c5d6e7'])(
    'answers "not found" for %j rather than reaching the database',
    (value) => {
      expect(() => assertUuid(value)).toThrow(NotFoundError);
    },
  );
});

describe('client address', () => {
  const h = (value: Record<string, string>) => new Headers(value);

  it('believes only the entry our proxy appended, not what the client wrote', () => {
    // The client sent "1.2.3.4"; nginx appended the address it really saw.
    const headers = h({ 'x-forwarded-for': '1.2.3.4, 10.20.30.40' });
    expect(clientIpFrom(headers, 1)).toBe('10.20.30.40');
  });

  it('counts back one entry per trusted proxy', () => {
    const headers = h({ 'x-forwarded-for': 'spoofed, 10.20.30.40, 172.16.0.2' });
    expect(clientIpFrom(headers, 2)).toBe('10.20.30.40');
  });

  it('reads the socket address Next.js fills in when there is no proxy', () => {
    expect(clientIpFrom(h({ 'x-forwarded-for': '::ffff:127.0.0.1' }), 1)).toBe('127.0.0.1');
  });

  it('falls back to X-Real-IP, and to nothing', () => {
    expect(clientIpFrom(h({ 'x-real-ip': '10.1.1.1' }), 1)).toBe('10.1.1.1');
    expect(clientIpFrom(h({}), 1)).toBeNull();
  });
});
