// Command Center: presentation helpers for the Open-source Library. Pure, no imports, unit-tested without a browser.

export const LICENSE_META = {
  permissive: { label: 'Permissive', tone: 'ok', help: 'MIT, Apache-2.0, BSD and similar: commercial use is normally fine.' },
  weak_copyleft: { label: 'Weak copyleft', tone: 'info', help: 'LGPL, MPL and similar: changes to the library itself may have to be shared.' },
  strong_copyleft: { label: 'Strong copyleft', tone: 'warn', help: 'GPL or AGPL: may require sharing your own code. Check before using in a product.' },
  source_available: { label: 'Source available', tone: 'warn', help: 'You can read the code but commercial use may be restricted.' },
  unknown: { label: 'Licence not checked', tone: 'neutral', help: 'Nobody has checked the licence yet.' },
};
export const MAINTENANCE_META = {
  active: { label: 'Actively maintained', tone: 'ok' }, slow: { label: 'Slow', tone: 'warn' }, stale: { label: 'Stale', tone: 'bad' }, unknown: { label: 'Maintenance not checked', tone: 'neutral' },
};
export const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Not assessed' };
export const DECISION_META = {
  to_evaluate: { label: 'To evaluate', tone: 'neutral' }, adopt: { label: 'Adopt', tone: 'ok' }, watch: { label: 'Watch', tone: 'info' }, reject: { label: 'Reject', tone: 'bad' },
};
export const DECISION_FILTERS = [{ id: '', label: 'All' }, ...Object.entries(DECISION_META).map(([id, m]) => ({ id, label: m.label }))];

/** What we can honestly say about how trustworthy the facts on a row are. */
export function verification(p) {
  return p.verified
    ? { state: 'verified', tone: 'ok', label: 'Verified', text: `Checked ${p.verifiedAt} · ${p.verifiedSource}` }
    : { state: 'to_verify', tone: 'neutral', label: 'To verify', text: 'Not checked yet. Treat every field as unknown until you add a source and date.' };
}

/** A project's link is shown only when it is a web link (defence in depth: the server also checks). */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? u : '');

export function filterProjects(list, decision) { return decision ? list.filter((p) => p.decision === decision) : list; }
