import { useEffect, useState, useCallback } from 'react';

// Hash routing: works on static hosting with no server rewrite rules.
//   #/                                  overview
//   #/applications                      applications
//   #/applications/:id                  application details
//   #/health                            system health
//   #/secrets                           secrets & subscriptions
//   #/settings                          settings
// Query parameters after "?" carry list filters, so a filtered view is linkable.

export const PREFIX = '#';

export function parseHash(hash = window.location.hash) {
  const [path, query = ''] = hash.split('?');
  const parts = path.slice(PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
  const params = {};
  new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  return { parts, params };
}

export function hrefTo(path = '', params = {}) {
  const sample = new URLSearchParams(window.location.hash.split('?')[1] || '').get('sample');
  const merged = { ...params, ...(sample ? { sample } : {}) };
  const q = new URLSearchParams(Object.entries(merged).filter(([, v]) => v && v !== 'all')).toString();
  return `${PREFIX}${path}${q ? `?${q}` : ''}`;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((path, params) => { window.location.hash = hrefTo(path, params); }, []);
  // Replace without adding history entries (used while typing in filters).
  const replaceParams = useCallback((params) => {
    const { parts } = parseHash();
    const path = parts.length ? `/${parts.map(encodeURIComponent).join('/')}` : '';
    window.history.replaceState(null, '', hrefTo(path, params));
    setRoute(parseHash());
  }, []);
  return { ...route, navigate, replaceParams };
}
