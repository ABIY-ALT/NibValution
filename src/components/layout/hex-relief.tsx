import type { CSSProperties } from 'react';

/**
 * The hexagon relief behind the application shell. The image and its dark-mode
 * treatment live in the `.hex-relief` class in globals.css; these components
 * only place it. Strength and placement match the NIB design kit
 * (design-kit/react/hex-relief.tsx), as updated on 5 October 2026.
 *
 * The two layers stack differently, on purpose:
 *   RailRelief   sits at z -10, so the rail (a stacking context) paints its
 *                menu over it.
 *   GroundRelief has no z-index. The content column must not be a stacking
 *                context - a dialog rendered inside a page has to reach the
 *                root one to cover the rail - so this layer goes first in the
 *                column and the header band and <main> after it are
 *                positioned, which paints them over the texture.
 *
 * The masks are inline styles rather than arbitrary utilities so the -webkit-
 * form ships alongside the standard one for older Chromium builds.
 */

const fade = (gradient: string): CSSProperties => ({
  WebkitMaskImage: gradient,
  maskImage: gradient,
});

/**
 * The full honeycomb behind the navigation rail, faded out under the logo.
 *
 * Deliberately faint (0.3 light, 0.15 dark; it was 0.9 and 0.45): stronger,
 * the cell shadows competed with the menu labels, and the rail's job is to be
 * read. Kept just strong enough to show the texture is there.
 */
export function RailRelief() {
  return (
    <div
      aria-hidden="true"
      className="hex-relief pointer-events-none absolute inset-0 -z-10 bg-cover bg-top opacity-30 dark:opacity-15"
      style={fade('linear-gradient(to bottom, transparent, #000 7rem)')}
    />
  );
}

/**
 * The content ground: two fragments of the honeycomb at opposite corners, each
 * dissolving towards the middle, so the texture frames the page rather than
 * running under the cards and tables a reader is working in. The layer belongs
 * to the column, not the scroll area, so it stays put while the page scrolls.
 */
export function GroundRelief() {
  return (
    <div
      aria-hidden="true"
      className="no-print pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div
        className="hex-relief absolute -right-[6%] -top-[8%] h-[116%] w-[min(62vh,640px)] bg-contain bg-center dark:opacity-55"
        style={fade('linear-gradient(to left, #000 30%, transparent)')}
      />
      {/* Turned half a circle, so the corner reads as the same wall seen from
          the other end rather than a copy. The mask turns with it. Dropped
          below 1024px, where there is no room for it to frame anything. */}
      <div
        className="hex-relief absolute -bottom-[30%] -left-[10%] hidden h-[90%] w-[min(48vh,480px)] rotate-180 bg-contain bg-center opacity-60 lg:block dark:opacity-35"
        style={fade('linear-gradient(to left, #000 20%, transparent 90%)')}
      />
    </div>
  );
}
