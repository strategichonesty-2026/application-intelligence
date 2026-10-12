// server/services/appIntelligence/store.cjs
//
// All SQL for the Application Intelligence platform. Functions take the pg
// pool as an argument so tests can pass a fake and routes stay free of SQL.
'use strict';

const crypto = require('crypto');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_applications (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT NOT NULL DEFAULT '',
    url                   TEXT NOT NULL,
    environment           TEXT NOT NULL DEFAULT 'production',
    check_type            TEXT NOT NULL DEFAULT 'homepage',
    check_path            TEXT NOT NULL DEFAULT '',
    expected_status       INTEGER NOT NULL DEFAULT 200,
    interval_seconds      INTEGER NOT NULL DEFAULT 300,
    timeout_ms            INTEGER NOT NULL DEFAULT 8000,
    slow_threshold_ms     INTEGER,
    enabled               BOOLEAN NOT NULL DEFAULT true,
    last_checked_at       TIMESTAMPTZ,
    last_success_at       TIMESTAMPTZ,
    last_outcome          TEXT,
    last_reason           TEXT,
    last_summary          TEXT,
    last_http_status      INTEGER,
    last_response_ms      INTEGER,
    fail_streak           INTEGER NOT NULL DEFAULT 0,
    ok_streak             INTEGER NOT NULL DEFAULT 0,
    fail_streak_started_at TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE ai_applications ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'manual';
  ALTER TABLE ai_applications ALTER COLUMN slow_threshold_ms DROP NOT NULL;
  ALTER TABLE ai_applications ALTER COLUMN slow_threshold_ms DROP DEFAULT;
  CREATE TABLE IF NOT EXISTS ai_checks (
    id             BIGSERIAL PRIMARY KEY,
    application_id TEXT NOT NULL REFERENCES ai_applications(id) ON DELETE CASCADE,
    checked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    outcome        TEXT NOT NULL,
    reason         TEXT,
    summary        TEXT,
    http_status    INTEGER,
    response_ms    INTEGER,
    trigger        TEXT NOT NULL DEFAULT 'scheduled'
  );
  CREATE INDEX IF NOT EXISTS idx_ai_checks_app_time ON ai_checks(application_id, checked_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_checks_time ON ai_checks(checked_at DESC);
  CREATE TABLE IF NOT EXISTS ai_incidents (
    id                BIGSERIAL PRIMARY KEY,
    application_id    TEXT NOT NULL REFERENCES ai_applications(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'open',
    severity          TEXT NOT NULL,
    reason            TEXT,
    summary           TEXT NOT NULL,
    first_detected_at TIMESTAMPTZ NOT NULL,
    last_failure_at   TIMESTAMPTZ NOT NULL,
    resolved_at       TIMESTAMPTZ,
    failure_count     INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_ai_incidents_app ON ai_incidents(application_id, first_detected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_incidents_open ON ai_incidents(status) WHERE status = 'open';
  -- At most ONE open incident per application, enforced by the database, not just by application code.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_one_open_incident ON ai_incidents(application_id) WHERE status = 'open';
  CREATE TABLE IF NOT EXISTS ai_alerts (
    id              BIGSERIAL PRIMARY KEY,
    dedupe_key      TEXT NOT NULL UNIQUE,
    event           TEXT NOT NULL,
    application_id  TEXT REFERENCES ai_applications(id) ON DELETE SET NULL,
    incident_id     BIGINT,
    subject         TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error      TEXT,
    provider_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_ai_alerts_due ON ai_alerts(next_attempt_at) WHERE status IN ('pending', 'sending');
  CREATE TABLE IF NOT EXISTS ai_service_state (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const SCHEMA_LOCK_KEY = 727001; // arbitrary constant: serialises schema setup across instances

// Idempotent, and serialised across instances: two servers booting together would otherwise race on
// CREATE TABLE IF NOT EXISTS (a known Postgres failure mode). Every statement is additive.
async function initSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_KEY]);
    await client.query(SCHEMA);
    await client.query(require('./inventory.cjs').SCHEMA); // Secrets & Subscriptions inventory (metadata only)
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY]); } finally { client.release(); }
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

function mapApp(r) {
  return {
    id: r.id, name: r.name, description: r.description, url: r.url, environment: r.environment,
    checkType: r.check_type, checkPath: r.check_path, expectedStatus: r.expected_status,
    intervalSeconds: r.interval_seconds, timeoutMs: r.timeout_ms, slowThresholdMs: r.slow_threshold_ms,
    enabled: r.enabled, mode: r.mode || 'manual',
    lastCheckedAt: iso(r.last_checked_at), lastSuccessAt: iso(r.last_success_at),
    lastOutcome: r.last_outcome, lastReason: r.last_reason, lastSummary: r.last_summary,
    lastHttpStatus: r.last_http_status, lastResponseMs: r.last_response_ms,
    failStreak: r.fail_streak, okStreak: r.ok_streak, failStreakStartedAt: iso(r.fail_streak_started_at),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

function mapIncident(r) {
  return {
    id: Number(r.id), applicationId: r.application_id, applicationName: r.application_name,
    status: r.status, severity: r.severity, reason: r.reason, summary: r.summary,
    firstDetectedAt: iso(r.first_detected_at), lastFailureAt: iso(r.last_failure_at),
    resolvedAt: iso(r.resolved_at), failureCount: r.failure_count,
  };
}

const mapCheck = (r) => ({
  id: Number(r.id), applicationId: r.application_id, applicationName: r.application_name,
  checkedAt: iso(r.checked_at), outcome: r.outcome, reason: r.reason, summary: r.summary,
  httpStatus: r.http_status, responseMs: r.response_ms, trigger: r.trigger,
});

async function listApplications(pool) {
  const { rows } = await pool.query('SELECT * FROM ai_applications ORDER BY lower(name)');
  return rows.map(mapApp);
}

async function getApplication(pool, id) {
  const { rows } = await pool.query('SELECT * FROM ai_applications WHERE id = $1', [id]);
  return rows[0] ? mapApp(rows[0]) : null;
}

const COLS = {
  name: 'name', description: 'description', url: 'url', environment: 'environment', checkType: 'check_type',
  checkPath: 'check_path', expectedStatus: 'expected_status', intervalSeconds: 'interval_seconds',
  timeoutMs: 'timeout_ms', slowThresholdMs: 'slow_threshold_ms', enabled: 'enabled', mode: 'mode',
};

async function createApplication(pool, v) {
  const id = `app-${crypto.randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO ai_applications (id, name, description, url, environment, check_type, check_path,
       expected_status, interval_seconds, timeout_ms, slow_threshold_ms, enabled, mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [id, v.name, v.description || '', v.url, v.environment, v.checkType, v.checkPath || '',
      v.expectedStatus, v.intervalSeconds, v.timeoutMs, v.slowThresholdMs, v.enabled !== false, v.mode || 'manual'],
  );
  return mapApp(rows[0]);
}

async function updateApplication(pool, id, v) {
  const sets = []; const params = [id];
  for (const [key, col] of Object.entries(COLS)) {
    if (v[key] !== undefined) { params.push(v[key]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) return getApplication(pool, id);
  // Pointing the check somewhere else makes the old consecutive-failure counts meaningless.
  if (['url', 'checkType', 'checkPath', 'expectedStatus'].some((k) => v[k] !== undefined)) sets.push('fail_streak = 0', 'ok_streak = 0', 'fail_streak_started_at = NULL');
  const { rows } = await pool.query(`UPDATE ai_applications SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  return rows[0] ? mapApp(rows[0]) : null;
}

async function deleteApplication(pool, id) {
  const { rowCount } = await pool.query('DELETE FROM ai_applications WHERE id = $1', [id]);
  return rowCount > 0;
}

async function getOpenIncident(pool, applicationId) {
  const { rows } = await pool.query(
    `SELECT i.*, a.name AS application_name FROM ai_incidents i JOIN ai_applications a ON a.id = i.application_id
     WHERE i.application_id = $1 AND i.status = 'open' ORDER BY i.first_detected_at DESC LIMIT 1`, [applicationId]);
  return rows[0] ? mapIncident(rows[0]) : null;
}

/**
 * Persist one check result and fold it into the application's state, atomically.
 * The application row is locked FOR UPDATE and its CURRENT counters are re-read,
 * so concurrent checks (two instances, a manual click during a scheduled run)
 * queue up instead of overwriting each other. Opening or closing an incident also
 * queues its alert in the same transaction (deduplicated by key).
 * Returns { incident, alertQueued } or null if the application was deleted meanwhile.
 */
async function recordResult(pool, applicationId, result, { trigger = 'scheduled', alertsConfigured = false } = {}) {
  const { applyOutcome } = require('./status.cjs');
  const { buildMessage } = require('./alerts.cjs');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM ai_applications WHERE id = $1 FOR UPDATE', [applicationId]);
    if (!found.rows[0]) { await client.query('ROLLBACK'); return null; }
    const app = mapApp(found.rows[0]);
    const openRow = await client.query(
      `SELECT i.*, a.name AS application_name FROM ai_incidents i JOIN ai_applications a ON a.id = i.application_id
       WHERE i.application_id = $1 AND i.status = 'open' LIMIT 1 FOR UPDATE OF i`, [applicationId]);
    const open = openRow.rows[0] ? mapIncident(openRow.rows[0]) : null;

    const { state: next, incident } = applyOutcome(
      { failStreak: app.failStreak, okStreak: app.okStreak, failStreakStartedAt: app.failStreakStartedAt }, result, open);

    await client.query(
      `INSERT INTO ai_checks (application_id, checked_at, outcome, reason, summary, http_status, response_ms, trigger)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [app.id, result.checkedAt, result.outcome, result.reason, result.summary, result.httpStatus, result.responseMs, trigger]);
    const success = result.outcome === 'ok' || result.outcome === 'degraded';
    await client.query(
      `UPDATE ai_applications SET last_checked_at = $2, last_outcome = $3, last_reason = $4, last_summary = $5,
         last_http_status = $6, last_response_ms = $7, fail_streak = $8, ok_streak = $9, fail_streak_started_at = $10,
         last_success_at = CASE WHEN $11 THEN $2 ELSE last_success_at END
       WHERE id = $1`,
      [app.id, result.checkedAt, result.outcome, result.reason, result.summary, result.httpStatus, result.responseMs,
        next.failStreak, next.okStreak, next.failStreakStartedAt, success]);

    let alert = null;
    const queueAlert = async (event, incidentRow) => {
      const msg = buildMessage(event, { app, incident: incidentRow });
      const status = alertsConfigured ? 'pending' : 'not_configured';
      const ins = await client.query(
        `INSERT INTO ai_alerts (dedupe_key, event, application_id, incident_id, subject, body, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [`incident:${incidentRow.id}:${event}`, event, app.id, incidentRow.id, msg.subject, msg.text, status]);
      alert = { event, queued: ins.rowCount > 0, status };
    };

    if (incident.action === 'open') {
      const ins = await client.query(
        `INSERT INTO ai_incidents (application_id, status, severity, reason, summary, first_detected_at, last_failure_at, failure_count)
         VALUES ($1,'open',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING *`,
        [app.id, incident.severity, incident.reason, result.summary, incident.firstDetectedAt, incident.lastFailureAt, incident.failures]);
      if (ins.rows[0]) await queueAlert('opened', mapIncident({ ...ins.rows[0], application_name: app.name }));
    } else if (incident.action === 'update') {
      await client.query(
        `UPDATE ai_incidents SET last_failure_at = $2, failure_count = $3, reason = $4, summary = $5,
           severity = CASE WHEN severity = 'critical' OR $6 = 'critical' THEN 'critical' ELSE 'warning' END
         WHERE application_id = $1 AND status = 'open'`,
        [app.id, incident.lastFailureAt, incident.failures, incident.reason, result.summary, incident.severity]);
    } else if (incident.action === 'resolve') {
      const upd = await client.query(
        `UPDATE ai_incidents SET status = 'resolved', resolved_at = $2 WHERE application_id = $1 AND status = 'open' RETURNING *`,
        [app.id, incident.resolvedAt]);
      if (upd.rows[0]) await queueAlert('recovered', mapIncident({ ...upd.rows[0], application_name: app.name }));
    }
    await client.query('COMMIT');
    return { incident, alert };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

async function setServiceState(pool, key, value) {
  await pool.query(
    `INSERT INTO ai_service_state (key, value, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [key, value]);
}
async function getServiceState(pool, key) {
  const { rows } = await pool.query('SELECT value, updated_at FROM ai_service_state WHERE key = $1', [key]);
  return rows[0] ? { value: rows[0].value, updatedAt: iso(rows[0].updated_at) } : null;
}

async function pruneChecks(pool, days = 30) {
  await pool.query(`DELETE FROM ai_checks WHERE checked_at < NOW() - ($1 || ' days')::interval`, [String(days)]);
}

const RANGES = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };
const rangeHours = (r) => RANGES[r] || null;

/**
 * Chronological feed for System Health: application incidents plus
 * monitoring-service faults, newest first, filterable and paginated.
 */
async function listTimeline(pool, f) {
  const params = []; const p = (v) => { params.push(v); return `$${params.length}`; };
  const hours = rangeHours(f.range);
  const incWhere = ['1=1']; const monWhere = ["c.outcome = 'monitor_error'"];
  if (f.application) { const x = p(f.application); incWhere.push(`i.application_id = ${x}`); monWhere.push(`c.application_id = ${x}`); }
  if (hours) { const x = p(hours); incWhere.push(`i.last_failure_at >= NOW() - (${x} || ' hours')::interval`); monWhere.push(`c.checked_at >= NOW() - (${x} || ' hours')::interval`); }
  if (f.status) incWhere.push(`i.status = ${p(f.status)}`);
  if (f.severity) incWhere.push(`i.severity = ${p(f.severity)}`);
  const includeApp = f.kind !== 'monitoring';
  const includeMon = f.kind !== 'application' && !f.status && (!f.severity || f.severity === 'warning');

  const parts = [];
  if (includeApp) parts.push(`
    SELECT 'application' AS kind, i.id::text AS id, i.application_id, a.name AS application_name, a.url AS application_url,
           a.environment, i.status, i.severity, i.reason, i.summary, i.first_detected_at AS first_at, i.last_failure_at AS last_at,
           i.resolved_at, i.failure_count
    FROM ai_incidents i JOIN ai_applications a ON a.id = i.application_id WHERE ${incWhere.join(' AND ')}`);
  if (includeMon) parts.push(`
    SELECT 'monitoring' AS kind, 'c' || c.id::text AS id, c.application_id, a.name AS application_name, a.url AS application_url,
           a.environment, 'recorded' AS status, 'warning' AS severity, c.reason, c.summary, c.checked_at AS first_at, c.checked_at AS last_at,
           NULL::timestamptz AS resolved_at, 1 AS failure_count
    FROM ai_checks c JOIN ai_applications a ON a.id = c.application_id WHERE ${monWhere.join(' AND ')}`);
  if (!parts.length) return { items: [], total: 0 };

  const pageSize = Math.min(Math.max(Number(f.pageSize) || 20, 1), 100);
  const page = Math.max(Number(f.page) || 1, 1);
  const union = parts.join(' UNION ALL ');
  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM (${union}) t`, params);
  const lim = p(pageSize); const off = p((page - 1) * pageSize);
  const { rows } = await pool.query(`SELECT * FROM (${union}) t ORDER BY last_at DESC LIMIT ${lim} OFFSET ${off}`, params);
  return {
    total: total.rows[0].n, page, pageSize,
    items: rows.map((r) => ({
      kind: r.kind, id: r.id, applicationId: r.application_id, applicationName: r.application_name,
      applicationUrl: r.application_url, environment: r.environment,
      status: r.status, severity: r.severity, reason: r.reason, summary: r.summary,
      firstDetectedAt: iso(r.first_at), lastFailureAt: iso(r.last_at), resolvedAt: iso(r.resolved_at), failureCount: r.failure_count,
    })),
  };
}

async function latestIncidentByApp(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (application_id) i.*, a.name AS application_name
     FROM ai_incidents i JOIN ai_applications a ON a.id = i.application_id
     ORDER BY application_id, first_detected_at DESC`);
  const map = {}; rows.forEach((r) => { map[r.application_id] = mapIncident(r); });
  return map;
}

async function countOpenIncidents(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ai_incidents WHERE status = 'open'`);
  return rows[0].n;
}

async function recentChecks(pool, { applicationId, limit = 15 } = {}) {
  const params = []; let where = '';
  if (applicationId) { params.push(applicationId); where = 'WHERE c.application_id = $1'; }
  params.push(Math.min(limit, 100));
  const { rows } = await pool.query(
    `SELECT c.*, a.name AS application_name FROM ai_checks c JOIN ai_applications a ON a.id = c.application_id
     ${where} ORDER BY c.checked_at DESC LIMIT $${params.length}`, params);
  return rows.map(mapCheck);
}

async function checkHistory(pool, applicationId, range = '24h') {
  const hours = rangeHours(range) || 24;
  const { rows } = await pool.query(
    `SELECT checked_at, outcome, response_ms, http_status FROM ai_checks
     WHERE application_id = $1 AND checked_at >= NOW() - ($2 || ' hours')::interval ORDER BY checked_at ASC LIMIT 1000`,
    [applicationId, String(hours)]);
  return rows.map((r) => ({ checkedAt: iso(r.checked_at), outcome: r.outcome, responseMs: r.response_ms, httpStatus: r.http_status }));
}

/** Per application per UTC day: how many checks got an answer and how many failed (inconclusive and monitor errors are left out). */
async function uptimeDaily(pool, days = 30) {
  const n = Math.min(Math.max(Number(days) || 30, 1), 30);
  const { rows } = await pool.query(
    `SELECT application_id, to_char(date_trunc('day', checked_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
            COUNT(*) FILTER (WHERE outcome IN ('ok','degraded'))::int AS answered,
            COUNT(*) FILTER (WHERE outcome = 'failed')::int AS failed
     FROM ai_checks WHERE checked_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') - (($1::int - 1) || ' days')::interval) AT TIME ZONE 'UTC'
     GROUP BY 1, 2`, [n]);
  return rows;
}

async function lastCheckRecordedAt(pool) {
  const { rows } = await pool.query('SELECT MAX(checked_at) AS t FROM ai_checks');
  return iso(rows[0].t);
}

module.exports = {
  initSchema, listApplications, getApplication, createApplication, updateApplication, deleteApplication,
  getOpenIncident, recordResult, setServiceState, getServiceState, pruneChecks, listTimeline, latestIncidentByApp, countOpenIncidents,
  recentChecks, checkHistory, uptimeDaily, lastCheckRecordedAt, RANGES,
};
