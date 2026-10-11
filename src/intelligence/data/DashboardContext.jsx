import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Holds only dashboard-level refresh state: when the page last refreshed, a
// key that makes every mounted resource reload, and the auto-refresh setting.
// Monitoring data itself lives in useResource, never here.

const DashboardContext = createContext(null);
const PREF_KEY = 'ai.pollMs';
const DEFAULT_POLL_MS = 0; // manual-first: the page re-reads results only when asked

function readPoll() {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw !== null && [0, 300000].includes(Number(raw))) return Number(raw);
  } catch { /* storage unavailable: use default */ }
  return DEFAULT_POLL_MS;
}

export function DashboardProvider({ children }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [pollMs, setPollMsState] = useState(readPoll);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reportLoaded = useCallback((iso) => setLastLoadedAt(iso), []);
  const setPollMs = useCallback((ms) => {
    setPollMsState(ms);
    try { window.localStorage.setItem(PREF_KEY, String(ms)); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ refreshKey, refresh, lastLoadedAt, reportLoaded, pollMs, setPollMs }),
    [refreshKey, refresh, lastLoadedAt, reportLoaded, pollMs, setPollMs]);
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboardClock() {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboardClock must be used inside DashboardProvider');
  return ctx;
}
