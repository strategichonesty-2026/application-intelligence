// server/services/appIntelligence/attention.cjs
//
// Command Center Overview: "what needs your attention". One pure function; no database, no network, no clock of its own.
//
// It only RE-READS facts that already exist in this console (monitored-application status, the Secrets & Subscriptions
// register, repository records, the last sync). It never invents a problem and never marks anything fine: an item always
// carries the evidence it came from and when that evidence was read. Credential items show names and statuses only.
'use strict';

const DAY = 86400000;
const LEVEL_RANK = { high: 0, medium: 1, low: 2 };
const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const MAX_ITEMS = 25;

const CRED_TEXT = {
  exposed: ['high', 'is recorded as exposed'],
  rotation_required: ['high', 'needs to be rotated'],
  pending_migration: ['medium', 'has consumers still to migrate'],
};
const APP_STATUS_TEXT = { unhealthy: 'is unavailable', degraded: 'is degraded', stale: 'has no recent check', unknown: 'could not be verified' };

const days = (iso, now) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param input.apps         monitored applications as { id, name, status, monitoringFault, suspect, lastSummary, lastCheckedAt } (status already derived)
 * @param input.credentials  credential records (inventory shape)
 * @param input.credentialReview  inventory.summarizeCredentials(...).needsReview
 * @param input.renewals     inventory.upcomingDates(...) rows
 * @param input.repos        presented repositories (routes/commandCenter presentRepo output)
 * @param input.sync         { configured, last }
 */
function buildAttention({ apps = [], credentials = [], credentialReview = [], renewals = [], repos = [], sync = {} }, now = Date.now()) {
  const items = [];
  const add = (level, id, title, evidence, checkedAt, action, href) => items.push({ id, level, label: LEVEL_LABEL[level], title, evidence, checkedAt: checkedAt || null, action, href });

  // 1. Monitored applications (health comes only from the existing checker)
  for (const a of apps) {
    if (!['unhealthy', 'degraded', 'stale'].includes(a.status) && !a.monitoringFault && !a.suspect) continue;
    const what = a.monitoringFault ? 'the monitoring service had a problem' : APP_STATUS_TEXT[a.status] || 'needs a look';
    add(a.status === 'unhealthy' ? 'high' : 'medium', `app:${a.id}`, `${a.name} ${a.monitoringFault ? 'could not be checked' : what}`, `Health checker: ${a.lastSummary || 'no detail recorded'}`, a.lastCheckedAt, 'Open the application', `/applications/${a.id}`);
  }

  // 2. Credentials (names and statuses recorded by the owner; verification level shown honestly)
  const byId = new Map(credentials.map((c) => [c.id, c]));
  for (const r of credentialReview) {
    const c = byId.get(r.id) || {};
    const [level, text] = CRED_TEXT[r.status] || ['low', 'is due for review'];
    const verified = c.verification === 'verified' ? `verified ${c.lastVerifiedAt || ''}`.trim() : c.verification === 'inferred' ? 'inferred, not verified' : 'not verified';
    add(r.reason === 'review_due' ? 'low' : level, `cred:${r.id}`, `${r.name} ${r.reason === 'review_due' ? 'is due for review' : text}`, `Your Secrets & Subscriptions record (${verified})`, c.updatedAt, 'Open Secrets & Subscriptions', '/secrets');
  }

  // 3. Renewals and trials
  for (const r of renewals) {
    const kind = r.kind === 'trial_end' ? 'trial ends' : 'renews';
    const when = r.overdue ? `${Math.abs(r.daysAway)} day(s) ago (date has passed)` : r.daysAway === 0 ? 'today' : `in ${plural(r.daysAway, 'day', 'days')}`;
    add(r.overdue ? 'medium' : 'low', `renewal:${r.id}:${r.kind}`, `${r.provider}${r.service ? ` ${r.service}` : ''} ${kind} ${when}`, `Your Secrets & Subscriptions record (date ${r.date})`, null, 'Open Secrets & Subscriptions', '/secrets');
  }

  // 4. Repositories
  const live = repos.filter((r) => r.type.value !== 'archive' && r.activity.state !== 'archived');
  const needType = repos.filter((r) => !r.type.confirmed);
  if (needType.length) add('medium', 'repos:need-type', `${plural(needType.length, 'repository needs', 'repositories need')} a confirmed type`, 'Types are suggested from the repository files; only confirmed applications and services are health-checked', needType.map((r) => r.activity.readAt).filter(Boolean).sort().pop(), 'Confirm types', '/applications?type=needs_type');
  for (const r of repos) {
    if (r.priority !== 'invest') continue;
    const runnable = r.type.confirmed && ['application', 'service'].includes(r.type.value);
    if (runnable && r.health.state === 'not_checked') add('medium', `repo:${r.id}:health`, `${r.name} is marked Invest but its health has never been checked`, r.appId ? 'Linked to a monitored application, no check recorded yet' : 'No monitored application is linked to this repository', r.health.lastCheckedAt || r.activity.readAt, 'Add the live URL and run a check', `/applications/${r.id}`);
    if (r.activity.state === 'dormant') add('medium', `repo:${r.id}:dormant`, `${r.name} is marked Invest but has had no push for ${r.activity.days} days`, 'GitHub push date', r.activity.readAt, 'Review the priority', `/applications/${r.id}`);
  }
  const gone = repos.filter((r) => r.missing);
  if (gone.length) add('medium', 'repos:missing', `${plural(gone.length, 'repository is', 'repositories are')} no longer found on GitHub: ${gone.slice(0, 3).map((r) => r.name).join(', ')}${gone.length > 3 ? '…' : ''}`, 'The latest complete sync did not list it. It may have been deleted, moved to another owner, or the token lost access', gone.map((r) => r.activity.readAt).filter(Boolean).sort().pop(), 'Check on GitHub, then archive or retire it here', '/applications');
  const idle = live.filter((r) => r.activity.state === 'dormant' && !r.priority);
  if (idle.length) add('low', 'repos:idle', `${plural(idle.length, 'repository has', 'repositories have')} had no push for 60+ days and no priority`, 'GitHub push dates', idle.map((r) => r.activity.readAt).filter(Boolean).sort().pop(), 'Choose Hold or Retire', '/applications');

  // 5. GitHub sync itself
  const last = sync.last;
  if (!sync.configured) add('low', 'sync:not-configured', 'GitHub is not connected', 'No GITHUB_TOKEN is set on the server, so no repositories are read', null, 'See how to connect', '/settings');
  else if (!last) add('low', 'sync:never', 'Repositories have never been synced', 'No sync has run yet', null, 'Press Sync now', '/applications');
  else if (!last.ok) add('medium', 'sync:failed', 'The last GitHub sync failed', `${(last.errors.find((e) => e.message) || {}).message || 'See the sync status'}. Earlier data is kept.`, last.finishedAt, 'Check the token, then sync again', '/applications');
  else if (now - Date.parse(last.finishedAt) > 7 * DAY) add('low', 'sync:old', `Repositories were last synced ${days(last.finishedAt, now)} days ago`, 'Sync status', last.finishedAt, 'Press Sync now', '/applications');

  items.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  const numbers = {
    repositories: repos.length,
    confirmedApplications: repos.filter((r) => r.type.confirmed && r.type.value === 'application').length,
    pushedLast14Days: repos.filter((r) => r.activity.state === 'active').length,
    needType: needType.length,
  };
  return { items: items.slice(0, MAX_ITEMS), total: items.length, numbers };
}

module.exports = { buildAttention, LEVEL_LABEL, MAX_ITEMS };
