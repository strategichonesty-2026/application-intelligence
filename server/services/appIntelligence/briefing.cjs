// server/services/appIntelligence/briefing.cjs
//
// The "What's wrong?" assistant. It is NOT an AI: it reads the owner's own records (checks, credential register,
// subscription register) and applies fixed rules, so it costs nothing, never calls an outside service, and always
// gives the same answer for the same data. It only reports what the records show, and says so when it has nothing.
//
// Severity:  critical  = act now (an app is confirmed down, or a key is recorded as exposed)
//            attention = do soon (slow/unchecked apps, keys due for rotation or review, renewals close or overdue)
//            info      = good to know (gaps in the records, such as keys nobody has verified)
'use strict';

const { deriveStatus } = require('./status.cjs');
const { summarizeCredentials, upcomingDates } = require('./inventory.cjs');

const RANK = { critical: 0, attention: 1, info: 2 };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function appItems(apps, now) {
  const out = [];
  for (const a of apps) {
    const d = deriveStatus(a, now);
    const base = { area: 'apps', target: a.name };
    if (d.status === 'paused') continue;
    if (d.status === 'unhealthy') out.push({ ...base, severity: 'critical', title: `${a.name} is down`, detail: d.note, action: 'Open the app and check its host (Railway, Vercel or Cloudflare). Then click "Check now" on the Applications page.' });
    else if (d.monitoringFault) out.push({ ...base, severity: 'attention', title: `The last check of ${a.name} could not run`, detail: 'This is a problem with the monitoring, not necessarily the app.', action: 'Click "Check now" again. If it keeps happening, look at System Health.' });
    else if (d.suspect) out.push({ ...base, severity: 'attention', title: `${a.name} failed its last check`, detail: d.note, action: 'Click "Check now" to confirm. One failure is not yet proof it is down.' });
    else if (d.status === 'degraded') out.push({ ...base, severity: 'attention', title: `${a.name} is slow or degraded`, detail: d.note, action: 'Open the app and see if it still works for you.' });
    else if (d.status === 'stale') out.push({ ...base, severity: 'attention', title: `${a.name} has not been checked recently`, detail: 'The last result may be out of date.', action: 'Click "Check all".' });
    else if (d.status === 'pending') out.push({ ...base, severity: 'attention', title: `${a.name} has never been checked`, detail: 'Nothing is known about it yet.', action: 'Click "Check now" on the Applications page.' });
    else if (d.status === 'unknown') out.push({ ...base, severity: 'info', title: `${a.name}: the last check could not tell`, detail: d.note, action: 'Open the app yourself, or check the address in Settings.' });
  }
  return out;
}

function keyItems(credentials, now) {
  const out = []; const sum = summarizeCredentials(credentials, now);
  for (const c of credentials) {
    if (c.status === 'exposed') out.push({ area: 'keys', severity: 'critical', target: c.name, title: `Key "${c.name}" is recorded as exposed`, detail: c.purpose || '', action: c.rotationStep || 'Replace this key at the provider, update the apps that use it, then record the date here.' });
  }
  for (const r of sum.needsReview) {
    if (r.status === 'exposed') continue;
    const why = r.reason === 'rotation_required' ? 'is marked as needing rotation' : r.reason === 'pending_migration' ? 'is still waiting to be moved to a safe place' : 'is due for review';
    out.push({ area: 'keys', severity: 'attention', target: r.name, title: `Key "${r.name}" ${why}`, detail: '', action: 'Open Secrets & Subscriptions, then Credentials, and follow the rotation step.' });
  }
  const unverified = credentials.filter((c) => c.status !== 'revoked' && c.verification === 'unknown').length;
  if (unverified) out.push({ area: 'keys', severity: 'info', title: `${plural(unverified, 'key has', 'keys have')} never been checked`, detail: 'Their status and where they are used are still guesses.', action: 'Open each one and fill in what you confirmed, with a date.' });
  return out;
}

function moneyItems(subscriptions, now) {
  const out = [];
  for (const u of upcomingDates(subscriptions, now, 7)) {
    const what = `${u.provider}${u.service ? ` ${u.service}` : ''}`;
    const when = u.overdue ? `${Math.abs(u.daysAway)} day(s) ago (date has passed)` : u.daysAway === 0 ? 'today' : `in ${plural(u.daysAway, 'day', 'days')}`;
    out.push({ area: 'money', severity: 'attention', target: what, title: `${what} ${u.kind === 'trial_end' ? 'trial ends' : 'renews'} ${when}`, detail: '', action: u.kind === 'trial_end' ? 'Decide now: keep it or cancel it.' : 'Check the price is what you expect, or cancel before the date.' });
  }
  const active = subscriptions.filter((s) => s.status === 'active');
  const noPrice = active.filter((s) => s.billingFrequency !== 'free' && s.billingFrequency !== 'usage' && (s.price === null || s.priceBasis === 'unknown')).length;
  if (noPrice) out.push({ area: 'money', severity: 'info', title: `${plural(noPrice, 'subscription has', 'subscriptions have')} no price recorded`, detail: 'You cannot see your real monthly cost until these are filled in.', action: 'Open the Subscriptions tab and add the price from your latest bill.' });
  const usage = active.filter((s) => s.billingFrequency === 'usage' && (s.capStatus === 'unknown' || s.capStatus === 'unverified' || !s.spendingCap)).length;
  if (usage) out.push({ area: 'money', severity: 'info', title: `${plural(usage, 'pay-as-you-go service has', 'pay-as-you-go services have')} no confirmed spending limit`, detail: 'Usage-based bills can grow without warning.', action: 'Set a monthly cap at the provider, then record it here.' });
  const unknown = subscriptions.filter((s) => s.status === 'unknown').length;
  if (unknown) out.push({ area: 'money', severity: 'info', title: `${plural(unknown, 'service is', 'services are')} listed but you have not said if you pay for it`, detail: '', action: 'Mark each one Active or Cancelled.' });
  return out;
}

const TOPICS = [
  ['money', /\b(money|cost|costs|pay|paying|paid|bill|bills|billing|subscription|subscriptions|renew|renews|renewal|price|spend|spending|cancel)\b/i],
  ['keys', /\b(key|keys|credential|credentials|secret|secrets|password|passwords|token|tokens|rotate|rotation|hack|hacked|exposed|leak)\b/i],
  ['apps', /\b(app|apps|application|applications|down|up|site|sites|server|servers|website|online|offline|outage|slow|status)\b/i],
];
function topicOf(question) {
  const q = String(question || '');
  for (const [name, re] of TOPICS) if (re.test(q)) return name;
  return 'all';
}

/** Builds the full, sorted list of findings. Pure: takes plain records and the clock. */
function buildBriefing({ apps = [], credentials = [], subscriptions = [], now = new Date() } = {}) {
  const items = [...appItems(apps, now), ...keyItems(credentials, now.getTime()), ...moneyItems(subscriptions, now.getTime())];
  items.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const counts = { critical: 0, attention: 0, info: 0 };
  items.forEach((i) => { counts[i.severity] += 1; });
  const lastChecked = apps.map((a) => a.lastCheckedAt).filter(Boolean).sort().pop() || null;
  return { generatedAt: now.toISOString(), items, counts, lastChecked, appCount: apps.length };
}

/** Picks the part of the briefing the question is about and words it plainly. */
function answer(question, briefing) {
  const topic = topicOf(question);
  const items = topic === 'all' ? briefing.items : briefing.items.filter((i) => i.area === topic);
  const counts = { critical: 0, attention: 0, info: 0 };
  items.forEach((i) => { counts[i.severity] += 1; });
  const where = { all: 'across your apps, keys and subscriptions', apps: 'with your apps', keys: 'with your keys', money: 'with your subscriptions' }[topic];
  let level; let headline;
  if (counts.critical) { level = 'critical'; headline = `Critical: ${plural(counts.critical, 'thing needs', 'things need')} you now.`; }
  else if (counts.attention) { level = 'attention'; headline = `${plural(counts.attention, 'thing needs', 'things need')} attention ${where}. Nothing is on fire.`; }
  else if (counts.info) { level = 'ok'; headline = `Nothing urgent ${where}. ${plural(counts.info, 'gap', 'gaps')} in your records, listed below.`; }
  else { level = 'ok'; headline = `I see nothing wrong ${where}.`; }
  const notes = [];
  if ((topic === 'all' || topic === 'apps') && briefing.appCount === 0) notes.push('No apps are registered yet, so I cannot say anything about them.');
  if ((topic === 'all' || topic === 'apps') && briefing.appCount > 0) notes.push(briefing.lastChecked ? `Apps are only checked when you click "Check all" (or on the daily schedule if you turned it on). The newest check I have is from ${briefing.lastChecked}.` : 'No app has been checked yet.');
  notes.push('I only know what is in your records. "Nothing wrong" means nothing recorded is wrong, not a promise that everything works.');
  return { topic, level, headline, counts, items, notes, generatedAt: briefing.generatedAt };
}

module.exports = { buildBriefing, answer, topicOf };
