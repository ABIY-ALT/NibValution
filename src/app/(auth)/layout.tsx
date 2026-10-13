import Image from 'next/image';
import { AuthShowcase } from '@/components/AuthShowcase';
import { EpmoBadge } from '@/components/EpmoBadge';
import { HoneycombBackdrop } from '@/components/HoneycombBackdrop';
import { ThemeSwitchPill } from '@/components/theme-switch';

const SUPPORT_EMAIL = 'helpdesk@nibbank.com.et';

/**
 * The pre-authentication shell.
 *
 * A split screen: the credential card on the left, what the portal is for on
 * the right. The institution identifies itself along the top — lockup, then
 * appearance, then the EPMO pennant — so the card itself carries nothing but
 * the task at hand.
 *
 * Themed rather than fixed dark: the honeycomb ground stays the backdrop in
 * both appearances, a faint warm etching under cream in light mode and low
 * gold filigree over brown in dark mode.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-nib-cream dark:bg-nib-brown-900">
      <HoneycombBackdrop />

      {/* The pennant hangs from the top edge of the window, so it sits outside
          the header's flow. It sizes itself per breakpoint rather than being
          scaled from here: a CSS transform would re-rasterise its shadow at the
          pre-scale size and soften the lettering with it. */}
      <div className="absolute right-2 top-0 z-20 sm:right-6 lg:right-10">
        <EpmoBadge />
      </div>

      <header className="relative z-30 flex flex-wrap items-center gap-y-4 px-4 pt-5 sm:px-8 lg:px-12">
        <div className="mr-auto flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-nib-gold-500/45 bg-white p-1 shadow-[0_6px_16px_-6px_rgba(58,28,5,0.45)] dark:border-nib-gold-400/40">
            <Image
              src="/nib-logo.png"
              alt=""
              width={44}
              height={44}
              loading="eager"
              fetchPriority="high"
              className="h-full w-full object-contain"
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-extrabold leading-tight tracking-tight text-nib-brown-900 sm:text-[17px] dark:text-white">
              NIB International Bank S.C
            </span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-nib-gold-700 sm:text-[10px] dark:text-nib-gold-400">
              Property Valuation System
            </span>
          </span>
        </div>

        {/* Appearance is a comfort setting: centred and well clear of the
            credential card, so it never reads as part of signing in. */}
        <div className="order-last flex w-full justify-center md:absolute md:left-1/2 md:top-6 md:order-none md:w-auto md:-translate-x-1/2">
          <ThemeSwitchPill compact />
        </div>

        {/* Keeps the lockup out from under the pennant above. */}
        <div aria-hidden="true" className="w-[84px] shrink-0 sm:w-[118px] lg:w-[134px]" />
      </header>

      <main className="relative z-10 flex flex-1 items-center px-4 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto grid w-full max-w-6xl items-stretch gap-8 lg:grid-cols-2 lg:gap-14">
          <div className="flex w-full">{children}</div>
          <AuthShowcase className="hidden md:flex" />
        </div>
      </main>

      <footer className="relative z-10 px-4 pb-6 text-center text-[11px] leading-relaxed text-nib-brown-700/70 dark:text-nib-gold-100/55">
        © {new Date().getFullYear()} NIB International Bank S.C. · For access issues contact{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="font-semibold text-nib-gold-700 underline-offset-2 hover:underline dark:text-nib-gold-400"
        >
          {SUPPORT_EMAIL}
        </a>
      </footer>
    </div>
  );
}
