// server/services/appIntelligence/status.cjs
//
// Pure monitoring rules for the Application Intelligence platform: what a
// check result means, when an incident opens and closes, and how a single
// application status is derived. No I/O here, so every rule is unit-testable
// and the presentation layer never has to re-implement any of it.
'use strict';

// Checks are manual or once a day, so waiting for several consecutive failures (the old 3-in-a-row, which
// assumed a check every few minutes) would mean an outage is only confirmed days later. One failed check is
// already confirmed by an immediate retry inside the check itself (checker.runCheckWithRetry), so a single
// confirmed failure opens an incident and a single good check resolves it. A merely degraded result
// (slow, or the app saying "degraded") never opens an incident.
const FAILURES_TO_OPEN_INCIDENT = 1; // confirmed failed checks before we call it an incident
const SUCCESSES_TO_RESOLVE = 1;      // good checks before we call it recovered
const STALE_AFTER_INTERVALS = 3;     // legacy interval-based staleness (apps with no mode)
const MIN_STALE_SECONDS = 120;
const DAILY_STALE_SECONDS = 36 * 60 * 60; // a daily check that is >36 h old was missed

// How an application is checked.
//   daily        included in the optional daily check (when the owner enables it) and in "Check all"
//   manual       only when the owner clicks Check now / Check all (the default)
//   manual_only  only when the owner clicks Check now on that application. Never in Check all or any schedule.
const MODES = ['daily', 'manual', 'manual_only'];

// Outcome of ONE check.
//   ok            responded as expected
//   degraded      responded, but slow or self-reported as degraded
//   failed        the application did not respond as expected
//   inconclusive  could not be verified (e.g. endpoint needs credentials)
//   monitor_error the monitoring service itself failed; says nothing about the app
const OUTCOMES = ['ok', 'degraded', 'failed', 'inconclusive', 'monitor_error'];

const CHECK_TYPES = {
  homepage: {
    label: 'Homepage reachability',
    limitation: 'Confirms that the registered URL answers. It does not prove the application, its database, or its integrations work, so it is never reported as Healthy.',
  },
  health_endpoint: {
    label: 'Health endpoint',
    limitation: 'Confirms that the dedicated health endpoint answers as expected. It is only as thorough as the checks the application runs behind that endpoint.',
  },
};

// Plain-language text per reason code. Raw error messages are never stored or
// shown, so a stack trace or an internal hostname cannot leak through here.
const REASONS = {
  slow_response: (c) => `Responded, but slower than the ${c.slowMs || 'owner-set'} ms limit the owner configured for this application.`,
  health_reports_degraded: () => 'The health endpoint reports the application as degraded.',
  health_reports_unhealthy: () => 'The health endpoint reports the application as unhealthy.',
  invalid_health_response: () => 'The health endpoint answered, but not with a recognisable JSON status, so health cannot be verified. This is not shown as a failure.',
  unexpected_status: (c) => `Answered with HTTP ${c.httpStatus} instead of the expected ${c.expectedStatus}. The server is responding, so this is not shown as an outage.`,
  http_5xx: (c) => `The application answered with a server error (HTTP ${c.httpStatus}).`,
  not_found: (c) => `The server answered HTTP ${c.httpStatus || 404}: nothing exists at the registered path. The server is responding, so this is not shown as an outage. The registered URL may be wrong or have moved.`,
  client_error: (c) => `The server answered HTTP ${c.httpStatus}, a client-side error for this path. The server is responding, so this is not shown as an outage.`,
  timeout: (c) => `No response within ${Math.round((c.timeoutMs || 0) / 1000) || 'the allowed'} seconds.`,
  dns_failure: () => 'The domain name could not be resolved.',
  connection_refused: () => 'The server refused the connection.',
  connection_reset: () => 'The connection was dropped before a response arrived.',
  tls_error: () => 'The secure (HTTPS) connection could not be established. The certificate may be invalid or expired.',
  redirect_loop: () => 'Too many redirects before reaching a response.',
  auth_required: (c) => `The endpoint answered HTTP ${c.httpStatus} and requires authentication, so health cannot be verified.`,
  blocked_target: () => 'The monitoring service refused to contact this address because it points to a private or internal network. Nothing was sent.',
  network_unreachable: () => 'The network path to the server is unreachable.',
  monitor_no_egress: () => 'The monitoring service could not reach the internet, so this check says nothing about the application.',
  monitor_internal: () => 'The monitoring service hit an internal error while running this check. The application may be fine.',
};

function describeReason(reason, ctx = {}) {
  const fn = REASONS[reason];
  return fn ? fn(ctx) : 'The check did not complete as expected.';
}

function failureWord(count) {
  const words = { 1: 'once', 2: 'twice', 3: 'three times' };
  return words[count] || `${count} times`;
}

function incidentHeadline(count) {
  if (count <= 1) return 'The last check failed, and the immediate retry failed too';
  return `Health check failed ${failureWord(count)} in a row`;
}

/**
 * Fold one check result into an application's running state.
 * `state` = { failStreak, okStreak, failStreakStartedAt }
 * Returns the next state plus what should happen to incidents.
 */
function applyOutcome(state, result, openIncident, now = new Date()) {
  const next = {
    failStreak: state.failStreak || 0,
    okStreak: state.okStreak || 0,
    failStreakStartedAt: state.failStreakStartedAt || null,
  };
  let incident = { action: 'none' };
  const when = result.checkedAt || now;

  if (result.outcome === 'ok') {
    next.failStreak = 0;
    next.failStreakStartedAt = null;
    next.okStreak += 1;
    if (openIncident && next.okStreak >= SUCCESSES_TO_RESOLVE) {
      incident = { action: 'resolve', resolvedAt: when };
    }
  } else if (result.outcome === 'degraded') {
    // Slow or self-reported degraded: not a success, but never an outage and never opens an incident.
    next.okStreak = 0;
  } else if (result.outcome === 'failed') {
    if (next.failStreak === 0) next.failStreakStartedAt = when;
    next.failStreak += 1;
    next.okStreak = 0;
    const severity = 'critical';
    if (openIncident) {
      incident = { action: 'update', lastFailureAt: when, severity, reason: result.reason, failures: next.failStreak };
    } else if (next.failStreak >= FAILURES_TO_OPEN_INCIDENT) {
      incident = {
        action: 'open',
        severity,
        reason: result.reason,
        firstDetectedAt: next.failStreakStartedAt || when,
        lastFailureAt: when,
        failures: next.failStreak,
      };
    }
  }
  // inconclusive / monitor_error: neither evidence of failure nor of recovery.
  return { state: next, incident };
}

function staleAfterSeconds(intervalSeconds) {
  return Math.max(MIN_STALE_SECONDS, (intervalSeconds || 300) * STALE_AFTER_INTERVALS);
}

/** Seconds after which this application's last result counts as stale, or null when it never does (manual). */
function staleLimitSeconds(app) {
  if (app.mode === 'daily') return DAILY_STALE_SECONDS;
  if (app.mode === 'manual' || app.mode === 'manual_only') return null;
  return staleAfterSeconds(app.intervalSeconds);
}

/**
 * Single source of truth for the status shown in the dashboard.
 * Returns { status, monitoringFault, note }.
 *   healthy | degraded | unhealthy | reachable | unknown | stale | paused | pending
 */
function deriveStatus(app, now = new Date()) {
  if (!app.enabled) return { status: 'paused', monitoringFault: false, note: 'Monitoring is paused for this application.' };
  if (!app.lastCheckedAt) return { status: 'pending', monitoringFault: false, note: 'Waiting for the first check.' };

  const ageSeconds = (now.getTime() - new Date(app.lastCheckedAt).getTime()) / 1000;
  // Manual applications are only ever as fresh as the last time the owner checked them; that is shown as
  // "last checked", not flagged as a fault.
  const limit = staleLimitSeconds(app);
  if (limit !== null && ageSeconds > limit) {
    return { status: 'stale', monitoringFault: false, note: 'No recent check. The last known result may be out of date.' };
  }

  switch (app.lastOutcome) {
    case 'monitor_error':
      return { status: 'unknown', monitoringFault: true, note: 'The monitoring service failed to run the last check. This is not an application failure.' };
    case 'inconclusive':
      return { status: 'unknown', monitoringFault: false, note: describeReason(app.lastReason, { httpStatus: app.lastHttpStatus }) };
    case 'failed': {
      const n = app.failStreak || 1;
      // "Unavailable" needs repeated, credible failures. One or two are not yet a conclusion.
      if (n >= FAILURES_TO_OPEN_INCIDENT) return { status: 'unhealthy', monitoringFault: false, suspect: false, note: incidentHeadline(n) };
      return { status: 'unknown', monitoringFault: false, suspect: true, note: `Last check failed (${n} of ${FAILURES_TO_OPEN_INCIDENT} needed to confirm it is unavailable). ${app.lastSummary || ''}`.trim() };
    }
    case 'degraded':
      return { status: 'degraded', monitoringFault: false, note: app.lastSummary || 'Responding, but not at full health.' };
    case 'ok':
      if (app.checkType === 'homepage') {
        return { status: 'reachable', monitoringFault: false, note: 'The URL answers. Homepage checks cannot confirm the application is healthy.' };
      }
      return { status: 'healthy', monitoringFault: false, note: 'The health endpoint answered as expected.' };
    default:
      return { status: 'unknown', monitoringFault: false, note: 'No usable result yet.' };
  }
}

const CYCLE_STALLED_AFTER_SECONDS = DAILY_STALE_SECONDS; // a daily pass that is >36 h old was missed

/**
 * Is the monitoring SERVICE alive? Derived from the completed-cycle time stored in the database.
 *   manual | ok | stalled | never_ran | no_applications
 * `manual` means automatic checks are switched off (the default): nothing is expected to run by itself,
 * so there is nothing to be "stalled".
 */
function monitoringHealth(lastCycleCompletedAt, apps, now = new Date(), { schedule = 'daily' } = {}) {
  if (schedule === 'off') return { state: 'manual', lastCycleCompletedAt: lastCycleCompletedAt || null, ageSeconds: null };
  const enabled = (apps || []).filter((a) => a.enabled && (a.mode === undefined || a.mode === 'daily'));
  if (!enabled.length) return { state: 'no_applications', lastCycleCompletedAt: lastCycleCompletedAt || null, ageSeconds: null };
  if (!lastCycleCompletedAt) {
    const oldest = Math.min(...enabled.map((a) => new Date(a.createdAt || now).getTime()));
    const waited = (now.getTime() - oldest) / 1000;
    // A brand-new deployment legitimately has no cycle for a minute or two.
    return { state: waited > 5 * 60 ? 'never_ran' : 'ok', lastCycleCompletedAt: null, ageSeconds: null };
  }
  const age = Math.round((now.getTime() - new Date(lastCycleCompletedAt).getTime()) / 1000);
  return { state: age > CYCLE_STALLED_AFTER_SECONDS ? 'stalled' : 'ok', lastCycleCompletedAt, ageSeconds: age };
}

const ATTENTION = new Set(['degraded', 'unhealthy', 'stale']);
const needsAttention = (status, monitoringFault, suspect) => ATTENTION.has(status) || Boolean(monitoringFault) || Boolean(suspect);

module.exports = {
  FAILURES_TO_OPEN_INCIDENT,
  SUCCESSES_TO_RESOLVE,
  OUTCOMES,
  CHECK_TYPES,
  describeReason,
  incidentHeadline,
  applyOutcome,
  deriveStatus,
  staleAfterSeconds,
  staleLimitSeconds,
  MODES,
  DAILY_STALE_SECONDS,
  needsAttention,
  monitoringHealth,
  CYCLE_STALLED_AFTER_SECONDS,
};
