// test_appIntelligence_db.cjs
// Integration tests that need a REAL Postgres: concurrency, incident dedupe,
// alert outbox, retries, schema-init races. SKIPPED unless AI_TEST_DATABASE_URL is set.
//   AI_TEST_DATABASE_URL=postgres://user@localhost:5432/scratch node test_appIntelligence_db.cjs
// Use a scratch database: the test creates and DROPS the ai_* tables.
const url = process.env.AI_TEST_DATABASE_URL;
if (!url) { console.log('SKIPPED: set AI_TEST_DATABASE_URL to a scratch database to run the DB integration tests.'); process.exit(0); }
const http = require('http');
const { Pool } = require('pg');
const store = require('./server/services/appIntelligence/store.cjs');
const monitor = require('./server/services/appIntelligence/monitor.cjs');
const alerts = require('./server/services/appIntelligence/alerts.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const q = async (pool, sql, p) => (await pool.query(sql, p)).rows;
const fail = async () => ({ outcome: 'failed', reason: 'timeout', summary: 'No response within 8 seconds.', httpStatus: null, responseMs: null, checkedAt: new Date() });
const pass = async () => ({ outcome: 'ok', reason: null, summary: null, httpStatus: 200, responseMs: 20, checkedAt: new Date() });
const newApp = (pool, name) => store.createApplication(pool, { name, url: 'https://x.test/', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 60, timeoutMs: 1000, slowThresholdMs: 2000 });
const run = (pool, id, check, extra = {}) => store.getApplication(pool, id).then((a) => monitor.checkApplication(pool, a, { check, alertsConfigured: true, ...extra }));

(async () => {
  const pool = new Pool({ connectionString: url, max: 12 });
  await pool.query('DROP TABLE IF EXISTS ai_alerts, ai_service_state, ai_checks, ai_incidents, ai_applications CASCADE');

  // ── schema init: idempotent, and safe when several instances boot at once ──
  await Promise.all(Array.from({ length: 6 }, () => store.initSchema(pool)));
  await store.initSchema(pool);
  assert((await q(pool, "SELECT count(*)::int n FROM information_schema.tables WHERE table_name LIKE 'ai\\_%'"))[0].n === 7, 'init: 6 concurrent initialisations + a re-run succeed; exactly 7 tables (5 monitoring + 2 inventory)');
  assert((await q(pool, "SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'uq_ai_one_open_incident'"))[0].n === 1, 'init: one-open-incident unique index exists');

  // ── upgrade path: an older database whose slow_threshold_ms was NOT NULL DEFAULT 2000 ──
  await pool.query('UPDATE ai_applications SET slow_threshold_ms = 2000'); // (no rows yet; harmless)
  await pool.query('ALTER TABLE ai_applications ALTER COLUMN slow_threshold_ms SET DEFAULT 2000');
  await pool.query('ALTER TABLE ai_applications ALTER COLUMN slow_threshold_ms SET NOT NULL');
  await Promise.all([store.initSchema(pool), store.initSchema(pool)]);
  const nullable = await q(pool, "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='ai_applications' AND column_name='slow_threshold_ms'");
  assert(nullable[0].is_nullable === 'YES' && nullable[0].column_default === null, 'upgrade: re-running init on an older schema makes the slow-response limit optional with no default');
  const noLimit = await store.createApplication(pool, { name: 'NoLimit', url: 'https://x.test/', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 60, timeoutMs: 1000, slowThresholdMs: null });
  assert((await store.getApplication(pool, noLimit.id)).slowThresholdMs === null, 'upgrade: an application can be stored with NO response-time limit');
  await pool.query('DELETE FROM ai_applications');

  // ── threshold + dedupe + recovery ──
  const a = await newApp(pool, 'Lifecycle');
  await run(pool, a.id, fail); await run(pool, a.id, fail);
  assert((await q(pool, 'SELECT * FROM ai_incidents')).length === 1 && (await q(pool, 'SELECT * FROM ai_alerts')).length === 1, 'lifecycle: the 1st failure opens an incident, and the 2nd adds no second incident or alert');
  await run(pool, a.id, fail);
  let inc = await q(pool, "SELECT * FROM ai_incidents WHERE application_id = $1", [a.id]);
  let al = await q(pool, 'SELECT * FROM ai_alerts WHERE application_id = $1', [a.id]);
  assert(inc.length === 1 && inc[0].status === 'open' && inc[0].failure_count === 3, 'lifecycle: repeated failures update exactly one incident');
  assert(al.length === 1 && al[0].event === 'opened' && al[0].status === 'pending' && al[0].dedupe_key === `incident:${inc[0].id}:opened`, 'lifecycle: one "opened" alert queued, keyed to the incident');
  for (let i = 0; i < 5; i++) await run(pool, a.id, fail);
  assert((await q(pool, "SELECT * FROM ai_incidents WHERE application_id = $1", [a.id])).length === 1 && (await q(pool, 'SELECT * FROM ai_alerts WHERE application_id = $1', [a.id])).length === 1, 'dedupe: 5 more failures => still 1 incident and 1 alert');
  await run(pool, a.id, pass);
  assert((await q(pool, "SELECT status FROM ai_incidents WHERE application_id = $1", [a.id]))[0].status === 'resolved', 'recovery: one passing check closes the incident');
  await run(pool, a.id, pass);
  inc = await q(pool, "SELECT * FROM ai_incidents WHERE application_id = $1", [a.id]);
  al = await q(pool, 'SELECT * FROM ai_alerts WHERE application_id = $1 ORDER BY id', [a.id]);
  assert(inc[0].status === 'resolved' && inc[0].resolved_at && al.length === 2 && al[1].event === 'recovered', 'recovery: it stays resolved and exactly ONE "recovered" alert was queued');
  await run(pool, a.id, pass); await run(pool, a.id, pass);
  assert((await q(pool, 'SELECT * FROM ai_alerts WHERE application_id = $1', [a.id])).length === 2, 'recovery: further passes queue nothing');
  for (let i = 0; i < 3; i++) await run(pool, a.id, fail);
  assert((await q(pool, "SELECT * FROM ai_incidents WHERE application_id = $1", [a.id])).length === 2 && (await q(pool, 'SELECT * FROM ai_alerts WHERE application_id = $1', [a.id])).length === 3, 'dedupe: a NEW outage is a new incident with its own alert');

  // ── the reproduced defect: concurrent checks ──
  const b = await newApp(pool, 'Concurrent');
  await pool.query('UPDATE ai_applications SET fail_streak = 2, fail_streak_started_at = NOW() WHERE id = $1', [b.id]);
  const stale = await store.getApplication(pool, b.id);
  await Promise.all(Array.from({ length: 6 }, () => monitor.checkApplication(pool, stale, { check: fail, alertsConfigured: true })));
  assert((await q(pool, "SELECT count(*)::int n FROM ai_incidents WHERE application_id = $1 AND status = 'open'", [b.id]))[0].n === 1, 'concurrency: 6 overlapping failing checks on streak 2 => exactly ONE open incident');
  assert((await q(pool, "SELECT count(*)::int n FROM ai_alerts WHERE application_id = $1", [b.id]))[0].n === 1, 'concurrency: and exactly ONE alert');
  const c1 = await newApp(pool, 'ColdStart');
  await Promise.all(Array.from({ length: 6 }, () => run(pool, c1.id, fail)));
  assert((await store.getApplication(pool, c1.id)).failStreak === 6, 'concurrency: 6 overlapping checks from a cold start are all counted (no lost updates)');
  let threw = false; try { await pool.query("INSERT INTO ai_incidents (application_id, status, severity, summary, first_detected_at, last_failure_at) VALUES ($1,'open','critical','dup', NOW(), NOW())", [b.id]); } catch { threw = true; }
  assert(threw, 'database: a second open incident for the same application is rejected by the unique index');
  const gone = await newApp(pool, 'Deleted');
  assert((await store.recordResult(pool, 'app-doesnotexist', await pass())) === null, 'concurrency: a check for an application deleted meanwhile is dropped cleanly');

  // ── alerts not configured: recorded honestly, never pretended ──
  const d = await newApp(pool, 'NoEmail');
  for (let i = 0; i < 3; i++) await run(pool, d.id, fail, { alertsConfigured: false });
  assert((await q(pool, 'SELECT status FROM ai_alerts WHERE application_id = $1', [d.id]))[0].status === 'not_configured', 'alerts: unconfigured email is recorded as not_configured, not sent');
  assert((await alerts.dispatchDue(pool, { send: async () => { throw new Error('must not send'); } })).every(() => true), 'alerts: not_configured rows are never dispatched');

  // ── delivery, retries, permanent failures ──
  await pool.query('DELETE FROM ai_alerts'); await pool.query('DELETE FROM ai_incidents');
  const e = await newApp(pool, 'Delivery');
  for (let i = 0; i < 3; i++) await run(pool, e.id, fail);
  let calls = 0; const okProv = { send: async (m) => { calls++; await new Promise((r) => setTimeout(r, 50)); return { ok: true, providerId: 'msg_123456789' }; } };
  const [r1, r2] = await Promise.all([alerts.dispatchDue(pool, okProv), alerts.dispatchDue(pool, okProv)]);
  assert(calls === 1 && r1.length + r2.length === 1, 'dispatch: two workers racing => the provider is called exactly once (SKIP LOCKED)');
  let row = (await q(pool, 'SELECT * FROM ai_alerts'))[0];
  assert(row.status === 'sent' && row.provider_id === 'msg_123456789' && row.sent_at, 'dispatch: provider acceptance recorded with its id');
  assert((await alerts.dispatchDue(pool, okProv)).length === 0 && calls === 1, 'dispatch: a sent alert is never sent again');

  await pool.query('DELETE FROM ai_alerts'); await pool.query("UPDATE ai_incidents SET status='resolved', resolved_at=NOW()");
  const f = await newApp(pool, 'Retry');
  for (let i = 0; i < 3; i++) await run(pool, f.id, fail);
  const flaky = { send: async () => ({ ok: false, retryable: true, error: 'Email provider answered HTTP 503.' }) };
  await alerts.dispatchDue(pool, flaky);
  row = (await q(pool, 'SELECT * FROM ai_alerts'))[0];
  assert(row.status === 'pending' && row.attempts === 1 && row.last_error.includes('503') && new Date(row.next_attempt_at) > new Date(Date.now() + 30000), 'retry: temporary failure => stays pending with backoff and a recorded error');
  assert((await alerts.dispatchDue(pool, okProv)).length === 0, 'retry: not retried before its backoff time');
  for (let n = 2; n <= alerts.MAX_ATTEMPTS; n++) { await pool.query("UPDATE ai_alerts SET next_attempt_at = NOW() - INTERVAL '1 second'"); await alerts.dispatchDue(pool, flaky); }
  row = (await q(pool, 'SELECT * FROM ai_alerts'))[0];
  assert(row.status === 'failed' && row.attempts === alerts.MAX_ATTEMPTS && /Gave up/.test(row.last_error), 'retry: gives up after the maximum attempts and says so');

  await pool.query('DELETE FROM ai_alerts'); await pool.query('DELETE FROM ai_incidents');
  const g = await newApp(pool, 'Permanent');
  for (let i = 0; i < 3; i++) await run(pool, g.id, fail);
  await alerts.dispatchDue(pool, { send: async () => ({ ok: false, retryable: false, error: 'Email provider answered HTTP 401. Check RESEND_API_KEY.' }) });
  row = (await q(pool, 'SELECT * FROM ai_alerts'))[0];
  assert(row.status === 'failed' && row.attempts === 1, 'retry: a permanent error (bad credentials) fails immediately, no pointless retries');

  await pool.query('DELETE FROM ai_alerts'); await pool.query('DELETE FROM ai_incidents');
  const h = await newApp(pool, 'Crash');
  for (let i = 0; i < 3; i++) await run(pool, h.id, fail);
  await pool.query("UPDATE ai_alerts SET status='sending', attempts=1, updated_at = NOW() - INTERVAL '10 minutes'");
  const recovered = await alerts.dispatchDue(pool, okProv);
  assert(recovered.length === 1 && recovered[0].status === 'sent', 'dispatch: an alert stuck "sending" after a crash is reclaimed and sent');

  // ── owner test notification ──
  await pool.query('DELETE FROM ai_alerts');
  const env = { RESEND_API_KEY: 're_abcdefghijkl', ALERT_EMAIL_FROM: 'a@example.com', ALERT_EMAIL_TO: 'o@example.com' };
  let t = await alerts.sendTest(pool, okProv, {});
  assert(!t.ok && !t.configured && t.missing.length === 3 && (await q(pool, 'SELECT 1 FROM ai_alerts')).length === 0, 'test: unconfigured => clear error listing what is missing; nothing recorded or sent');
  t = await alerts.sendTest(pool, okProv, env);
  assert(t.ok && /accepted/.test(t.message) && /not that it reached the inbox/.test(t.message), 'test: success wording says "accepted", not "delivered"');
  t = await alerts.sendTest(pool, okProv, env);
  assert(!t.ok && t.tooSoon, 'test: a second test within 30s is refused');
  await pool.query('DELETE FROM ai_alerts');
  t = await alerts.sendTest(pool, { send: async () => ({ ok: false, retryable: true, error: 'Email provider answered HTTP 503.' }) }, env);
  assert(!t.ok && /503/.test(t.message) && (await q(pool, 'SELECT status FROM ai_alerts'))[0].status === 'failed', 'test: a failed test reports the real error and is not retried in the background');

  // ── scheduler: advisory lock, completed cycle, heartbeat, end-to-end ──
  await pool.query('DELETE FROM ai_alerts'); await pool.query('DELETE FROM ai_incidents'); await pool.query('DELETE FROM ai_applications');
  let hits = 0; const target = http.createServer((q2, s) => { hits++; s.end('ok'); }); await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const live = await store.createApplication(pool, { name: 'Live', url: `http://127.0.0.1:${target.address().port}/`, environment: 'development', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 60, timeoutMs: 1000, slowThresholdMs: 2000, mode: 'daily' });
  let beats = 0; const heartbeat = async () => { beats++; return { sent: true }; };
  const holder = await pool.connect(); await holder.query('SELECT pg_advisory_lock($1)', [monitor.TICK_LOCK_KEY]);
  let tk = await monitor.tick(pool, { allowPrivate: true, heartbeat, provider: okProv, env: {} });
  assert(tk.skipped && hits === 0 && beats === 0, 'scheduler: while another instance holds the lock, this one sends no requests and no heartbeat');
  await holder.query('SELECT pg_advisory_unlock($1)', [monitor.TICK_LOCK_KEY]); holder.release();
  const ticks = await Promise.all([monitor.tick(pool, { allowPrivate: true, heartbeat, provider: okProv, env: {} }), monitor.tick(pool, { allowPrivate: true, heartbeat, provider: okProv, env: {} })]);
  assert(hits === 1 && ticks.filter((x) => x.ok).length >= 1 && (await q(pool, 'SELECT count(*)::int n FROM ai_checks'))[0].n === 1, 'scheduler: two simultaneous passes => the application is requested ONCE and recorded once');
  assert(beats === ticks.filter((x) => x.ok).length && beats >= 1, 'scheduler: heartbeat sent once per completed cycle');
  assert(Boolean(await store.getServiceState(pool, 'last_cycle_completed_at')), 'scheduler: completed-cycle time is persisted for the dashboard');
  tk = await monitor.tick(pool, { allowPrivate: true, heartbeat, provider: okProv, env: {} });
  assert(hits === 1, 'scheduler: a second pass shortly after a completed one (restart / second instance / catch-up) is skipped: no repeat requests');
  assert((await store.getApplication(pool, live.id)).lastOutcome === 'ok', 'end-to-end: real HTTP check persisted to Postgres');
  await pool.query("INSERT INTO ai_applications (id, name, url) VALUES ('legacy-row', 'Legacy', 'https://legacy.test/')");
  const legacy = await store.getApplication(pool, 'legacy-row');
  assert(legacy.mode === 'manual', 'migration: a row that existed before the mode column became MANUAL (existing apps are never checked automatically)');
  await pool.query("DELETE FROM ai_applications WHERE id = 'legacy-row'");
  const travelRow = await store.createApplication(pool, { name: 'Trip', url: 'https://trip.test/', environment: 'production', checkType: 'health_endpoint', checkPath: '/health', expectedStatus: 200, intervalSeconds: 300, timeoutMs: 1000, slowThresholdMs: null, mode: 'manual_only' });
  await pool.query("DELETE FROM ai_service_state WHERE key = 'last_cycle_completed_at'");
  const hitsBefore = hits;
  await monitor.tick(pool, { allowPrivate: true, heartbeat, provider: okProv, env: {} });
  assert((await q(pool, 'SELECT count(*)::int n FROM ai_checks WHERE application_id = $1', [travelRow.id]))[0].n === 0, 'scheduler: a manual-only application gets no check row from a daily pass');
  assert(hits === hitsBefore + 1, 'scheduler: the daily pass requested only the one daily application');
  target.close();

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
