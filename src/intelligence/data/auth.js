// Owner session for the Application Intelligence console.
//
// The session token is issued by the server after the owner signs in. It lives in sessionStorage (cleared
// when the tab closes), never in the JavaScript bundle and never persisted across browser restarts. The shared Media Studio
// API key is NOT used by this console.
import { useSyncExternalStore } from 'react';

const KEY = 'ai.session';
const listeners = new Set();

function read() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.token && new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch { return null; }
}

let session = read();
const emit = () => listeners.forEach((l) => l());

export const getToken = () => (session && new Date(session.expiresAt).getTime() > Date.now() ? session.token : null);

export function setSession(token, expiresAt, role = 'owner') {
  session = { token, expiresAt, role };
  try { window.sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* storage blocked: stay signed in for this page only */ }
  emit();
}

export function clearSession() {
  session = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  emit();
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => getToken();
export const useRole = () => useSyncExternalStore(subscribe, () => (getToken() && session.role) || null);
export const useSignedIn = () => Boolean(useSyncExternalStore(subscribe, snapshot));
