'use client';

import * as React from 'react';
import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Modal panels.
 *
 * Used where an edit is consequential enough to deserve the user's whole
 * attention but too small to warrant its own route — changing what a person is
 * authorised to do, for instance. Radix supplies the focus trap, the scroll
 * lock, `aria-modal`, and Escape-to-close.
 */
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm" />
    <Primitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2',
        'max-h-[calc(100vh-4rem)] overflow-hidden rounded-(--radius-panel) border border-line',
        'bg-surface shadow-overlay',
        'flex flex-col',
        className,
      )}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <Primitive.Close
          className={cn(
            'absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-(--radius-control)',
            'text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </Primitive.Close>
      )}
    </Primitive.Content>
  </Primitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 border-b border-line bg-surface-2/60 px-6 py-5 pr-14', className)}
      {...props}
    />
  );
}

/** The scrolling middle, so a long form never pushes the footer off-screen. */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/40 px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof Primitive.Title>,
  React.ComponentPropsWithoutRef<typeof Primitive.Title>
>(({ className, ...props }, ref) => (
  <Primitive.Title
    ref={ref}
    className={cn('text-section font-bold tracking-tight text-ink', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof Primitive.Description>,
  React.ComponentPropsWithoutRef<typeof Primitive.Description>
>(({ className, ...props }, ref) => (
  <Primitive.Description
    ref={ref}
    className={cn('mt-1 text-[12.5px] leading-relaxed text-ink-3', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';
