import React from 'react';
import { cn } from '@/lib/utils';

/**
 * The honeycomb ground used behind the pre-authentication screens.
 *
 * A tiled SVG hexagon lattice rather than an image: it costs nothing to load,
 * stays crisp at any window size, and takes its colour from `currentColor`, so
 * the same component reads as a faint warm etching under cream in light mode
 * and a low gold filigree over brown in dark mode.
 */

// Pointy-top hexagons. One tile carries the hexagons whose centres fall inside
// it plus the two lattice rows that straddle its top and bottom edges, so the
// clipped halves line up with the neighbouring tiles and the seam disappears.
const R = 26;
const HALF_W = (R * Math.sqrt(3)) / 2;
const TILE_W = HALF_W * 2;
const TILE_H = R * 3;

function hexagon(cx: number, cy: number): string {
  return [
    `M ${cx} ${cy - R}`,
    `L ${cx + HALF_W} ${cy - R / 2}`,
    `L ${cx + HALF_W} ${cy + R / 2}`,
    `L ${cx} ${cy + R}`,
    `L ${cx - HALF_W} ${cy + R / 2}`,
    `L ${cx - HALF_W} ${cy - R / 2}`,
    'Z',
  ].join(' ');
}

const CENTRES: Array<readonly [number, number]> = [
  [HALF_W, R],
  [0, R * 2.5],
  [TILE_W, R * 2.5],
  [0, -R / 2],
  [TILE_W, -R / 2],
];

export function HoneycombBackdrop({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <svg
        className="absolute inset-0 h-full w-full text-nib-gold-500/30 dark:text-nib-gold-400/10"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="nib-honeycomb" width={TILE_W} height={TILE_H} patternUnits="userSpaceOnUse">
            {CENTRES.map(([cx, cy]) => (
              <path
                key={`${cx}-${cy}`}
                d={hexagon(cx, cy)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            ))}
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#nib-honeycomb)" />
      </svg>

      {/* Warm wash: keeps the lattice a texture rather than a grid, and lifts the
          centre of the screen where the credential card sits. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,255,255,0.85)_0%,rgba(252,248,239,0.55)_45%,rgba(240,220,168,0.35)_100%)] dark:bg-[radial-gradient(120%_90%_at_50%_0%,rgba(58,28,5,0.55)_0%,rgba(26,19,12,0.85)_55%,rgba(16,11,6,0.95)_100%)]" />
    </div>
  );
}
