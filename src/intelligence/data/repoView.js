// Command Center: presentation helpers for repositories. Pure functions, no imports, so they are unit-tested without a browser.
// Three signals are labelled separately and never merged: repository ACTIVITY, DEPLOYMENT and application HEALTH.

export const KIND_LABEL = { application: 'Application', service: 'Service', tool: 'Tool', content: 'Content', archive: 'Archive' };
export const KIND_ORDER = ['application', 'service', 'tool', 'content', 'archive'];

export const PRIORITIES = [
  { value: 'invest', label: 'Invest', tone: 'ok', help: 'Put time and money here: it moves the business forward.' },
  { value: 'maintain', label: 'Maintain', tone: 'info', help: 'Keep it working; no new features.' },
  { value: 'hold', label: 'Hold', tone: 'warn', help: 'Pause. Decide later.' },
  { value: 'retire', label: 'Retire', tone: 'neutral', help: 'Plan to stop using it.' },
];
export const priorityMeta = (p) => PRIORITIES.find((x) => x.value === p) || null;

export const ACTIVITY_META = {
  active: { label: 'Active', tone: 'ok', icon: 'check-circle' },
  recent: { label: 'Recent', tone: 'info', icon: 'clock' },
  dormant: { label: 'Dormant', tone: 'warn', icon: 'pause-circle' },
  archived: { label: 'Archived', tone: 'neutral', icon: 'pause-circle' },
  unknown: { label: 'Unknown', tone: 'neutral', icon: 'help-circle' },
};
export const DEPLOY_META = {
  deployed: { label: 'Deployed', tone: 'ok', icon: 'check-circle' },
  configured: { label: 'Config found', tone: 'info', icon: 'info' },
  failed: { label: 'Failed', tone: 'bad', icon: 'x-circle' },
  none: { label: 'None found', tone: 'neutral', icon: 'help-circle' },
  unknown: { label: 'Unknown', tone: 'neutral', icon: 'help-circle' },
};
// Health comes from the existing checker. Its own status words are reused; two states are added for repositories.
const HEALTH_META = {
  healthy: { label: 'Healthy', tone: 'ok', icon: 'check-circle' },
  degraded: { label: 'Degraded', tone: 'warn', icon: 'alert-triangle' },
  unhealthy: { label: 'Unavailable', tone: 'bad', icon: 'x-circle' },
  reachable: { label: 'Reachable only', tone: 'info', icon: 'globe' },
  unknown: { label: 'Unable to verify', tone: 'neutral', icon: 'help-circle' },
  stale: { label: 'Stale', tone: 'neutral', icon: 'clock' },
  paused: { label: 'Paused', tone: 'neutral', icon: 'pause-circle' },
  pending: { label: 'Awaiting check', tone: 'neutral', icon: 'clock' },
  not_checked: { label: 'Not checked', tone: 'neutral', icon: 'help-circle' },
  not_applicable: { label: 'Not applicable', tone: 'neutral', icon: 'info' },
};
export const healthMeta = (state) => HEALTH_META[state] || HEALTH_META.unknown;

/** "3 days ago" style text from a day count, so the view never needs a clock. */
export function daysText(days) {
  if (days === null || days === undefined) return '';
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export const TYPE_FILTERS = [
  { value: 'all', label: 'All types' }, { value: 'needs_type', label: 'Needs a type' },
  ...KIND_ORDER.map((k) => ({ value: k, label: KIND_LABEL[k] })),
];
export const PRIORITY_FILTERS = [{ value: 'all', label: 'All priorities' }, { value: 'unset', label: 'Not set' }, ...PRIORITIES.map((p) => ({ value: p.value, label: p.label }))];

/** Filters by type (confirmed or suggested), priority and free text (name, purpose, stack). */
export function filterRepos(list, { type = 'all', priority = 'all', q = '' } = {}) {
  const needle = String(q).trim().toLowerCase();
  return list.filter((r) => {
    if (type === 'needs_type' && r.type.confirmed) return false;
    if (type !== 'all' && type !== 'needs_type' && r.type.value !== type) return false;
    if (priority === 'unset' && r.priority) return false;
    if (priority !== 'all' && priority !== 'unset' && r.priority !== priority) return false;
    if (needle && ![r.name, r.fullName, r.purpose.value, ...(r.stack || [])].some((t) => String(t || '').toLowerCase().includes(needle))) return false;
    return true;
  });
}

/** Most recently pushed first; repositories with no push date last. */
export const sortRepos = (list) => [...list].sort((a, b) => (Date.parse(b.activity.pushedAt) || 0) - (Date.parse(a.activity.pushedAt) || 0) || a.name.localeCompare(b.name));

/** A plain-language reading of the three signals together, for the detail page. Never claims more than the evidence shows. */
export function readingOf(r) {
  const act = r.activity.state; const dep = r.deployment.state; const h = r.health.state;
  if (!r.type.confirmed) return 'The type is only a suggestion. Confirm it so the right checks apply.';
  if (r.type.value === 'archive') return 'Archived: no further work expected.';
  if (['tool', 'content'].includes(r.type.value)) return 'Not a running application, so deployment and health do not apply.';
  if (h === 'healthy') return 'The live application is verified healthy.';
  if (h === 'unhealthy') return 'The live application is failing its health check. Look at this first.';
  if (h === 'not_checked' && dep === 'deployed') return 'GitHub shows a deployment, but nothing proves the live app works. Link it to a monitored application and run a check.';
  if (h === 'not_checked' && (act === 'active' || act === 'recent')) return 'The code is being worked on, but nothing proves the live app works. Add the live URL and run a check.';
  if (h === 'not_checked') return 'No health check yet. Link it to a monitored application to get a real signal.';
  return 'Health comes from the existing checker; see the Health panel.';
}
