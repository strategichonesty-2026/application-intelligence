// test_uptime.cjs: uptime per app per day. Pure builder always; the SQL runs if AI_TEST_DATABASE_URL is set. Offline otherwise.
const { buildUptime } = require('./server/services/appIntelligence/uptime.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = new Date('2026-10-12T10:00:00Z');
(async () => {
  const apps = [{ id: 'a', name: 'A', enabled: true }, { id: 'b', name: 'B', enabled: true }];
  const u = buildUptime({ apps, now: NOW, days: 7, rows: [
    { application_id: 'a', day: '2026-10-12', answered: 3, failed: 1 }, { application_id: 'a', day: '2026-10-10', answered: 2, failed: 0 },
    { application_id: 'a', day: '2026-01-01', answered: 9, failed: 9 } ] });
  const a = u.applications[0]; const b = u.applications[1];
  assert(u.days === 7 && a.days.length === 7 && a.days[6].date === '2026-10-12' && a.days[0].date === '2026-10-06', 'seven consecutive UTC days ending today');
  assert(a.checks === 6 && a.failed === 1 && a.uptimePct === 83.3, 'uptime % = answered / (answered + failed); rows outside the window are ignored');
  assert(a.days[5].uptimePct === null && a.days[4].uptimePct === 100 && a.days[6].uptimePct === 75, 'a day with no checks is "no data" (null), never 100%');
  assert(b.uptimePct === null && b.checks === 0 && u.overall.uptimePct === 83.3 && u.overall.checks === 6, 'an app with no checks has no percentage; the overall figure only counts real checks');
  assert(buildUptime({ apps, now: NOW, days: 999, rows: [] }).days === 30 && buildUptime({ apps, now: NOW, days: 0, rows: [] }).days === 30, 'the period is capped at 30 days (records are kept for 30)');

  const url = process.env.AI_TEST_DATABASE_URL;
  if (url) {
    const { Pool } = require('pg'); const store = require('./server/services/appIntelligence/store.cjs');
    const pool = new Pool({ connectionString: url });
    await pool.query('DROP TABLE IF EXISTS ai_alerts, ai_service_state, ai_checks, ai_incidents, ai_applications, ai_credentials, ai_subscriptions CASCADE');
    await store.initSchema(pool);
    const app = await store.createApplication(pool, { name: 'U', url: 'https://x.test/', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 60, timeoutMs: 8000, slowThresholdMs: null, enabled: true, mode: 'manual' });
    const ins = (outcome, offset) => pool.query(`INSERT INTO ai_checks (application_id, checked_at, outcome) VALUES ($1, NOW() - ($2 || ' days')::interval, $3)`, [app.id, String(offset), outcome]);
    await ins('ok', 0); await ins('failed', 0); await ins('degraded', 0); await ins('inconclusive', 0); await ins('monitor_error', 0); await ins('ok', 2); await ins('ok', 40);
    const rows = await store.uptimeDaily(pool, 7);
    const t = buildUptime({ apps: [app], rows, now: new Date(), days: 7 }).applications[0];
    assert(t.checks === 4 && t.failed === 1 && t.days[6].answered === 2 && t.days[6].failed === 1, 'SQL: counts ok+degraded as answered, failed as failed, ignores inconclusive and monitor errors');
    assert(t.days[4].answered === 1 && !rows.some((r) => r.day < new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10)), 'SQL: a check from 2 days ago lands on its own day; one from 40 days ago is outside the window');
    await pool.end();
  } else console.log('SKIPPED SQL part: set AI_TEST_DATABASE_URL');
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
