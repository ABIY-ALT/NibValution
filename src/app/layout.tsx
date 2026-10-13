import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { ThemeProvider, themeBootstrapScript } from '@/context/theme-context';

/**
 * One title for every page: the browser tab always names the institution's
 * system, not the screen. Pages deliberately set no title of their own; the
 * tab icon is the NIB mark, from `app/icon.png`.
 */
export const metadata: Metadata = {
  title: 'NIB Property Valuation',
  description:
    'NIB International Bank - Property Valuation Management System for Civil and Mechanical collateral.',
  // The application handles collateral valuations; it must never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#4B2507',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The proxy's per-request CSP nonce: without it the browser refuses this
  // inline script, and the page flashes light before switching to dark.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-screen bg-app text-ink antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
