// server/services/appIntelligence/uptime.cjs
//
// Uptime per application per day, computed only from recorded checks.
//
//   answered = checks where the app responded (ok, or degraded = responded but slow/unhealthy-reporting)
//   failed   = checks that failed
//   Inconclusive checks and monitoring errors are NOT counted either way (they say nothing about the app).
//   uptime % = answered / (answered + failed), or null when there is nothing to count. A day with no checks is "no data",
//   never 100%. Checks only run when the owner presses Check now / Check all (or on the optional daily schedule),
//   so the percentage describes the checks that happened, not every minute of the day.
'use strict';

const DAY_MS = 86400000;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

function buildUptime({ apps = [], rows = [], days = 30, now = new Date() } = {}) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 30);
  const keys = Array.from({ length: n }, (_, i) => dayKey(now.getTime() - (n - 1 - i) * DAY_MS));
  const byApp = new Map();
  for (const r of rows) {
    const k = typeof r.day === 'string' ? r.day.slice(0, 10) : dayKey(r.day);
    const m = byApp.get(r.application_id) || new Map(); m.set(k, r); byApp.set(r.application_id, m);
  }
  const pct = (a, f) => (a + f > 0 ? Math.round((a / (a + f)) * 1000) / 10 : null);
  const out = apps.map((app) => {
    const m = byApp.get(app.id) || new Map(); let A = 0; let F = 0;
    const daysOut = keys.map((date) => {
      const r = m.get(date); const answered = r ? Number(r.answered) : 0; const failed = r ? Number(r.failed) : 0;
      A += answered; F += failed;
      return { date, answered, failed, uptimePct: pct(answered, failed) };
    });
    return { id: app.id, name: app.name, enabled: app.enabled, checks: A + F, failed: F, uptimePct: pct(A, F), days: daysOut };
  });
  let A = 0; let F = 0; out.forEach((a) => { A += a.checks - a.failed; F += a.failed; });
  return { days: n, from: keys[0], to: keys[keys.length - 1], overall: { checks: A + F, failed: F, uptimePct: pct(A, F) }, applications: out };
}

module.exports = { buildUptime };
