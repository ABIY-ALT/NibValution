import type { CSSProperties } from 'react';

/**
 * NIB design kit - the hexagon relief, for React + Tailwind v4 projects.
 *
 * Needs nib-tokens.css and nib-tailwind.css imported, and
 * textures/hex-relief.webp served at /textures/hex-relief.webp. The image and
 * its dark-mode inversion come from the `hex-relief` utility; the strength
 * comes from the --nib-relief-* tokens, which switch with the theme. These
 * components only place it.
 *
 * The two layers stack differently, on purpose:
 *   RailRelief   sits at z -10, so the rail (a stacking context - give it
 *                `relative z-40`) paints its menu over it.
 *   GroundRelief has no z-index. The content column must NOT be a stacking
 *                context (no `isolate`, no z-index): dialogs rendered inside
 *                the page have to reach the root one to cover the rail. So this
 *                layer goes first in the column, and the header band and
 *                <main> after it are positioned (`relative`), which paints them
 *                over the texture.
 *
 * The masks are inline styles rather than arbitrary utilities so the -webkit-
 * form ships alongside the standard one for older Chromium builds.
 */

const fade = (gradient: string): CSSProperties => ({
  WebkitMaskImage: gradient,
  maskImage: gradient,
});

/** The full honeycomb behind the navigation rail, faded out under the logo. */
export function RailRelief() {
  return (
    <div
      aria-hidden="true"
      className="hex-relief no-print pointer-events-none absolute inset-0 -z-10 bg-cover bg-top opacity-(--nib-relief-rail)"
      style={fade('linear-gradient(to bottom, transparent, #000 7rem)')}
    />
  );
}

/**
 * Two fragments at opposite corners of the content column, each dissolving
 * towards the middle, so the texture frames the page rather than running under
 * the cards. The second is turned half a circle, so it reads as the same wall
 * seen from the other end; it is dropped below 1024px, where there is no room
 * for it to frame anything.
 */
export function GroundRelief() {
  return (
    <div aria-hidden="true" className="no-print pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="hex-relief absolute -right-[6%] -top-[8%] h-[116%] w-[min(62vh,640px)] bg-contain bg-center opacity-(--nib-relief-ground)"
        style={fade('linear-gradient(to left, #000 30%, transparent)')}
      />
      <div
        className="hex-relief absolute -bottom-[30%] -left-[10%] hidden h-[90%] w-[min(48vh,480px)] rotate-180 bg-contain bg-center opacity-(--nib-relief-ground-2) lg:block"
        style={fade('linear-gradient(to left, #000 20%, transparent 90%)')}
      />
    </div>
  );
}

/*
 * Placement:
 *
 *   <div className="flex h-screen overflow-hidden bg-app">
 *     <aside className="relative z-40 ... bg-sidebar">
 *       <RailRelief />
 *       ...logo, collapse button, menu...
 *     </aside>
 *     <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
 *       <GroundRelief />
 *       <div className="relative z-30 shrink-0 px-4 pt-3 sm:px-6 sm:pt-4">...header...</div>
 *       <main className="relative flex-1 overflow-y-auto">...page...</main>
 *     </div>
 *   </div>
 */
