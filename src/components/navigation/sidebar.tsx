'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  ChevronLeft,
  Clock,
  Cog,
  FilePlus2,
  FileText,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Stamp,
  Tags,
  Timer,
  Undo2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { NibLogo } from '@/components/nib-logo';
import { RailRelief } from '@/components/layout/hex-relief';
import type { BadgeKey, NavItem, NavSection } from './nav-config';

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  ListChecks,
  FileText,
  FilePlus2,
  BarChart3,
  Archive,
  Users,
  ShieldCheck,
  GitBranch,
  SlidersHorizontal,
  Tags,
  ScrollText,
  Building2,
  CalendarDays,
  Cog,
  Bell,
  Timer,
  Stamp,
  Undo2,
  AlertTriangle,
};

// ---------------------------------------------------------------------------
// Shell state
// ---------------------------------------------------------------------------

/**
 * The rail has two independent states: collapsed-to-icons on the desktop, and
 * open-as-an-overlay on small screens. They are separate because they answer
 * different questions - how much room the navigation deserves, and whether the
 * user is currently looking at it.
 *
 * The desktop preference persists; the mobile overlay never does, because an
 * overlay that survived a reload would greet the user with a menu they had not
 * opened.
 */
interface ShellState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const context = useContext(ShellContext);
  if (!context) throw new Error('useShell must be used inside <ShellProvider>');
  return context;
}

const STORAGE_KEY = 'nib.sidebar.collapsed';

/**
 * The collapse preference lives in `localStorage`, which is an external store
 * rather than React state — so it is read through `useSyncExternalStore`. That
 * gives a stable server snapshot (never collapsed) and a client snapshot taken
 * at hydration, without a setState-in-effect that would render twice and make
 * the rail visibly jump on every page load.
 */
const collapseStore = {
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    collapseStore.listeners.add(listener);
    // Another tab changing the preference should move this one too.
    window.addEventListener('storage', listener);
    return () => {
      collapseStore.listeners.delete(listener);
      window.removeEventListener('storage', listener);
    };
  },
  getSnapshot(): boolean {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // A browser refusing storage is not a reason to fail to render a menu.
      return false;
    }
  },
  getServerSnapshot(): boolean {
    return false;
  },
  set(next: boolean) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // The preference is a convenience; losing it costs nothing.
    }
    for (const listener of collapseStore.listeners) listener();
  },
};

export function ShellProvider({ children }: { children: React.ReactNode }) {
  const collapsed = useSyncExternalStore(
    collapseStore.subscribe,
    collapseStore.getSnapshot,
    collapseStore.getServerSnapshot,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const toggleCollapsed = useCallback(() => {
    collapseStore.set(!collapseStore.getSnapshot());
  }, []);

  // Navigating ends the menu interaction on a small screen. Adjusting state
  // during render is React's documented way to reset state when an input
  // changes — an effect here would paint the open overlay for a frame first.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  // Escape closes the overlay, and a locked body stops the page scrolling
  // underneath it.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  const value = useMemo(
    () => ({ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }),
    [collapsed, toggleCollapsed, mobileOpen],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

/**
 * The one item that owns the current page: the longest href that is the path
 * itself or a parent of it.
 *
 * Longest wins, so exactly one item is ever highlighted - `/requests/new`
 * belongs to New Request alone, not to Valuation Requests as well, and
 * `/tasks/approvals` to Pending Approvals rather than to My Tasks too - while a
 * page with no item of its own, such as `/requests/<id>`, still lights its
 * parent.
 */
function activeHrefFor(pathname: string, sections: NavSection[]): string | null {
  let best: string | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const owns = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (owns && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}

function NavLink({
  item,
  count,
  collapsed,
  active,
}: {
  item: NavItem;
  count: number;
  collapsed: boolean;
  active: boolean;
}) {
  const Icon = ICONS[item.icon] ?? FileText;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex h-10 items-center rounded-(--radius-control) text-[14px]',
        'transition-colors duration-150',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3.5',
        active
          ? 'bg-nib-gold-500/15 font-semibold text-nib-gold-800 dark:bg-nib-gold-500/12 dark:text-nib-gold-400'
          : 'text-sidebar-ink hover:bg-sidebar-2',
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5 shrink-0 transition-colors',
          active
            ? 'text-nib-gold-700 dark:text-nib-gold-400'
            : 'text-sidebar-ink-2 group-hover:text-sidebar-ink',
        )}
        aria-hidden="true"
      />

      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}

      {count > 0 ? (
        <span
          className={cn(
            'tabular shrink-0 rounded-full bg-nib-gold-500 text-[10.5px] font-bold leading-none text-nib-brown-900',
            collapsed
              ? 'absolute right-1.5 top-1 h-4 min-w-4 px-1 py-0.5 ring-2 ring-sidebar'
              : 'px-2 py-1',
          )}
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}

      {/* The rail's edge marker: it sits in the nav's gutter, flush with the
          rail's right edge, so the active page is found by scanning one line. */}
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 w-1 rounded-l-md bg-nib-gold-500',
            collapsed ? '-right-2' : '-right-3',
          )}
        />
      ) : null}

      {/* The label must still reach a screen reader when the rail shows icons. */}
      {collapsed ? <span className="sr-only">{item.label}</span> : null}
    </Link>
  );
}

function RailBody({
  sections,
  upcoming,
  badges,
  collapsed,
}: {
  sections: NavSection[];
  upcoming: NavItem[];
  badges: Partial<Record<BadgeKey, number>>;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const activeHref = activeHrefFor(pathname, sections);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'scroll-quiet flex flex-1 flex-col gap-5 overflow-y-auto pb-6 pt-2',
        collapsed ? 'px-2' : 'px-3',
      )}
    >
      {sections.map((section) => (
        <div key={section.title}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-sidebar-line" aria-hidden="true" />
          ) : (
            <h2 className="mb-1.5 px-3.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-sidebar-ink-2">
              {section.title}
            </h2>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  collapsed={collapsed}
                  active={item.href === activeHref}
                  count={item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {upcoming.length > 0 && !collapsed ? (
        <div className="border-t border-sidebar-line pt-4">
          <h2 className="mb-1.5 px-3.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-sidebar-ink-2/70">
            Coming in a later phase
          </h2>
          <ul className="space-y-0.5">
            {upcoming.map((item) => (
              <li
                key={item.href}
                className="flex cursor-default select-none items-center gap-3 rounded-(--radius-control) px-3.5 py-2 text-[13px] text-sidebar-ink-2/60"
              >
                <Clock className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

export interface SidebarProps {
  sections: NavSection[];
  upcoming?: NavItem[];
  /** Live counters keyed by `badgeKey`. A zero renders nothing. */
  badges?: Partial<Record<BadgeKey, number>>;
}

/**
 * The navigation rail: a fixed column on the desktop that collapses to icons,
 * and an overlay drawer below `lg` - where the previous rail was simply hidden,
 * leaving the application with no navigation at all on a tablet or a phone.
 */
export function Sidebar({ sections, upcoming = [], badges = {} }: SidebarProps) {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useShell();

  return (
    <>
      {/* Desktop rail. Raised above the content column so the collapse toggle,
          which straddles the rail's edge, stays clickable over the header band. */}
      <aside
        className={cn(
          'no-print relative z-40 hidden shrink-0 flex-col bg-sidebar shadow-rail lg:flex',
          // A hairline in both themes: with the honeycomb on both sides of the
          // edge, the shadow alone no longer says where the rail ends.
          'border-r border-sidebar-line',
          'transition-[width] duration-200 ease-out',
          collapsed ? 'w-[4.5rem]' : 'w-[17rem]',
        )}
      >
        <RailRelief />

        <div
          className={cn(
            'flex h-[4.5rem] shrink-0 items-center',
            collapsed ? 'justify-center px-2' : 'gap-2 px-5',
          )}
        >
          {collapsed ? <NibLogo size={32} showName={false} /> : <NibLogo size={36} />}
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={cn(
            'absolute -right-3.5 top-[1.375rem] flex h-7 w-7 items-center justify-center rounded-full',
            'bg-nib-gold-500 text-nib-brown-900 shadow-brand ring-[5px] ring-app',
            'transition-[background-color,transform] duration-150 hover:bg-nib-gold-400 active:scale-95',
          )}
        >
          <ChevronLeft
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-200',
              collapsed && 'rotate-180',
            )}
            aria-hidden="true"
          />
          <span className="sr-only">{collapsed ? 'Expand navigation' : 'Collapse navigation'}</span>
        </button>

        <RailBody sections={sections} upcoming={upcoming} badges={badges} collapsed={collapsed} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen ? (
        <div className="no-print lg:hidden">
          <div
            className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="fixed inset-y-0 left-0 z-50 flex w-[17rem] max-w-[85vw] flex-col bg-sidebar shadow-overlay dark:border-r dark:border-sidebar-line"
          >
            <RailRelief />
            <div className="flex h-[4.5rem] shrink-0 items-center justify-between gap-2 px-5">
              <NibLogo size={34} />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) text-sidebar-ink-2 transition-colors hover:bg-sidebar-2 hover:text-sidebar-ink"
              >
                <X className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">Close navigation</span>
              </button>
            </div>
            <RailBody sections={sections} upcoming={upcoming} badges={badges} collapsed={false} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
