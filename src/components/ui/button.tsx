import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Controls.
 *
 * Sized a step larger than the previous set: a 36px control reads as a dense
 * back-office widget, a 40px one as a considered institutional action. Icons
 * are sized by the variant rather than at each call site, so a button cannot
 * ship with a mismatched glyph.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--radius-control)',
    'text-[13px] font-semibold tracking-tight select-none',
    'transition-[background-color,border-color,box-shadow,transform] duration-150',
    'active:scale-[0.98]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        default:
          'bg-nib-gold-500 text-nib-brown-900 shadow-brand hover:bg-nib-gold-400 hover:shadow-brand-raised',
        accent:
          'bg-nib-brown-800 text-nib-gold-200 shadow-card hover:bg-nib-brown-900 hover:shadow-raised',
        destructive: 'bg-st-late text-on-late shadow-card hover:bg-st-late/90 hover:shadow-raised',
        // A destructive action that should not shout: tinted, not filled, so it
        // sits beside a primary action without competing with it.
        'soft-danger':
          'border border-st-late/25 bg-st-late-bg text-st-late hover:border-st-late/40 hover:bg-st-late/15',
        outline:
          'border border-line-strong bg-surface text-ink shadow-card hover:border-nib-gold-500/50 hover:bg-surface-2',
        secondary: 'border border-line bg-surface-2 text-ink hover:bg-surface-3',
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        link: 'text-nib-gold-700 underline-offset-4 hover:underline dark:text-nib-gold-400',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        lg: 'h-12 px-7 text-sm',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8 [&_svg]:size-3.5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
