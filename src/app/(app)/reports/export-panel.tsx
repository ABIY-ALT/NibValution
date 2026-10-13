'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Check, Download, RotateCcw, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_COLUMNS,
  type ExportColumnKey,
} from '@/lib/validation/report';

const STORAGE_KEY = 'nib.report.export.preferences';

interface Preferences {
  columns: ExportColumnKey[];
  delimiter: 'comma' | 'semicolon';
  bom: boolean;
}

const FALLBACK: Preferences = {
  columns: [...DEFAULT_EXPORT_COLUMNS],
  delimiter: 'comma',
  bom: true,
};

/**
 * Read a saved preference, discarding anything that no longer makes sense.
 *
 * A preference saved by an older build may name a column that has since been
 * removed. Filtering against the current catalogue means an out-of-date
 * preference degrades to a smaller export rather than a failed one.
 */
function parsePreferences(raw: string | null): Preferences {
  try {
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    const valid = new Set(EXPORT_COLUMNS.map((c) => c.key));
    const columns = (parsed.columns ?? []).filter((c): c is ExportColumnKey => valid.has(c));
    return {
      columns: columns.length > 0 ? columns : [...DEFAULT_EXPORT_COLUMNS],
      delimiter: parsed.delimiter === 'semicolon' ? 'semicolon' : 'comma',
      bom: parsed.bom !== false,
    };
  } catch {
    // Private browsing, cleared storage, or malformed JSON. The default set is
    // always usable, so there is nothing to report to the user.
    return FALLBACK;
  }
}

/**
 * The saved preference is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into state by an effect: the server
 * renders the defaults, the client renders the saved set on its first pass, and
 * there is no second render that would flash the wrong column count.
 *
 * The parsed object is cached because `getSnapshot` must return a referentially
 * stable value — parsing afresh on every call would return a new object each
 * time and spin the render loop.
 */
const prefsStore = {
  listeners: new Set<() => void>(),
  cachedRaw: null as string | null,
  cachedValue: FALLBACK,

  subscribe(listener: () => void) {
    prefsStore.listeners.add(listener);
    window.addEventListener('storage', listener);
    return () => {
      prefsStore.listeners.delete(listener);
      window.removeEventListener('storage', listener);
    };
  },

  getSnapshot(): Preferences {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return FALLBACK;
    }
    if (raw !== prefsStore.cachedRaw) {
      prefsStore.cachedRaw = raw;
      prefsStore.cachedValue = parsePreferences(raw);
    }
    return prefsStore.cachedValue;
  },

  getServerSnapshot(): Preferences {
    return FALLBACK;
  },

  save(next: Preferences) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Losing the preference costs nothing; the export still works. Cache the
      // value anyway so the control still reflects the click.
      prefsStore.cachedRaw = null;
      prefsStore.cachedValue = next;
    }
    for (const listener of prefsStore.listeners) listener();
  },
};

/**
 * The export control.
 *
 * Column choice, delimiter and encoding are remembered per browser, so a user
 * who always wants the same six columns configures that once. The preference
 * lives in `localStorage` rather than on the account because it is a personal
 * convenience, not a setting anyone else needs to see.
 *
 * The download is a plain link to the CSV endpoint carrying the report's own
 * query string, so the file always matches the filters on screen and the
 * browser handles it as an ordinary download — no blob assembled in the page,
 * and no cap at the rows currently rendered.
 */
export function ExportPanel({
  query,
  rowCount,
}: {
  /** The report page's current filter query string, without a leading `?`. */
  query: string;
  /** How many rows the current filter matches, for the confirmation line. */
  rowCount: number;
}) {
  const [open, setOpen] = useState(false);
  const prefs = useSyncExternalStore(
    prefsStore.subscribe,
    prefsStore.getSnapshot,
    prefsStore.getServerSnapshot,
  );

  const setPrefs = useCallback((update: (previous: Preferences) => Preferences) => {
    prefsStore.save(update(prefsStore.getSnapshot()));
  }, []);

  const href = useMemo(() => {
    const params = new URLSearchParams(query);
    params.delete('page');
    params.set('columns', prefs.columns.join(','));
    params.set('delimiter', prefs.delimiter);
    params.set('bom', prefs.bom ? '1' : '0');
    return `/api/reports/export?${params.toString()}`;
  }, [query, prefs]);

  const toggle = (key: ExportColumnKey) => {
    setPrefs((p) => {
      const has = p.columns.includes(key);
      // Never let the set empty out — an export with no columns is a file of
      // blank lines, and the endpoint would silently substitute the defaults.
      if (has && p.columns.length === 1) return p;
      return {
        ...p,
        columns: has
          ? p.columns.filter((c) => c !== key)
          : // Keep the catalogue order rather than click order, so the file's
            // column order is predictable between exports.
            EXPORT_COLUMNS.map((c) => c.key).filter((c) => c === key || p.columns.includes(c)),
      };
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Settings2 aria-hidden="true" />
        Columns
        <Badge variant="accent" size="sm">
          {prefs.columns.length}
        </Badge>
      </Button>

      <Button asChild>
        {/* A real navigation, so the browser downloads the stream directly. */}
        <a href={href} download>
          <Download aria-hidden="true" />
          Export CSV
        </a>
      </Button>

      {open ? (
        <div className="w-full">
          <div className="mt-2 overflow-hidden rounded-(--radius-card) border border-line bg-surface shadow-raised">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/60 px-5 py-3.5">
              <div className="min-w-0">
                <h2 className="text-[13px] font-bold text-ink">Export preferences</h2>
                <p className="mt-0.5 text-[11.5px] text-ink-3">
                  Remembered in this browser. The file follows the filters above —{' '}
                  <span className="tabular font-semibold text-ink-2">
                    {rowCount.toLocaleString()}
                  </span>{' '}
                  {rowCount === 1 ? 'row' : 'rows'}, not just this page.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPrefs(() => FALLBACK)}>
                  <RotateCcw aria-hidden="true" />
                  Reset
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)}>
                  <X aria-hidden="true" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>
            </div>

            <div className="p-5">
              <fieldset>
                <legend className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                  Columns
                </legend>
                <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                  {EXPORT_COLUMNS.map((column) => {
                    const on = prefs.columns.includes(column.key);
                    const isLast = on && prefs.columns.length === 1;
                    return (
                      <button
                        key={column.key}
                        type="button"
                        onClick={() => toggle(column.key)}
                        aria-pressed={on}
                        disabled={isLast}
                        title={isLast ? 'At least one column is required' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-(--radius-control) border px-3 py-2 text-left text-[12.5px] transition-colors',
                          'disabled:cursor-not-allowed disabled:opacity-70',
                          on
                            ? 'border-nib-gold-500/50 bg-nib-gold-100/60 font-semibold text-ink dark:bg-nib-gold-500/12'
                            : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            on
                              ? 'border-nib-gold-600 bg-nib-gold-500 text-nib-brown-900'
                              : 'border-line-strong',
                          )}
                        >
                          {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 truncate">{column.label}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-5 grid gap-5 border-t border-line pt-5 sm:grid-cols-2">
                <fieldset>
                  <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                    Separator
                  </legend>
                  <div className="flex gap-2">
                    {(
                      [
                        ['comma', 'Comma', 'Standard CSV'],
                        ['semicolon', 'Semicolon', 'Excel, European locales'],
                      ] as const
                    ).map(([value, label, hint]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setPrefs((p) => ({ ...p, delimiter: value }))}
                        aria-pressed={prefs.delimiter === value}
                        className={cn(
                          'flex-1 rounded-(--radius-control) border px-3 py-2.5 text-left transition-colors',
                          prefs.delimiter === value
                            ? 'border-nib-gold-500/50 bg-nib-gold-100/60 dark:bg-nib-gold-500/12'
                            : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        <span className="block text-[12.5px] font-semibold text-ink">{label}</span>
                        <span className="block text-[11px] text-ink-3">{hint}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                    Encoding
                  </legend>
                  <button
                    type="button"
                    onClick={() => setPrefs((p) => ({ ...p, bom: !p.bom }))}
                    aria-pressed={prefs.bom}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-(--radius-control) border px-3 py-2.5 text-left transition-colors',
                      prefs.bom
                        ? 'border-nib-gold-500/50 bg-nib-gold-100/60 dark:bg-nib-gold-500/12'
                        : 'border-line bg-surface hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        prefs.bom
                          ? 'border-nib-gold-600 bg-nib-gold-500 text-nib-brown-900'
                          : 'border-line-strong',
                      )}
                    >
                      {prefs.bom ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-ink">
                        UTF-8 byte-order mark
                      </span>
                      <span className="block text-[11px] text-ink-3">
                        Keeps accented and Amharic text readable in Excel
                      </span>
                    </span>
                  </button>
                </fieldset>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
