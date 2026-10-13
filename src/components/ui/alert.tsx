import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Notices.
 *
 * The tinted body carries the state colour, but the copy stays in the ordinary
 * ink so a long explanation remains readable — coloured body text at paragraph
 * length is tiring, and the point of the colour is the state, not the prose.
 * A left rule in the state hue does the signalling instead.
 */
const alertVariants = cva(
  [
    'relative w-full rounded-(--radius-control) border border-l-4 px-4 py-3.5 text-[13px]',
    '[&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:size-4 [&>svg~*]:pl-7',
  ],
  {
    variants: {
      variant: {
        default: 'border-line border-l-ink-3 bg-surface-2 text-ink [&>svg]:text-ink-3',
        destructive:
          'border-st-late/30 border-l-st-late bg-st-late-bg text-ink [&>svg]:text-st-late',
        warning:
          'border-st-review/30 border-l-st-review bg-st-review-bg text-ink [&>svg]:text-st-review',
        success: 'border-st-done/30 border-l-st-done bg-st-done-bg text-ink [&>svg]:text-st-done',
        info: 'border-st-info/30 border-l-st-info bg-st-info-bg text-ink [&>svg]:text-st-info',
        brand:
          'border-nib-gold-500/30 border-l-nib-gold-500 bg-nib-gold-100/50 text-ink dark:bg-nib-gold-500/10 [&>svg]:text-nib-gold-600',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

export const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('mb-1 text-[13px] font-bold leading-snug tracking-tight text-ink', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-[12.5px] leading-relaxed text-ink-2 [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';
