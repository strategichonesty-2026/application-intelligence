// Data access for Application Intelligence. This is the ONLY module that knows
// about URLs, headers or sample fixtures; components receive plain data.
//
// SECURITY: this module reads no secret from the build environment. Anything a front-end build embeds is
// compiled into public JavaScript, so it is not a secret. Requests carry only the owner's short-lived
// session token, obtained by signing in.

import { getToken, setSession, clearSession } from './auth';

// Same origin: this app serves its own API, so there is no cross-site call and no CORS configuration.
// (VITE_API_URL exists only for local development against a separately started server.)
const API = import.meta.env.VITE_API_URL || '';
const BASE = `${API}/api/app-intelligence`;

export class ApiError extends Error {
  // kind: 'auth' | 'notfound' | 'invalid' | 'unavailable'
  constructor(kind, message, details) {
    super(message);
    this.kind = kind;
    this.details = details;
  }
}

// Sample scenarios exist only in development builds (see sample.js). The
// condition is a compile-time constant, so production bundles drop them.
export function sampleScenario() {
  if (!import.meta.env.DEV) return null;
  const q = window.location.hash.split('?')[1] || '';
  return new URLSearchParams(q).get('sample');
}

async function request(path, { method = 'GET', body, signal } = {}) {
  if (import.meta.env.DEV) {
    const scenario = sampleScenario();
    if (scenario) {
      const { handleSample } = await import('./sample.js');
      return handleSample(scenario, method, path, body, signal);
    }
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method, signal,
      headers: { 'Content-Type': 'application/json', ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('unavailable', 'The dashboard could not reach the monitoring API.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (res.ok && json) return json;
  if (res.status === 401 || res.status === 403) { clearSession(); throw new ApiError('auth', 'Your session ended or you are not signed in.'); }
  if (res.status === 503 && json && json.code === 'auth_not_configured') throw new ApiError('unconfigured', json.error);
  if (res.status === 404) throw new ApiError('notfound', (json && json.error) || 'Not found.');
  if (res.status === 400) throw new ApiError('invalid', (json && (json.error || json.message)) || 'The request was not valid.', json && json.errors);
  if (res.status === 429 || res.status === 502) throw new ApiError('invalid', (json && (json.error || json.message)) || 'The request was refused.');
  throw new ApiError('unavailable', (json && json.error) || `The monitoring API answered with an error (HTTP ${res.status}).`);
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== 'all') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Sign in with the owner password. The password is sent once over HTTPS and never stored. */
export async function signIn(password) {
  if (import.meta.env.DEV && sampleScenario()) { setSession('sample-session-token-not-real', new Date(Date.now() + 3600000).toISOString()); return; }
  let res;
  try {
    res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  } catch { throw new ApiError('unavailable', 'The dashboard could not reach the monitoring API.'); }
  let json = null; try { json = await res.json(); } catch { /* not JSON */ }
  if (res.ok && json && json.token) { setSession(json.token, json.expiresAt); return; }
  if (res.status === 401) throw new ApiError('badcredentials', 'That password is not correct.');
  if (res.status === 429) throw new ApiError('ratelimited', (json && json.error) || 'Too many attempts. Try again later.');
  if (res.status === 503) throw new ApiError('unconfigured', (json && json.error) || 'Sign-in is not configured on the server.');
  throw new ApiError('unavailable', 'Sign-in could not be completed. Please try again.');
}
/** Public sign-in help: minimum length and the owner's optional reminder. Never throws (the sign-in works without it). */
export async function fetchSignInHelp() {
  try {
    const res = await fetch(`${BASE}/auth/hint`);
    const json = await res.json();
    return res.ok && json ? { minLength: json.minLength || 16, hint: json.hint || null } : { minLength: 16, hint: null };
  } catch { return { minLength: 16, hint: null }; }
}
export const signOut = () => clearSession();

export const monitoringApi = {
  summary: (signal) => request('/summary', { signal }),
  config: (signal) => request('/config', { signal }),
  applications: (signal) => request('/applications', { signal }),
  application: (id, signal) => request(`/applications/${encodeURIComponent(id)}`, { signal }),
  history: (id, range, signal) => request(`/applications/${encodeURIComponent(id)}/history${qs({ range })}`, { signal }),
  incidents: (filters, signal) => request(`/incidents${qs(filters)}`, { signal }),
  activity: (filters, signal) => request(`/activity${qs(filters)}`, { signal }),
  alertsConfig: (signal) => request('/alerts/config', { signal }),
  alerts: (signal) => request('/alerts', { signal }),
  testAlert: () => request('/alerts/test', { method: 'POST' }),
  register: (values) => request('/applications', { method: 'POST', body: values }),
  update: (id, values) => request(`/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: values }),
  remove: (id) => request(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  inventory: (signal) => request('/inventory', { signal }),
  saveCredential: (id, values) => (id ? request(`/credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body: values }) : request('/credentials', { method: 'POST', body: values })),
  deleteCredential: (id) => request(`/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveSubscription: (id, values) => (id ? request(`/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body: values }) : request('/subscriptions', { method: 'POST', body: values })),
  deleteSubscription: (id) => request(`/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  checkAll: () => request('/check-all', { method: 'POST' }),
  checkNow: (id) => request(`/applications/${encodeURIComponent(id)}/check`, { method: 'POST' }),
};
