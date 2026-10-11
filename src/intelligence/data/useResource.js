import { useCallback, useEffect, useRef, useState } from 'react';
import { useDashboardClock } from './DashboardContext';

/**
 * Loads data and keeps it fresh without ever blanking the screen.
 *  - `loading` is true only until the first result; later refreshes keep the
 *    previous data on screen (`refreshing`) so tables don't flicker.
 *  - If a refresh fails while data exists, `error` is set AND `data` is kept,
 *    so the UI can say "showing data from 12:01" instead of going blank.
 *  - Changing `deps` (a filter, an id) discards the old data and reloads.
 */
export function useResource(fetcher, deps = [], { poll = true } = {}) {
  const { refreshKey, pollMs, reportLoaded } = useDashboardClock();
  const [state, setState] = useState({ data: null, error: null, loading: true, refreshing: false, loadedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const controllerRef = useRef(null);
  const depKey = JSON.stringify(deps);
  const lastDepKey = useRef(depKey);

  const load = useCallback(async () => {
    if (controllerRef.current) controllerRef.current.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((s) => ({ ...s, refreshing: s.data !== null }));
    try {
      const data = await fetcherRef.current(controller.signal);
      if (controller.signal.aborted) return;
      const loadedAt = new Date().toISOString();
      setState({ data, error: null, loading: false, refreshing: false, loadedAt });
      reportLoaded(loadedAt);
    } catch (error) {
      if (error.name === 'AbortError' || controller.signal.aborted) return;
      setState((s) => ({ ...s, error, loading: false, refreshing: false }));
    }
  }, [reportLoaded]);

  useEffect(() => {
    if (lastDepKey.current !== depKey) {
      lastDepKey.current = depKey;
      setState({ data: null, error: null, loading: true, refreshing: false, loadedAt: null });
    }
    load();
    return () => { if (controllerRef.current) controllerRef.current.abort(); };
  }, [depKey, refreshKey, load]);

  useEffect(() => {
    if (!poll || !pollMs) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    return () => clearInterval(id);
  }, [poll, pollMs, load]);

  return { ...state, reload: load };
}
