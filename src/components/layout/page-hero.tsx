import { cn } from '@/lib/utils';

/**
 * The page hero.
 *
 * Every page opens with one of these and nothing else claims the H1 — the
 * application header carries only the institution, so a page's identity is
 * stated once, at full size, where the eye lands.
 *
 * The title carries the page on its own. A decorative icon plate used to sit
 * beside it on every screen, which gave twenty pages the same gold square and
 * told the reader nothing the title had not already said.
 *
 * `actions` sit on the same optical line as the title on wide viewports and
 * drop beneath it when the title needs the width.
 */
export function PageHero({
  title,
  subtitle,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn('flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between', className)}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-nib-gold-600 dark:text-nib-gold-400">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[26px]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-ink-3 sm:text-sm">
            {subtitle}
          </p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
