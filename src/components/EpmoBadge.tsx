'use client';

import React from 'react';

interface EpmoBadgeProps {
  className?: string;
}

/**
 * The hanging golden EPMO pennant on the pre-authentication pages.
 *
 * Drawn as vector geometry, so it is resolution-independent by construction:
 * there is no raster source to upscale, and it stays sharp on a 4K panel and a
 * phone alike. Three things were making it *look* rasterised anyway, and each
 * is fixed here:
 *
 *  * **Blur filters over the lettering.** The two words sat under `feDropShadow`
 *    at `stdDeviation` 1.5 and 2.5 — a shadow that wide under 10px text is a
 *    halo across the glyphs themselves. Both are gone; the letters now carry a
 *    thin dark outline painted *behind* the fill (`paint-order`), which gives
 *    the same separation from the plate with no softening at all.
 *  * **No font-family.** SVG `<text>` with no family falls back to the UA
 *    default, which is a serif in several engines — a different, heavier shape
 *    than the page, and the thin serifs are the first thing to go mushy when
 *    the badge is scaled down. The stack is now stated explicitly.
 *  * **A transform scale on the wrapper.** The layout scaled the whole pennant
 *    with `scale-[0.62]`, and a scaled CSS filter re-rasterises at the
 *    pre-scale size. Sizing is now done by the badge itself, by width, so the
 *    geometry is laid out at the size it is drawn at.
 *
 * Everything else is unchanged: the same shield, the same gold-on-brown, the
 * same words, the same sway about its pin (`.epmo-swing` in globals.css) which
 * stops for anyone who has asked for reduced motion.
 */

/** Matches the page's own stack, so the pennant is set in the interface face. */
const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const EpmoBadge: React.FC<EpmoBadgeProps> = ({ className = '' }) => {
  return (
    <div
      aria-label="System by EPMO"
      role="img"
      className={`epmo-swing pointer-events-none flex select-none flex-col items-center ${className}`}
    >
      {/* Hanging cord and pin. */}
      <div className="relative flex flex-col items-center">
        <div className="z-10 h-2 w-2 rounded-full bg-amber-300 ring-1 ring-amber-200/80 shadow-[0_0_8px_1px_rgba(251,191,36,0.75)] sm:h-2.5 sm:w-2.5" />
        <div className="h-6 w-px bg-gradient-to-b from-amber-300 via-amber-500 to-amber-600 sm:h-8 sm:w-[2px]" />
      </div>

      {/* The pennant. Width is the only thing that changes between breakpoints;
          the drawing scales with it and stays vector-sharp at every step. */}
      <div className="pointer-events-auto w-[76px] cursor-default transition-transform duration-300 hover:scale-105 sm:w-[104px] lg:w-[120px]">
        <svg
          viewBox="0 0 124 134"
          role="presentation"
          xmlns="http://www.w3.org/2000/svg"
          className="block h-auto w-full drop-shadow-[0_10px_18px_rgba(58,28,5,0.55)]"
        >
          <defs>
            {/* The plate: warm amber at the shoulder falling to near-black at
                the point, which is what makes it read as metal rather than a
                flat brown shape. */}
            <linearGradient
              id="epmo-plate"
              x1="62"
              y1="0"
              x2="62"
              y2="134"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#B36514" />
              <stop offset="26%" stopColor="#8A4708" />
              <stop offset="66%" stopColor="#4A2004" />
              <stop offset="100%" stopColor="#1F0B01" />
            </linearGradient>

            {/* Gold rim. */}
            <linearGradient
              id="epmo-rim"
              x1="0"
              y1="0"
              x2="124"
              y2="134"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="26%" stopColor="#F5B324" />
              <stop offset="70%" stopColor="#D97706" />
              <stop offset="100%" stopColor="#8A4708" />
            </linearGradient>

            {/* A single soft sheen across the top third. Kept well above the
                lettering: the old version laid a dark radial over the whole
                plate, which pulled contrast out from under both words. */}
            <linearGradient
              id="epmo-sheen"
              x1="62"
              y1="4"
              x2="62"
              y2="62"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Shield. */}
          <path
            d="M 3.5 2.5 L 120.5 2.5 L 120.5 99.5 L 62 129.5 L 3.5 99.5 Z"
            fill="url(#epmo-plate)"
            stroke="url(#epmo-rim)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* Sheen. */}
          <path d="M 6 5 L 118 5 L 118 62 L 6 62 Z" fill="url(#epmo-sheen)" />

          {/* Inner pinstripe. */}
          <path
            d="M 7.5 6.5 L 116.5 6.5 L 116.5 96 L 62 123.5 L 7.5 96 Z"
            fill="none"
            stroke="#FEF3C7"
            strokeOpacity="0.22"
            strokeWidth="1"
            strokeLinejoin="round"
          />

          {/* "SYSTEM BY". The dx offsets half the trailing letter-space that
              letter-spacing adds after the final glyph, which otherwise pushes
              middle-anchored text visibly left of centre. */}
          <text
            x="62"
            y="51"
            dx="1.3"
            textAnchor="middle"
            fontFamily={FONT_STACK}
            fontSize="10.5"
            fontWeight="700"
            letterSpacing="2.6"
            fill="#FCD988"
            stroke="#2A1002"
            strokeWidth="1.6"
            strokeOpacity="0.55"
            strokeLinejoin="round"
            paintOrder="stroke fill"
            textRendering="geometricPrecision"
          >
            SYSTEM BY
          </text>

          {/* "EPMO". */}
          <text
            x="62"
            y="86"
            dx="1.1"
            textAnchor="middle"
            fontFamily={FONT_STACK}
            fontSize="26"
            fontWeight="800"
            letterSpacing="2.2"
            fill="#FFFFFF"
            stroke="#2A1002"
            strokeWidth="2.4"
            strokeOpacity="0.6"
            strokeLinejoin="round"
            paintOrder="stroke fill"
            textRendering="geometricPrecision"
          >
            EPMO
          </text>
        </svg>
      </div>
    </div>
  );
};
