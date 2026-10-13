'use client';

import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/context/theme-context';
import { cn } from '@/lib/utils';

const THEMES: Array<{ id: ThemePreference; label: string; icon: React.ReactNode }> = [
  { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
  { id: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
];

/**
 * Appearance pill control, used before sign-in or inside page headers.
 */
export const ThemeSwitchPill: React.FC<{ className?: string; compact?: boolean }> = ({
  className,
  compact = false,
}) => {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Appearance"
      className={cn(
        'flex items-center gap-0.5 rounded-full border border-nib-brown-900/15 bg-white/75 p-1 shadow-lg backdrop-blur-md dark:border-nib-gold-400/25 dark:bg-nib-brown-900/80',
        className,
      )}
    >
      {THEMES.map((t) => {
        const on = preference === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setPreference(t.id)}
            aria-pressed={on}
            aria-label={compact ? `${t.label} appearance` : undefined}
            title={`${t.label} appearance`}
            className={cn(
              'flex items-center gap-1.5 rounded-full text-[11px] font-semibold transition-colors',
              compact ? 'px-2.5 py-2' : 'px-2.5 py-1',
              on
                ? 'bg-nib-gold-500 text-nib-brown-900 shadow-sm'
                : 'text-nib-brown-700 hover:bg-nib-brown-900/8 dark:text-nib-gold-100/70 dark:hover:bg-white/10',
            )}
          >
            {t.icon}
            {compact ? null : <span className="hidden sm:inline">{t.label}</span>}
          </button>
        );
      })}
    </div>
  );
};

/**
 * Compact header theme switcher.
 */
export const HeaderThemeSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Appearance"
      className={cn(
        'inline-flex items-center rounded-lg border border-line bg-surface p-0.5',
        className,
      )}
    >
      {THEMES.map((t) => {
        const on = preference === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setPreference(t.id)}
            aria-pressed={on}
            title={`${t.label} appearance`}
            className={cn(
              'flex items-center justify-center p-1.5 rounded-md transition-colors',
              on
                ? 'bg-nib-gold-500 text-nib-brown-900'
                : 'text-ink-3 hover:text-ink hover:bg-surface-2',
            )}
          >
            {t.icon}
          </button>
        );
      })}
    </div>
  );
};
