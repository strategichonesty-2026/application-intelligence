// server/services/appIntelligence/heartbeat.cjs
//
// Independent "dead man's switch". After a monitoring cycle COMPLETES, the
// service pings an external heartbeat URL (e.g. Healthchecks.io, Better Stack,
// UptimeRobot heartbeat). The external service alerts when pings STOP, so the
// monitoring service does not have to be alive to report its own failure.
//
// The URL usually contains a secret token, so it is never logged, returned by
// the API, or included in error text.
'use strict';

const { scrub } = require('./safe.cjs');

const state = { lastSuccessAt: null, lastAttemptAt: null, lastError: null };

function heartbeatConfig(env = process.env) {
  const raw = env.APP_INTELLIGENCE_HEARTBEAT_URL;
  if (!raw) return { configured: false, valid: true };
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && !env.APP_INTELLIGENCE_HEARTBEAT_ALLOW_HTTP) return { configured: true, valid: false, error: 'The heartbeat URL must use https://.' };
    if (u.username || u.password) return { configured: true, valid: false, error: 'The heartbeat URL must not contain a username or password.' };
    return { configured: true, valid: true, url: u.toString() };
  } catch { return { configured: true, valid: false, error: 'The heartbeat URL is not a valid URL.' }; }
}

/** Call only after a cycle succeeded. Never throws; never blocks the scheduler for long. */
async function sendHeartbeat({ env = process.env, fetchImpl = fetch, now = () => new Date() } = {}) {
  const cfg = heartbeatConfig(env);
  if (!cfg.configured) return { sent: false, reason: 'not_configured' };
  state.lastAttemptAt = now().toISOString();
  if (!cfg.valid) { state.lastError = cfg.error; return { sent: false, reason: 'invalid_config', error: cfg.error }; }
  try {
    const res = await fetchImpl(cfg.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { 'user-agent': 'ApplicationIntelligence-Heartbeat/1.0' } });
    if (res.status >= 200 && res.status < 300) { state.lastSuccessAt = state.lastAttemptAt; state.lastError = null; return { sent: true }; }
    state.lastError = `The heartbeat service answered HTTP ${res.status}.`;
    return { sent: false, reason: 'rejected', error: state.lastError };
  } catch (err) {
    state.lastError = `The heartbeat service could not be reached (${scrub(err && err.name === 'TimeoutError' ? 'timed out' : 'network error', env)}).`;
    return { sent: false, reason: 'unreachable', error: state.lastError };
  }
}

const heartbeatStatus = (env = process.env) => {
  const cfg = heartbeatConfig(env);
  return { configured: cfg.configured, valid: cfg.valid, configError: cfg.valid ? null : cfg.error, ...state };
};

module.exports = { sendHeartbeat, heartbeatConfig, heartbeatStatus, _state: state };
