// server/services/appIntelligence/monitor.cjs
//
// Orchestrates monitoring. MANUAL FIRST:
//
//  * By default NOTHING runs automatically: no timer, no polling, no per-minute pass. Applications are
//    checked only when the owner clicks "Check now" / "Check all".
//  * An optional once-a-day check can be switched on with APP_INTELLIGENCE_SCHEDULE=daily. It uses one
//    in-process timer (no worker, no extra service) that fires at APP_INTELLIGENCE_DAILY_UTC_HOUR (default 6),
//    checks only applications whose mode is "daily", and remembers when it last ran so a restart does not
//    repeat it. It needs the API process to be running at that hour; if it was not, the next start catches up.
//  * "manual_only" applications (Travel Intelligence Agent) are never included in any of this.
//  * A Postgres advisory lock lets exactly ONE instance run a pass, so scaling to several instances cannot
//    multiply requests to the monitored applications.
//  * No AI/LLM is ever involved in a check: a check is one HTTP request and a rule.
'use strict';

const store = require('./store.cjs');
const { runCheckWithRetry } = require('./checker.cjs');
const alerts = require('./alerts.cjs');
const { sendHeartbeat, heartbeatStatus } = require('./heartbeat.cjs');
const { log } = require('./safe.cjs');

const TICK_LOCK_KEY = 727002;
const MAX_PARALLEL_CHECKS = 3; // each in-flight record holds one pool connection; the pass itself holds one more
const MANUAL_COOLDOWN_MS = 10 * 1000;        // per application
const CHECK_ALL_COOLDOWN_MS = 30 * 1000;     // whole-fleet check
const CATCH_UP_AFTER_MS = 25 * 60 * 60 * 1000;
const MIN_GAP_BETWEEN_PASSES_MS = 12 * 60 * 60 * 1000; // a restart, a second instance or a catch-up can never repeat a pass
const state = { running: false, stopping: false, timer: null, current: null, startedAt: null, lastTickAt: null, lastSkippedAt: null, lastCycleCompletedAt: null, lastTickError: null, lastCheckAllAt: 0, inFlight: new Set() };

/** Reads the schedule settings. Anything other than exactly "daily" means OFF. */
function scheduleConfig(env = process.env) {
  const mode = String(env.APP_INTELLIGENCE_SCHEDULE || 'off').trim().toLowerCase() === 'daily' ? 'daily' : 'off';
  const raw = env.APP_INTELLIGENCE_DAILY_UTC_HOUR;
  const n = raw === undefined || raw === '' ? 6 : Number(raw);
  const hourUtc = Number.isInteger(n) && n >= 0 && n <= 23 ? n : 6;
  return { mode, hourUtc };
}

/** Next occurrence (ms epoch) of `hourUtc`:00 UTC strictly after `now`. */
function nextRunAt(now, hourUtc) {
  const d = new Date(now); d.setUTCMinutes(0, 0, 0); d.setUTCHours(hourUtc);
  let t = d.getTime();
  if (t <= now) t += 24 * 60 * 60 * 1000;
  return t;
}

async function checkApplication(pool, app, { trigger = 'scheduled', allowPrivate = false, check = runCheckWithRetry, alertsConfigured } = {}) {
  const result = await check(app, { allowPrivate });
  const configured = alertsConfigured !== undefined ? alertsConfigured : alerts.anyChannelConfigured();
  await store.recordResult(pool, app.id, result, { trigger, alertsConfigured: configured });
  return result;
}

/** Which applications the daily pass checks: enabled and explicitly set to "daily". */
const isDaily = (app) => app.enabled && app.mode === 'daily';
/** Which applications "Check all" covers: enabled and not manual-only. */
const isEligibleForCheckAll = (app) => app.enabled && app.mode !== 'manual_only';

async function mapLimit(items, limit, fn) {
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]); }
  }));
  return results;
}

/**
 * Owner-triggered check of every eligible application ("Check all"). Never includes manual-only
 * applications. Returns { cooldown } (seconds) instead of running when called again too soon.
 */
async function checkAll(pool, { allowPrivate = false, check, env = process.env, provider = alerts.createNotifier({ env }), now = Date.now() } = {}) {
  const wait = CHECK_ALL_COOLDOWN_MS - (now - state.lastCheckAllAt);
  if (wait > 0) return { cooldownSeconds: Math.ceil(wait / 1000) };
  state.lastCheckAllAt = now;
  const apps = (await store.listApplications(pool)).filter(isEligibleForCheckAll);
  const alertsConfigured = alerts.anyChannelConfigured(env);
  const results = await mapLimit(apps, MAX_PARALLEL_CHECKS, async (a) => {
    if (state.inFlight.has(a.id)) return { id: a.id, name: a.name, skipped: 'already being checked' };
    if (a.lastCheckedAt && now - new Date(a.lastCheckedAt).getTime() < MANUAL_COOLDOWN_MS) return { id: a.id, name: a.name, skipped: 'checked a few seconds ago' };
    state.inFlight.add(a.id);
    try {
      const r = await checkApplication(pool, a, { trigger: 'manual', allowPrivate, check, alertsConfigured });
      return { id: a.id, name: a.name, outcome: r.outcome, summary: r.summary };
    } catch (err) { log.error(`check ${a.id} could not be recorded`, err); return { id: a.id, name: a.name, error: 'could not be recorded' }; }
    finally { state.inFlight.delete(a.id); }
  });
  try { await alerts.dispatchDue(pool, provider); } catch (err) { log.error('alert dispatch', err); }
  return { results };
}

/**
 * One automatic pass (the daily check, also usable directly by tests). Checks "daily" applications only.
 * Returns { skipped } when another instance holds the lock, otherwise { ok, checked, failedToRecord }.
 */
async function tick(pool, opts = {}) {
  const { allowPrivate = false, check, env = process.env, provider = alerts.createNotifier({ env }), heartbeat = sendHeartbeat, minGapMs = MIN_GAP_BETWEEN_PASSES_MS } = opts;
  let client;
  try { client = await pool.connect(); } catch (err) { state.lastTickError = 'database unavailable'; log.error('tick', err); return { ok: false, error: 'database' }; }
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS got', [TICK_LOCK_KEY]);
    if (!lock.rows[0].got) { state.lastSkippedAt = new Date().toISOString(); return { skipped: true }; }
    const now = Date.now();
    // The previous pass is recorded in the database, so this holds across restarts and across instances.
    const prev = await store.getServiceState(pool, 'last_cycle_completed_at');
    if (prev && prev.value && now - new Date(prev.value).getTime() < minGapMs) return { skipped: true, reason: 'recent' };
    state.lastTickAt = new Date(now).toISOString();
    let failedToRecord = 0; let checked = 0;
    try {
      const apps = await store.listApplications(pool);
      const due = apps.filter((a) => isDaily(a) && !state.inFlight.has(a.id));
      const alertsConfigured = alerts.anyChannelConfigured(env);
      await mapLimit(due, MAX_PARALLEL_CHECKS, async (a) => {
        if (state.stopping) return;
        state.inFlight.add(a.id);
        try { await checkApplication(pool, a, { allowPrivate, check, alertsConfigured }); checked += 1; }
        catch (err) { failedToRecord += 1; log.error(`check ${a.id} could not be recorded`, err); }
        finally { state.inFlight.delete(a.id); }
      });
      try { await alerts.dispatchDue(pool, provider); } catch (err) { log.error('alert dispatch', err); }
      try { await store.pruneChecks(pool, 30); } catch (err) { log.error('prune', err); } // once per daily pass

      if (failedToRecord === 0) {
        state.lastCycleCompletedAt = new Date().toISOString();
        state.lastTickError = null;
        await store.setServiceState(pool, 'last_cycle_completed_at', state.lastCycleCompletedAt);
        // Heartbeat strictly AFTER a completed pass: if passes stop completing, pings stop.
        await heartbeat({ env });
        return { ok: true, checked };
      }
      state.lastTickError = 'some checks could not be recorded';
      return { ok: false, checked, failedToRecord };
    } catch (err) {
      state.lastTickError = 'cycle failed';
      log.error('cycle', err);
      return { ok: false, error: 'cycle' };
    }
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [TICK_LOCK_KEY]); } catch { /* connection closed: lock released with it */ }
    client.release();
  }
}

/**
 * Starts the optional daily check. Returns false (and creates NO timer) unless APP_INTELLIGENCE_SCHEDULE=daily.
 */
function start(pool, opts = {}) {
  const cfg = scheduleConfig(opts.env || process.env);
  if (state.running || cfg.mode !== 'daily') return false;
  state.running = true; state.stopping = false; state.startedAt = new Date().toISOString();
  const allowPrivate = (opts.env || process.env).APP_INTELLIGENCE_ALLOW_PRIVATE === 'true';
  const arm = () => {
    if (state.stopping) return;
    const delay = Math.max(1000, nextRunAt(Date.now(), cfg.hourUtc) - Date.now());
    state.timer = setTimeout(async () => {
      state.current = tick(pool, { allowPrivate, ...opts }).catch((err) => log.error('tick', err));
      await state.current;
      arm();
    }, delay);
    state.timer.unref();
  };
  arm();
  // The process may have been down at the scheduled hour. Catch up once if the last completed pass is old.
  store.getServiceState(pool, 'last_cycle_completed_at').then((row) => {
    const last = row && row.value ? new Date(row.value).getTime() : 0;
    if (!state.stopping && Date.now() - last > CATCH_UP_AFTER_MS) {
      const t = setTimeout(() => { state.current = tick(pool, { allowPrivate, ...opts }).catch((err) => log.error('tick', err)); }, 30 * 1000);
      t.unref();
    }
  }).catch(() => { /* table not ready: the scheduled run still happens */ });
  return true;
}

function stop() { if (state.timer) clearTimeout(state.timer); state.timer = null; state.running = false; }

/** Graceful shutdown: stop scheduling, let the pass in progress finish (bounded), release the lock. */
async function stopAndDrain(maxMs = 8000) {
  state.stopping = true; stop();
  if (state.current) await Promise.race([state.current, new Promise((r) => setTimeout(r, maxMs).unref())]);
}

const status = (env = process.env) => {
  const cfg = scheduleConfig(env);
  return {
    schedule: cfg.mode, dailyUtcHour: cfg.mode === 'daily' ? cfg.hourUtc : null,
    nextAutomaticRunAt: state.running && state.timer ? new Date(nextRunAt(Date.now(), cfg.hourUtc)).toISOString() : null,
    running: state.running, lastTickAt: state.lastTickAt, lastCycleCompletedAt: state.lastCycleCompletedAt,
    lastTickError: state.lastTickError, heartbeat: heartbeatStatus(),
  };
};

module.exports = { MIN_GAP_BETWEEN_PASSES_MS, checkApplication, checkAll, tick, start, stop, stopAndDrain, status, scheduleConfig, nextRunAt, isDaily, isEligibleForCheckAll, MANUAL_COOLDOWN_MS, CHECK_ALL_COOLDOWN_MS, TICK_LOCK_KEY };
