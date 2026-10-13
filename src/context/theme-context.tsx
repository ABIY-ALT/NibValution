'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useSyncExternalStore,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const STORAGE_KEY = 'nib-theme';

function getStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    return (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? 'system';
  } catch {
    return 'system';
  }
}

function subscribeStorage(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function applyDomTheme(pref: ThemePreference): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
  document.documentElement.classList.toggle('dark', next === 'dark');
  document.documentElement.style.colorScheme = next;
  return next;
}

/**
 * Light / Dark / System.
 *
 * "System" stores no class and follows the OS, so a user who changes their
 * desktop theme mid-session sees the application follow without reloading.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storePreference = useSyncExternalStore(
    subscribeStorage,
    getStoredPreference,
    () => 'system' as ThemePreference,
  );
  const [preference, setPreferenceState] = useState<ThemePreference>(storePreference);
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const next = applyDomTheme(preference);
    // Queue resolution if needed without triggering synchronous render warning
    const id = requestAnimationFrame(() => setResolved(next));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const stored = getStoredPreference();
      if (stored === 'system') {
        const sysNext = applyDomTheme('system');
        setResolved(sysNext);
      }
    };
    media.addEventListener('change', onChange);
    return () => {
      cancelAnimationFrame(id);
      media.removeEventListener('change', onChange);
    };
  }, [preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // storage disabled
    }
    setPreferenceState(p);
    const next = applyDomTheme(p);
    setResolved(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};

/**
 * Applies the stored theme before first paint to prevent flashes.
 */
export const themeBootstrapScript = `
(function(){try{
  var p = localStorage.getItem('${STORAGE_KEY}') || 'system';
  var d = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', d);
  document.documentElement.style.colorScheme = d ? 'dark' : 'light';
}catch(e){}})();
`;
