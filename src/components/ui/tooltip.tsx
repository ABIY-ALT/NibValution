'use client';

import * as React from 'react';
import * as Primitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

/**
 * A hover and focus hint.
 *
 * The provider is bundled with the tooltip rather than hoisted into the root
 * layout: a hint is a local affordance, and requiring every page that wants one
 * to remember a provider is how a control ships silently broken.
 *
 * `title` is not a substitute. A native tooltip never appears on keyboard
 * focus, so the hint would exist only for someone using a mouse. Radix shows
 * this one on focus as well, and wires it to the trigger with
 * `aria-describedby`.
 */
export function Tooltip({
  content,
  side = 'bottom',
  delay = 200,
  children,
}: {
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <Primitive.Provider delayDuration={delay} skipDelayDuration={300}>
      <Primitive.Root>
        <Primitive.Trigger asChild>{children}</Primitive.Trigger>
        <Primitive.Portal>
          <Primitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={12}
            className={cn(
              'z-50 max-w-xs rounded-(--radius-control) px-2.5 py-1.5',
              'bg-nib-brown-900 text-[11.5px] font-medium leading-snug text-nib-gold-100',
              'shadow-overlay select-none',
              'dark:bg-nib-brown-800 dark:text-nib-gold-100',
            )}
          >
            {content}
            <Primitive.Arrow className="fill-nib-brown-900 dark:fill-nib-brown-800" />
          </Primitive.Content>
        </Primitive.Portal>
      </Primitive.Root>
    </Primitive.Provider>
  );
}
