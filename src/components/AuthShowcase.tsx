'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Building2,
  ClipboardCheck,
  Cog,
  FileText,
  MapPin,
  Ruler,
  Scale,
  ScrollText,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Slide {
  /** Two-tone headline: the first line in brown, the second in gold. */
  titleTop: string;
  titleBottom: string;
  tagline: [string, string];
  features: Array<{ label: string; icon: LucideIcon }>;
  emblem: LucideIcon;
  motto: string;
}

/**
 * The institutional banner beside the credential card.
 *
 * Composed rather than an exported artwork file: the lockup, headline, feature
 * strip and gold wave are all markup, so the panel stays crisp at any size, the
 * copy can be corrected without a trip through a design tool, and nothing has
 * to be re-exported when the remit of the system changes.
 *
 * Three panels because the system serves three audiences — the branch raising a
 * request, the estimators working it, and the reviewers signing it off — and a
 * single banner flattens them into none.
 */
const SLIDES: readonly Slide[] = [
  {
    titleTop: 'PROPERTY VALUATION',
    titleBottom: 'MANAGEMENT SYSTEM',
    tagline: ['Streamlining collateral valuation.', 'Ensuring accuracy. Delivering assurance.'],
    features: [
      { label: 'Request intake', icon: FileText },
      { label: 'Civil estimation', icon: Building2 },
      { label: 'Mechanical estimation', icon: Cog },
      { label: 'Approval workflow', icon: ClipboardCheck },
    ],
    emblem: Building2,
    motto: 'Accuracy · Integrity · Compliance',
  },
  {
    titleTop: 'CIVIL & MECHANICAL',
    titleBottom: 'ONE CASE FILE',
    tagline: [
      'Land, buildings and machinery valued together.',
      'One file, one reference, one decision.',
    ],
    features: [
      { label: 'Site inspection', icon: MapPin },
      { label: 'Measurement', icon: Ruler },
      { label: 'Machinery appraisal', icon: Cog },
      { label: 'Unified report', icon: FileText },
    ],
    emblem: Scale,
    motto: 'One file · Both disciplines · One value',
  },
  {
    titleTop: 'OVERSIGHT &',
    titleBottom: 'AUDIT TRAIL',
    tagline: [
      'Every approval, return and revision logged.',
      'Completed valuations stay searchable.',
    ],
    features: [
      { label: 'Approval trail', icon: ClipboardCheck },
      { label: 'Audit log', icon: ScrollText },
      { label: 'SLA tracking', icon: Timer },
      { label: 'Secure archive', icon: ShieldCheck },
    ],
    emblem: ShieldCheck,
    motto: 'Traceable · Auditable · Secure',
  },
];

const ROTATE_MS = 7000;

export function AuthShowcase({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  // Anyone who has asked for reduced motion gets the first panel and the dots,
  // not a card that changes under them while they are typing a password.
  const [autoRotate, setAutoRotate] = useState(true);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setAutoRotate(!query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!autoRotate || paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [autoRotate, paused]);

  const select = useCallback((i: number) => setIndex(i), []);

  // `index` is only ever set from this list, so the fallback is a type guard
  // rather than a real case.
  const slide = SLIDES[index] ?? SLIDES[0];
  if (!slide) return null;

  const Emblem = slide.emblem;

  return (
    // A grid item stretched to the row, so this panel and the credential card
    // opposite it finish at one height whichever step the card is showing.
    <div
      className={cn('h-full flex-col', className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* Gold frame around the banner: the same pairing as the EPMO pennant, so
          the two read as one piece of institutional furniture. The banner keeps
          its printed cream ground in both appearances — it is artwork, and
          artwork does not invert with the interface around it. */}
      <div className="flex flex-1 flex-col rounded-[26px] bg-gradient-to-bl from-nib-gold-400 via-nib-gold-500 to-nib-gold-700 p-[5px] shadow-[0_30px_70px_-20px_rgba(58,28,5,0.55)]">
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-[21px] bg-gradient-to-br from-[#FEFBF1] via-[#F8E6B8] to-[#EDBE49]">
          <BannerTexture />
          <BannerWave motto={slide.motto} />

          <div
            key={index}
            aria-live="polite"
            className="nib-panel-enter relative flex flex-1 flex-col px-7 pb-[104px] pt-7 sm:px-9 sm:pt-8"
          >
            {/* Bank lockup */}
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/80 p-1 shadow-[0_4px_10px_-4px_rgba(58,28,5,0.4)]">
                <Image
                  src="/nib-logo.png"
                  alt=""
                  width={40}
                  height={40}
                  loading="eager"
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="leading-none">
                <span className="block text-[19px] font-black tracking-tight text-nib-brown-900">
                  NIB
                </span>
                <span className="mt-[3px] block text-[7.5px] font-bold uppercase tracking-[0.16em] text-nib-brown-800/80">
                  International Bank S.C.
                </span>
              </span>
            </div>

            {/* Emblem: the subject of the slide struck as a medallion, kept
                clear of the headline so neither has to shrink for the other. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute right-6 top-14 hidden h-[136px] w-[136px] items-center justify-center sm:flex"
            >
              <span className="absolute inset-0 rounded-full bg-white/35" />
              <span className="absolute inset-[10px] rounded-full border border-nib-brown-900/10" />
              <span className="absolute inset-[18px] rounded-full bg-gradient-to-br from-nib-gold-400 to-nib-gold-600 shadow-[0_10px_24px_-8px_rgba(120,59,8,0.55)]" />
              <Emblem className="relative h-14 w-14 text-nib-brown-900/85" strokeWidth={1.4} />
            </div>

            {/* Headline */}
            <h2 className="mt-7 max-w-[62%] text-[21px] font-black leading-[1.08] tracking-tight text-nib-brown-900 sm:text-[25px]">
              {slide.titleTop}
              <span className="block text-nib-gold-600">{slide.titleBottom}</span>
            </h2>

            <span
              aria-hidden="true"
              className="mt-3.5 block h-[3px] w-12 rounded-full bg-nib-gold-600"
            />

            <p className="mt-3 max-w-[60%] text-[11px] font-medium leading-relaxed text-nib-brown-800/80">
              {slide.tagline[0]}
              <br />
              {slide.tagline[1]}
            </p>

            {/* Feature strip */}
            <div className="mt-auto flex items-stretch pt-7">
              {slide.features.map(({ label, icon: Icon }, i) => (
                <div
                  key={label}
                  className={cn(
                    'flex flex-1 flex-col items-center gap-2 px-1.5 text-center',
                    i > 0 && 'border-l border-nib-brown-900/12',
                  )}
                >
                  <Icon
                    className="h-[22px] w-[22px] text-nib-brown-800"
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                  <span className="text-[8px] font-bold uppercase leading-[1.35] tracking-[0.08em] text-nib-brown-800/75">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-center gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.titleTop}
            type="button"
            onClick={() => select(i)}
            aria-label={`Show: ${s.titleTop} ${s.titleBottom}`}
            aria-current={i === index}
            className={cn(
              'h-[5px] rounded-full transition-all duration-300',
              i === index
                ? 'w-9 bg-nib-gold-500'
                : 'w-7 bg-nib-brown-900/15 hover:bg-nib-brown-900/30 dark:bg-nib-gold-100/20 dark:hover:bg-nib-gold-100/40',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The same honeycomb the page stands on, pressed faintly into the banner. */
function BannerTexture() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full text-nib-brown-800/10"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="nib-banner-honeycomb" width="41.57" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M 20.78 -12 L 41.57 0 L 41.57 24 L 20.78 36 L 0 24 L 0 0 Z M 20.78 24 L 41.57 36 L 41.57 60 L 20.78 72 L 0 60 L 0 36 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#nib-banner-honeycomb)" />
    </svg>
  );
}

/**
 * The gold band along the foot of the banner, carrying the motto over a faint
 * skyline — the collateral the system exists to value.
 */
function BannerWave({ motto }: { motto: string }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[104px]">
      <svg
        viewBox="0 0 600 104"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id="nib-wave-back"
            x1="0"
            y1="0"
            x2="600"
            y2="104"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#F3BD28" />
            <stop offset="100%" stopColor="#D89A16" />
          </linearGradient>
          <linearGradient
            id="nib-wave-front"
            x1="0"
            y1="0"
            x2="600"
            y2="104"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#5C3208" />
            <stop offset="55%" stopColor="#3A1C05" />
            <stop offset="100%" stopColor="#78400A" />
          </linearGradient>
        </defs>

        <path
          d="M0,34 C110,4 210,64 320,44 C420,26 520,58 600,30 L600,104 L0,104 Z"
          fill="url(#nib-wave-back)"
        />
        <path
          d="M0,62 C120,38 220,86 340,70 C440,57 530,80 600,60 L600,104 L0,104 Z"
          fill="url(#nib-wave-front)"
        />

        {/* Skyline, low enough to read as texture rather than illustration. */}
        <g fill="#F8E9C5" fillOpacity="0.16">
          <rect x="38" y="82" width="16" height="22" />
          <rect x="58" y="76" width="12" height="28" />
          <rect x="74" y="86" width="20" height="18" />
          <rect x="98" y="79" width="14" height="25" />
          <rect x="446" y="84" width="18" height="20" />
          <rect x="468" y="77" width="12" height="27" />
          <rect x="484" y="87" width="22" height="17" />
          <rect x="510" y="81" width="13" height="23" />
        </g>
      </svg>

      <p className="absolute inset-x-0 bottom-[18px] text-center text-[9.5px] font-bold uppercase tracking-[0.2em] text-nib-gold-100">
        {motto}
      </p>
    </div>
  );
}
