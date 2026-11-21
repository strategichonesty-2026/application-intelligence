// Command Center: presentation helpers for the Master Portfolio. Pure, no imports, unit-tested without a browser.

export const TABS = [
  { id: 'all', label: 'All', types: [] },
  { id: 'decision', label: 'Decisions', types: ['decision'] },
  { id: 'risk', label: 'Risks', types: ['risk'] },
  { id: 'opportunity', label: 'Opportunities & ideas', types: ['opportunity', 'idea'] },
  { id: 'issue', label: 'Issues & requirements', types: ['issue', 'requirement'] },
];
export const tabById = (id) => TABS.find((t) => t.id === id) || TABS[0];

export const TYPE_LABEL = { decision: 'Decision', risk: 'Risk', opportunity: 'Opportunity', idea: 'Idea', requirement: 'Requirement', issue: 'Issue' };
export const STATUS_LABEL = { open: 'Open', decided: 'Decided', done: 'Done', dropped: 'Dropped' };
export const LEVEL_META = { high: { label: 'High', tone: 'bad' }, medium: { label: 'Medium', tone: 'warn' }, low: { label: 'Low', tone: 'neutral' } };
export const EVIDENCE_META = {
  verified: { label: 'Verified', tone: 'ok', icon: 'check-circle', help: 'You or the console checked this, with evidence and a date.' },
  inferred: { label: 'Inferred', tone: 'info', icon: 'info', help: 'Reasoned from what is known; not directly checked.' },
  unverified: { label: 'Unverified', tone: 'neutral', icon: 'help-circle', help: 'Not checked.' },
};

export const IMPORT_EXAMPLE = JSON.stringify({
  items: [
    { type: 'decision', title: 'Example: use one database for everything', body: 'Why it was decided.', repoName: 'example-repo', status: 'decided', evidenceLevel: 'inferred', evidence: 'Written in the repo README' },
    { type: 'risk', title: 'Example: a key may be shared too widely', level: 'medium', evidenceLevel: 'unverified' },
  ],
}, null, 2);

/** Reads what the owner pasted. Returns { items } or { error } in plain words. Never throws. */
export function parseImport(text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Paste your records first.' };
  let data; try { data = JSON.parse(t); } catch { return { error: 'That is not valid JSON. Paste a list of records, or use “Insert an example” to see the shape.' }; }
  const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!items) return { error: 'Expected a list of records, or an object with an "items" list.' };
  if (!items.length) return { error: 'The list is empty.' };
  if (items.length > 100) return { error: `That is ${items.length} records. Import at most 100 at a time.` };
  return { items };
}

/** One-line summary of an import preview or result. */
export function importSummary(r) {
  const parts = [`${r.added.length} ${r.dryRun ? 'would be added' : 'added'}`];
  if (r.skipped.length) parts.push(`${r.skipped.length} already there`);
  if (r.invalid.length) parts.push(`${r.invalid.length} with problems`);
  return parts.join(', ');
}

/** Finds the repository record for a name, so the item can link to it. */
export function repoFor(repos, name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? (repos || []).find((r) => r.name.toLowerCase() === n || r.fullName.toLowerCase() === n) || null : null;
}
