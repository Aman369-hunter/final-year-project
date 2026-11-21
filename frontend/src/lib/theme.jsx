// Light / Dark / System. The choice persists in localStorage (every access is
// wrapped: storage can be blocked or throw in private windows). index.html applies
// the saved theme before first paint; this provider keeps it in sync afterwards.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'lsd-theme';
const ThemeCtx = createContext({ mode: 'system', setMode: () => {} });

export const MODES = ['light', 'dark', 'system'];

function readSaved() {
  try {
    const v = localStorage.getItem(KEY);
    return MODES.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(mode, animate) {
  const root = document.documentElement;
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-anim');
    window.setTimeout(() => root.classList.remove('theme-anim'), 320);
  }
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readSaved);

  useEffect(() => {
    apply(mode, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMode = useCallback((next) => {
    setModeState(next);
    apply(next, true);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice still applies for this page view */
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
