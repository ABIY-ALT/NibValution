import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Surfaces.
 *
 * Radii come from `--radius-card` through the parenthesised custom-property
 * syntax, `rounded-(--radius-card)`. The square-bracket equivalent is Tailwind
 * v3 and was removed in v4: it compiled to a bare `border-radius:` followed by
 * the raw property name, which browsers discard, so every card, table and
 * input in the application rendered square-cornered. Always use parentheses.
 */
/**
 * Cards are borderless in the light theme: white on the warm-grey ground, lifted
 * by `shadow-card` alone. The dark theme keeps a hairline, because a shadow on a
 * near-black ground does not read as an edge.
 */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-(--radius-card) border border-transparent bg-surface text-ink shadow-card dark:border-line',
        'transition-[box-shadow,border-color] duration-200',
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/**
 * A card that responds to the pointer. Used wherever the whole surface is a
 * link; a card that lifts invites the click that a flat one does not.
 */
export const CardInteractive = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <Card
    ref={ref}
    className={cn('hover:shadow-raised dark:hover:border-nib-gold-500/45', className)}
    {...props}
  />
));
CardInteractive.displayName = 'CardInteractive';

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6 pb-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

/**
 * A header separated from the body by a rule. It gives a panel a masthead, so
 * a long list reads as a document section rather than as content that simply
 * starts. It sits on the card's own surface rather than a tinted band.
 */
export const CardBar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-row items-center justify-between gap-3 border-b border-line',
        'px-6 pb-4 pt-5',
        className,
      )}
      {...props}
    />
  ),
);
CardBar.displayName = 'CardBar';

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-section font-semibold leading-snug tracking-tight text-ink', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const ICON_TONES = {
  brand: 'bg-nib-gold-500/15 text-nib-gold-700 dark:text-nib-gold-400',
  danger: 'bg-st-late-bg text-st-late',
  info: 'bg-st-info-bg text-st-info',
  good: 'bg-st-done-bg text-st-done',
} as const;

/**
 * The tinted icon plate a card title leads with. The tint says what kind of
 * section it is - gold for ordinary content, red for corrections - so the
 * title text itself stays in ink.
 */
export function CardIcon({
  icon: Icon,
  tone = 'brand',
  className,
}: {
  icon: LucideIcon;
  tone?: keyof typeof ICON_TONES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control)',
        ICON_TONES[tone],
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-[13px] leading-relaxed text-ink-3', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

/**
 * Body padding assumes a `CardHeader` above it, which already carries the top
 * gap. A card whose body stands alone — or one that follows a `CardBar` — sets
 * its own top padding with `pt-6`.
 */
export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 border-t border-line px-6 py-4', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
