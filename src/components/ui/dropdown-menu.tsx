'use client';

import * as React from 'react';
import * as Primitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Row and toolbar action menus.
 *
 * Radix handles the parts that are easy to get wrong by hand: focus is trapped
 * and restored to the trigger, arrow keys and type-ahead work, Escape and an
 * outside click dismiss, and the panel flips when it would leave the viewport —
 * which matters here because these open from the last column of a table that
 * scrolls.
 */
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof Primitive.Content>,
  React.ComponentPropsWithoutRef<typeof Primitive.Content>
>(({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
  <Primitive.Portal>
    <Primitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 min-w-[13rem] overflow-hidden rounded-(--radius-card) border border-line bg-surface p-1.5 shadow-overlay',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  </Primitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuLabel = React.forwardRef<
  React.ComponentRef<typeof Primitive.Label>,
  React.ComponentPropsWithoutRef<typeof Primitive.Label>
>(({ className, ...props }, ref) => (
  <Primitive.Label
    ref={ref}
    className={cn(
      'px-2.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3',
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof Primitive.Separator>,
  React.ComponentPropsWithoutRef<typeof Primitive.Separator>
>(({ className, ...props }, ref) => (
  <Primitive.Separator
    ref={ref}
    className={cn('-mx-1.5 my-1.5 h-px bg-line', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.Item>,
  React.ComponentPropsWithoutRef<typeof Primitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <Primitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2.5 rounded-(--radius-control) px-2.5 py-2',
      'text-[12.5px] font-medium outline-none transition-colors',
      '[&_svg]:size-4 [&_svg]:shrink-0',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
      destructive
        ? 'text-st-late data-[highlighted]:bg-st-late-bg'
        : 'text-ink data-[highlighted]:bg-surface-2',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof Primitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <Primitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2.5 rounded-(--radius-control) px-2.5 py-2',
      'text-[12.5px] font-medium text-ink outline-none transition-colors',
      'data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
        checked ? 'border-nib-gold-600 bg-nib-gold-500 text-nib-brown-900' : 'border-line-strong',
      )}
    >
      <Primitive.ItemIndicator>
        <Check className="h-3 w-3" strokeWidth={3} />
      </Primitive.ItemIndicator>
    </span>
    {children}
  </Primitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';
