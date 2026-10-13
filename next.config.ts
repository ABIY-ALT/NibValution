import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Security headers applied to every response. Framing is denied outright -
 * this application never needs to be embedded, and denying it removes
 * clickjacking as a class of risk.
 *
 * The Content-Security-Policy is not here: it carries a fresh nonce per
 * request, so `src/proxy.ts` sets it. A static policy here would either block
 * Next.js's own inline bootstrap scripts in production (a static
 * `script-src 'self'` stops the app hydrating) or have to allow every inline
 * script, which defeats it.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the workspace root. Without it, Turbopack walks up looking for a lock
  // file and can settle on a parent directory - which on a developer machine
  // may be the user's home folder.
  turbopack: { root: path.resolve(import.meta.dirname) },
  serverExternalPackages: ['@node-rs/argon2', '@prisma/client', 'pino'],
  typedRoutes: false,
  // Set per release when more than one instance serves the application, so a
  // browser holding the previous release's pages reloads instead of calling
  // actions the new build no longer has (runbook, "Upgrading").
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
