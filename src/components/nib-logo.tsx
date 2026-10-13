import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Institutional NIB Logo lockup matching the NIB Board design.
 */
export function NibLogo({
  className,
  showName = true,
  variant = 'dark',
  size = 36,
}: {
  className?: string;
  showName?: boolean;
  variant?: 'dark' | 'light';
  size?: number;
}) {
  const isLight = variant === 'light';

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="relative flex items-center justify-center shrink-0 rounded-lg overflow-hidden">
        <Image
          src="/nib-logo.png"
          alt="NIB International Bank"
          width={size}
          height={size}
          priority
          className="object-contain"
        />
      </div>
      {showName ? (
        <div className="min-w-0 leading-tight">
          <div
            className={cn(
              'text-[12px] font-bold tracking-tight truncate',
              isLight ? 'text-sidebar-ink' : 'text-ink',
            )}
          >
            NIB INTERNATIONAL BANK S.C.
          </div>
          <div
            className={cn(
              'text-[10px] font-semibold tracking-wider uppercase truncate',
              isLight ? 'text-nib-gold-400' : 'text-nib-gold-600 dark:text-nib-gold-400',
            )}
          >
            PROPERTY VALUATION
          </div>
        </div>
      ) : null}
    </div>
  );
}
