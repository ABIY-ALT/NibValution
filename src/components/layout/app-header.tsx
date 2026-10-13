'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  KeyRound,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useTheme, type ThemePreference } from '@/context/theme-context';
import { useShell } from '@/components/navigation/sidebar';
import type { FeedNotice } from '@/server/application/notification-service';
import { cn } from '@/lib/utils';

export interface HeaderUser {
  fullName: string;
  email: string;
  roleLabels: string;
  initials: string;
  organisation: string;
  unreadCount: number;
}

/** Only one of the header's panels may be open at a time. */
type OpenPanel = 'none' | 'theme' | 'bell' | 'account';

/** Fixed zone, so a stamp rendered on the server matches the one hydrated. */
const STAMP = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const TONE_ICON = {
  alert: AlertTriangle,
  action: Clock,
  info: CheckCircle2,
} as const;

/** The account's initials on the brand gradient, with a presence dot. */
function Avatar({ initials, size = 'md' }: { initials: string; size?: 'md' | 'lg' }) {
  return (
    <span className="relative shrink-0">
      <span
        className={cn(
          'flex items-center justify-center rounded-full bg-gradient-to-br from-nib-brown-700 to-nib-brown-900 font-bold text-nib-gold-200',
          size === 'lg' ? 'h-11 w-11 text-[13px]' : 'h-10 w-10 text-[12px]',
        )}
      >
        {initials}
      </span>
      <span
        aria-hidden="true"
        className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-st-done ring-2 ring-surface"
      />
    </span>
  );
}

const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const satisfies readonly { id: ThemePreference; label: string; icon: LucideIcon }[];

/** A round icon button, the shape every header control shares. */
const HEADER_BUTTON =
  'relative flex h-10 w-10 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink';

/**
 * The application header: a card floating above the page, with the menu
 * trigger and global search on the left, and the appearance menu, the
 * notification bell and the account menu pinned to the right.
 *
 * Appearance lives here and only here - the account menu used to carry a
 * second switcher, which left two controls for one setting.
 *
 * It deliberately does not render the page title. It used to, while every page
 * also rendered its own - so each screen stated its name twice, twenty pixels
 * apart, and shipped two H1 elements. The page owns its identity now, through
 * `PageHero`; the rail carries the institution.
 */
export function AppHeader({
  user,
  notices,
  signOut,
}: {
  user: HeaderUser;
  notices: FeedNotice[];
  signOut: () => Promise<void>;
}) {
  const router = useRouter();
  const { setMobileOpen } = useShell();
  const { preference, setPreference } = useTheme();

  const searchRef = useRef<HTMLInputElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<OpenPanel>('none');

  const currentTheme = THEME_OPTIONS.find((option) => option.id === preference) ?? THEME_OPTIONS[0];
  const ThemeIcon = currentTheme.icon;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setOpen('none');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open === 'none') return;
    const hostRef = { theme: themeRef, bell: bellRef, account: menuRef }[open];
    function onClick(event: MouseEvent) {
      const host = hostRef.current;
      if (host && !host.contains(event.target as Node)) setOpen('none');
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <header
      className={cn(
        'flex h-16 items-center gap-2 rounded-(--radius-card) bg-surface px-3 shadow-card sm:px-5',
        'dark:border dark:border-line',
      )}
    >
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        <span className="sr-only">Open navigation</span>
      </button>

      <form
        role="search"
        className="min-w-0 max-w-md flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          const value = searchRef.current?.value.trim();
          router.push(value ? `/requests?search=${encodeURIComponent(value)}` : '/requests');
        }}
      >
        <div className="relative rounded-(--radius-control) transition-[background-color,box-shadow] duration-150 focus-within:bg-surface-2 focus-within:ring-2 focus-within:ring-nib-gold-500/30">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-2"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            name="search"
            aria-label="Search cases by number, owner, applicant, LHC number, plate, chassis or serial number"
            placeholder="Search cases, owners, LHC, plates…"
            className={cn(
              'h-10 w-full bg-transparent pl-10 pr-2 sm:pr-12',
              'text-[14px] text-ink placeholder:text-ink-3',
              'focus:outline-none',
            )}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 text-[12px] font-medium text-ink-3 sm:block">
            ⌘K
          </kbd>
        </div>
      </form>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="relative" ref={themeRef}>
          <button
            type="button"
            onClick={() => setOpen((panel) => (panel === 'theme' ? 'none' : 'theme'))}
            aria-expanded={open === 'theme'}
            aria-haspopup="menu"
            aria-label={`Appearance: ${currentTheme.label}`}
            title="Appearance"
            className={cn(HEADER_BUTTON, open === 'theme' && 'bg-surface-2 text-ink')}
          >
            <ThemeIcon className="h-5 w-5" aria-hidden="true" />
          </button>

          {open === 'theme' ? (
            <div
              role="menu"
              aria-label="Appearance"
              className="absolute right-0 top-full z-50 mt-3 w-44 rounded-(--radius-card) border border-transparent bg-surface p-1.5 shadow-overlay dark:border-line"
            >
              {THEME_OPTIONS.map((option) => {
                const on = option.id === preference;
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() => {
                      setPreference(option.id);
                      setOpen('none');
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-(--radius-control) px-3 py-2 text-left text-[13px] transition-colors',
                      on
                        ? 'bg-nib-gold-500/15 font-semibold text-nib-gold-800 dark:text-nib-gold-400'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{option.label}</span>
                    {on ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            onClick={() => setOpen((panel) => (panel === 'bell' ? 'none' : 'bell'))}
            aria-expanded={open === 'bell'}
            aria-haspopup="menu"
            aria-label={
              user.unreadCount > 0 ? `${user.unreadCount} items need attention` : 'Notifications'
            }
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-full',
              'text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink',
              open === 'bell' && 'bg-surface-2 text-ink',
            )}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {user.unreadCount > 0 ? (
              <span className="tabular absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-st-late px-1 text-[10px] font-bold text-on-late ring-2 ring-surface">
                {user.unreadCount > 9 ? '9+' : user.unreadCount}
              </span>
            ) : null}
          </button>

          {open === 'bell' ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-3 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-(--radius-card) border border-transparent bg-surface shadow-overlay dark:border-line"
            >
              <div className="flex items-center justify-between border-b border-line bg-surface-2/60 px-4 py-3">
                <p className="text-[13px] font-bold text-ink">Notifications</p>
                <span className="tabular text-[11px] font-semibold text-ink-3">
                  {user.unreadCount} outstanding
                </span>
              </div>

              {notices.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12.5px] text-ink-3">
                  Nothing needs your attention.
                </p>
              ) : (
                <ul className="max-h-[22rem] divide-y divide-line overflow-y-auto">
                  {notices.map((notice) => {
                    const Icon = TONE_ICON[notice.tone];
                    const body = (
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                            notice.tone === 'alert'
                              ? 'bg-st-late-bg text-st-late'
                              : notice.tone === 'action'
                                ? 'bg-st-review-bg text-st-review'
                                : 'bg-surface-3 text-ink-3',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-bold text-ink">
                            {notice.subject}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-ink-2">
                            {notice.body}
                          </span>
                          <span className="tabular mt-1 block text-[10.5px] text-ink-3">
                            {STAMP.format(new Date(notice.at))}
                          </span>
                        </span>
                      </div>
                    );

                    return (
                      <li key={notice.id}>
                        {notice.href ? (
                          <Link
                            href={notice.href}
                            role="menuitem"
                            onClick={() => setOpen('none')}
                            className="block transition-colors hover:bg-surface-2"
                          >
                            {body}
                          </Link>
                        ) : (
                          body
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <Link
                href="/notifications"
                role="menuitem"
                onClick={() => setOpen('none')}
                className="block border-t border-line px-4 py-3 text-center text-[12px] font-bold text-nib-gold-700 transition-colors hover:bg-surface-2 dark:text-nib-gold-400"
              >
                Open Notification Centre
              </Link>
            </div>
          ) : null}
        </div>

        <div className="relative ml-1" ref={menuRef}>
          <button
            type="button"
            onClick={() => setOpen((panel) => (panel === 'account' ? 'none' : 'account'))}
            aria-expanded={open === 'account'}
            aria-haspopup="menu"
            aria-label={`Account menu for ${user.fullName}`}
            title={user.fullName}
            className="flex rounded-full transition-shadow hover:ring-4 hover:ring-nib-gold-500/20"
          >
            <Avatar initials={user.initials} />
          </button>

          {open === 'account' ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-3 w-72 overflow-hidden rounded-(--radius-card) border border-transparent bg-surface shadow-overlay dark:border-line"
            >
              <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
                <Avatar initials={user.initials} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{user.fullName}</p>
                  <p className="truncate text-[12px] text-ink-2">{user.roleLabels}</p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-3">{user.email}</p>
                </div>
              </div>

              <div className="border-b border-line px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                  Organisational scope
                </p>
                <p className="mt-1 text-[13px] text-ink">{user.organisation}</p>
              </div>

              <Link
                href="/change-password"
                role="menuitem"
                onClick={() => setOpen('none')}
                className="flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
              >
                <KeyRound className="h-4 w-4 text-ink-3" aria-hidden="true" />
                Change password
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 border-t border-line px-4 py-3 text-left text-[13px] font-semibold text-st-late transition-colors hover:bg-st-late-bg"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
