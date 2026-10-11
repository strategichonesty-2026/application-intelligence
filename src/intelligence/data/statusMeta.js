// Single mapping from API status values to what the UI shows. Every status has
// a label AND an icon, so colour is never the only signal.

export const STATUS_META = {
  healthy:   { label: 'Healthy',        tone: 'ok',      icon: 'check-circle',  help: 'Verified: a health endpoint answered with an OK status.' },
  degraded:  { label: 'Degraded',       tone: 'warn',    icon: 'alert-triangle', help: 'Verified: the health endpoint reports degraded, or a response-time limit set by the owner was exceeded.' },
  unhealthy: { label: 'Unavailable',    tone: 'bad',     icon: 'x-circle',      help: 'Three or more checks in a row failed (no usable answer, server errors, or a health endpoint reporting unhealthy).' },
  reachable: { label: 'Reachable',      tone: 'info',    icon: 'globe',         help: 'The server responds, but application health is NOT verified. A homepage or login page does not prove the application works.' },
  unknown:   { label: 'Unable to verify', tone: 'neutral', icon: 'help-circle', help: 'The latest check could not give a reliable conclusion (sign-in required, path not found, unreadable health answer, or a first failed check not yet confirmed).' },
  stale:     { label: 'Stale',          tone: 'neutral', icon: 'clock',         help: 'No recent check. The last known result may be out of date.' },
  paused:    { label: 'Paused',         tone: 'neutral', icon: 'pause-circle',  help: 'Monitoring is paused for this application.' },
  pending:   { label: 'Awaiting check', tone: 'neutral', icon: 'clock',         help: 'No check has completed yet.' },
};

export const MONITOR_FAULT_META = {
  label: 'Monitoring issue', tone: 'neutral', icon: 'wrench',
  help: 'The monitoring service failed to run the last check. This does not mean the application is down.',
};

export function statusMetaFor(app) {
  if (app.monitoringFault) return MONITOR_FAULT_META;
  return STATUS_META[app.status] || STATUS_META.unknown;
}

export const ATTENTION_STATUSES = ['degraded', 'unhealthy', 'stale'];
export const needsAttention = (app) => ATTENTION_STATUSES.includes(app.status) || Boolean(app.monitoringFault) || Boolean(app.suspect);

export const STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'degraded', label: 'Degraded' },
  { value: 'unhealthy', label: 'Unavailable' },
  { value: 'reachable', label: 'Reachable only' },
  { value: 'stale', label: 'Stale' },
  { value: 'unknown', label: 'Unable to verify / not checked' },
  { value: 'paused', label: 'Paused' },
];

export function matchesStatusFilter(app, filter) {
  if (filter === 'all') return true;
  if (filter === 'attention') return needsAttention(app);
  if (filter === 'unknown') return app.status === 'unknown' || app.status === 'pending';
  return app.status === filter;
}

// Sort order for the status column: worst first.
export const STATUS_RANK = { unhealthy: 0, degraded: 1, stale: 2, unknown: 3, pending: 4, reachable: 5, paused: 6, healthy: 7 };

export const OUTCOME_META = {
  ok:            { label: 'Passed',         tone: 'ok',      icon: 'check-circle' },
  degraded:      { label: 'Passed, slow or degraded', tone: 'warn', icon: 'alert-triangle' },
  failed:        { label: 'Failed',         tone: 'bad',     icon: 'x-circle' },
  inconclusive:  { label: 'Unable to verify', tone: 'neutral', icon: 'help-circle' },
  monitor_error: { label: 'Monitoring error', tone: 'neutral', icon: 'wrench' },
};

export const SEVERITY_META = {
  critical: { label: 'Critical', tone: 'bad',  icon: 'octagon-alert' },
  warning:  { label: 'Warning',  tone: 'warn', icon: 'alert-triangle' },
};
