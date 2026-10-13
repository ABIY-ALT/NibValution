import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Status and count pills. One hue per meaning, identical on every screen, so a
 * colour learned on the dashboard still means the same thing in the archive.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-line bg-surface-2 text-ink-2',
        active: 'border-st-active/30 bg-st-active-bg text-st-active',
        inactive: 'border-line bg-surface-2 text-ink-3',
        info: 'border-st-info/30 bg-st-info-bg text-st-info',
        warning: 'border-st-review/30 bg-st-review-bg text-st-review',
        danger: 'border-st-late/30 bg-st-late-bg text-st-late',
        success: 'border-st-done/30 bg-st-done-bg text-st-done',
        brand:
          'border-nib-brown-700/25 bg-nib-brown-900/8 text-nib-brown-800 dark:bg-nib-gold-500/12 dark:text-nib-gold-200',
        accent:
          'border-nib-gold-500/35 bg-nib-gold-100 text-nib-gold-700 dark:bg-nib-gold-500/15 dark:text-nib-gold-400',
      },
      size: {
        default: 'px-2.5 py-0.5 text-[11px]',
        sm: 'px-2 py-0 text-[10px]',
        lg: 'px-3.5 py-1.5 text-[12px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Badge({
  className,
  variant,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { badgeVariants };
