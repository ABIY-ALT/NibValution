import React from 'react';

/**
 * The boardroom behind the sign-in page.
 *
 * Drawn rather than photographed, for three reasons: a stock photograph of
 * somebody else's boardroom would be a small lie on a bank's own portal, a real
 * image is hundreds of kilobytes on the one page every officer loads before
 * anything is cached, and this scales to any viewport without art direction.
 *
 * The geometry is deliberately simple - a lit table under a pendant, chairs in
 * perspective, panelled walls - because it is scenery. It sits behind a scrim
 * and never competes with the form.
 *
 * Purely decorative, so it is hidden from assistive technology entirely.
 */
export const BoardroomScene: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 1200 800"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="nib-room" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2B1405" />
        <stop offset="55%" stopColor="#4B2507" />
        <stop offset="100%" stopColor="#1B0F04" />
      </linearGradient>

      <radialGradient id="nib-pendant" cx="50%" cy="30%" r="52%">
        <stop offset="0%" stopColor="#F3BD28" stopOpacity="0.42" />
        <stop offset="45%" stopColor="#D89A16" stopOpacity="0.14" />
        <stop offset="100%" stopColor="#D89A16" stopOpacity="0" />
      </radialGradient>

      <linearGradient id="nib-table" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#8F4E14" />
        <stop offset="40%" stopColor="#6A3709" />
        <stop offset="100%" stopColor="#3A1C05" />
      </linearGradient>

      <linearGradient id="nib-sheen" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#F0DCA8" stopOpacity="0" />
        <stop offset="45%" stopColor="#F0DCA8" stopOpacity="0.30" />
        <stop offset="60%" stopColor="#F0DCA8" stopOpacity="0.10" />
        <stop offset="100%" stopColor="#F0DCA8" stopOpacity="0" />
      </linearGradient>

      <linearGradient id="nib-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1B0F04" stopOpacity="0" />
        <stop offset="100%" stopColor="#0E0802" stopOpacity="0.95" />
      </linearGradient>

      {/* Paper on the table catches the pendant light. */}
      <linearGradient id="nib-paper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F8E9C5" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#F0DCA8" stopOpacity="0.45" />
      </linearGradient>
    </defs>

    <rect width="1200" height="800" fill="url(#nib-room)" />

    {/* Panelled back wall - vertical joints, widely spaced so it reads as
        panelling rather than as a pattern. */}
    <g stroke="#F3BD28" strokeOpacity="0.05" strokeWidth="1.5">
      {Array.from({ length: 13 }, (_, i) => (
        <line key={i} x1={i * 100} y1="0" x2={i * 100} y2="430" />
      ))}
    </g>
    <line
      x1="0"
      y1="430"
      x2="1200"
      y2="430"
      stroke="#F3BD28"
      strokeOpacity="0.10"
      strokeWidth="2"
    />

    {/* Pendant over the head of the table */}
    <rect x="598" y="0" width="4" height="132" fill="#F3BD28" fillOpacity="0.18" />
    <ellipse cx="600" cy="150" rx="118" ry="20" fill="#F3BD28" fillOpacity="0.16" />
    <ellipse cx="600" cy="146" rx="86" ry="13" fill="#F3BD28" fillOpacity="0.34" />
    <ellipse cx="600" cy="330" rx="560" ry="330" fill="url(#nib-pendant)" />

    {/* Far chairs, silhouetted against the lit wall */}
    <g fill="#1B0F04" fillOpacity="0.72">
      {[300, 420, 540, 660, 780, 900].map((x) => (
        <g key={x}>
          <rect x={x - 34} y="318" width="68" height="96" rx="16" />
          <rect x={x - 8} y="404" width="16" height="26" />
        </g>
      ))}
    </g>

    {/* The board table, in perspective */}
    <path d="M150 470 L1050 470 L1200 700 L0 700 Z" fill="url(#nib-table)" />
    <path d="M150 470 L1050 470 L1200 700 L0 700 Z" fill="url(#nib-sheen)" />
    <path
      d="M150 470 L1050 470"
      stroke="#F0DCA8"
      strokeOpacity="0.22"
      strokeWidth="2"
      fill="none"
    />

    {/* Board papers set at each place */}
    <g fill="url(#nib-paper)">
      <rect x="286" y="500" width="76" height="46" rx="2" transform="rotate(-3 324 523)" />
      <rect x="470" y="512" width="84" height="52" rx="2" transform="rotate(2 512 538)" />
      <rect x="662" y="506" width="80" height="48" rx="2" transform="rotate(-2 702 530)" />
      <rect x="848" y="516" width="78" height="50" rx="2" transform="rotate(3 887 541)" />
    </g>

    {/* Near chairs, cropped by the frame the way they would be from the door */}
    <g fill="#160C03" fillOpacity="0.9">
      <rect x="130" y="640" width="180" height="200" rx="30" />
      <rect x="880" y="640" width="180" height="200" rx="30" />
    </g>

    <rect y="600" width="1200" height="200" fill="url(#nib-floor)" />
  </svg>
);
