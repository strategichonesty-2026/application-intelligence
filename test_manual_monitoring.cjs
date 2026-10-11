// test_manual_monitoring.cjs
// Proves the cost/safety rules of the manual-first monitoring design. Offline: fake store, fake checker,
// local server for the CLI guard test, zero real network and zero paid calls.
// Run: node test_manual_monitoring.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const store = require('./server/services/appIntelligence/store.cjs');
const monitor = require('./server/services/appIntelligence/monitor.cjs');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const status = require('./server/services/appIntelligence/status.cjs');
const { validateApplicationInput } = require('./server/services/appIntelligence/validation.cjs');
const targets = require('./server/scripts/appIntelligenceTargets.cjs');
const { selectTargets } = require('./server/scripts/validateIntegrations.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

(async () => {
  // ── 1. No AI / LLM / paid provider anywhere in the monitoring code ──
  const dirs = ['server/services/appIntelligence', 'server/routes/appIntelligence.cjs'];
  const files = dirs.flatMap((d) => (fs.statSync(path.join(__dirname, d)).isDirectory() ? fs.readdirSync(path.join(__dirname, d)).map((f) => `${d}/${f}`) : [d]));
  // Every module the monitoring code can load must be a Node built-in, express, pg/dotenv, or another
  // monitoring file. No AI SDK, no media/provider service, no scheduler/pipeline code.
  const ALLOWED = /^(\.\/(status|validation|checker|store|monitor|alerts|heartbeat|egress|safe|ownerAuth|inventory)\.cjs|\.\.\/services\/appIntelligence\/[a-zA-Z]+\.cjs|node:.*|crypto|dns|net|http|https|tls|express|fs|path|url|os)$/;
  const strip = (t) => t.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const loaded = files.flatMap((f) => [...strip(read(f)).matchAll(/require\((['"])([^'"]+)\1\)/g)].map((m) => ({ f, mod: m[2] })));
  const bad = loaded.filter((x) => !ALLOWED.test(x.mod));
  const hostCalls = files.filter((f) => /https?:\/\/[^'"\s]*(anthropic|openai|replicate|elevenlabs|runwayml|creatomate)/i.test(strip(read(f))));
  assert(files.length >= 10 && bad.length === 0 && hostCalls.length === 0, `monitoring code loads no AI / paid-provider / pipeline module and calls no such host (${files.length} files, ${loaded.length} imports checked${bad.length ? '; unexpected: ' + bad.map((x) => `${x.f}->${x.mod}`).join(', ') : ''})`);

  // ── 2. Nothing runs automatically by default ──
  const idx = read('server/index.cjs');
  assert(!/setInterval/.test(read('server/services/appIntelligence/monitor.cjs').replace(/\/\/.*$/gm, '')), 'monitor: no setInterval (no per-second / per-minute polling) in the scheduler');
  assert(monitor.scheduleConfig({}).mode === 'off', 'default schedule is OFF');
  assert(!fs.existsSync(path.join(__dirname, 'server/appIntelligenceWorker.cjs')) && !fs.existsSync(path.join(__dirname, 'railway.app-intelligence-worker.json')), 'no standalone always-on worker exists (no extra paid service)');
  assert(read('src/intelligence/data/DashboardContext.jsx').includes('DEFAULT_POLL_MS = 0'), 'console: dashboard auto-refresh defaults to OFF');
  const hits = (read('src/intelligence/data/useResource.js').match(/setInterval/g) || []).length;
  assert(hits === 1 && /!poll \|\| !pollMs/.test(read('src/intelligence/data/useResource.js')), 'console: the only timer is the optional refresh, gated by the (default-off) poll setting');

  // ── 3. Which apps each trigger touches ──
  const mk = (id, mode, extra = {}) => ({ id, name: id, url: `https://${id}.test`, enabled: true, mode, checkType: 'health_endpoint', checkPath: '/health', expectedStatus: 200, timeoutMs: 1000, lastCheckedAt: null, ...extra });
  const apps = [mk('daily1', 'daily'), mk('manual1', 'manual'), mk('travel', 'manual_only'), mk('paused', 'daily', { enabled: false })];
  const calls = [];
  const spy = async (a) => { calls.push(a.id); return { outcome: 'ok', reason: null, summary: null, httpStatus: 200, responseMs: 5, checkedAt: new Date() }; };
  const orig = { ...store };
  Object.assign(store, { listApplications: async () => apps, recordResult: async () => ({}), setServiceState: async () => {}, pruneChecks: async () => {}, getApplication: async (_pool, id) => apps.find((a) => a.id === id) || null, latestIncidentByApp: async () => ({}), getServiceState: async () => null, countOpenIncidents: async () => 0, lastCheckRecordedAt: async () => null });
  const pool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async (sql) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ got: true }] } : { rows: [] }), release() {} }) };
  const noProvider = { send: async () => ({ ok: true, providerId: 'x' }) };
  let beats = 0;
  await monitor.tick(pool, { check: spy, provider: noProvider, heartbeat: async () => { beats++; } });
  assert(calls.join() === 'daily1', 'daily pass: checks ONLY the enabled "daily" application (not manual, not manual-only, not paused)');
  calls.length = 0;
  let out = await monitor.checkAll(pool, { check: spy, provider: noProvider, now: 1_000_000 });
  assert(calls.sort().join() === 'daily1,manual1', 'Check all: every enabled application except the manual-only one (Travel is never included)');
  out = await monitor.checkAll(pool, { check: spy, provider: noProvider, now: 1_000_000 + 5000 });
  assert(out.cooldownSeconds > 0 && calls.length === 2, 'Check all: a second click within 30 s is refused and sends NO requests (cooldown)');
  out = await monitor.checkAll(pool, { check: spy, provider: noProvider, now: 1_000_000 + 31_000 });
  assert(!out.cooldownSeconds && calls.length === 4, 'Check all: allowed again after the cooldown');

  // ── 4. HTTP API ──
  const env = { ...process.env, APP_INTELLIGENCE_OWNER_PASSWORD_HASH: await ownerAuth.hashPassword('dummy owner password 1234'), APP_INTELLIGENCE_SESSION_SECRET: 'z'.repeat(48) };
  const token = ownerAuth.issueToken(env).token;
  const created = [];
  store.createApplication = async (_pool, v) => { const a = { ...mk(`new${created.length}`, v.mode || 'manual'), ...v, id: `new${created.length}`, lastCheckedAt: null }; created.push(a); apps.push(a); return a; };
  calls.length = 0;
  const web = express(); web.use(express.json());
  web.use('/ai', require('./server/routes/appIntelligence.cjs')(pool, { check: spy, provider: noProvider, env, failDelayMs: 0 }));
  const srv = await new Promise((r) => { const s = web.listen(0, '127.0.0.1', () => r(s)); });
  const j = async (p, init = {}) => { const res = await fetch(`http://127.0.0.1:${srv.address().port}/ai${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } }); return { status: res.status, body: await res.json().catch(() => ({})) }; };

  let res = await j('/config');
  assert(res.body.monitoring.schedule === 'off' && res.body.monitoring.nextAutomaticRunAt === null, 'API /config: reports automatic checks OFF and no next run');
  res = await j('/summary');
  assert(res.body.monitoring.health.state === 'manual', 'API /summary: monitoring health is "manual" (not stalled / never_ran) while the schedule is off');
  const before = calls.length;
  await j('/summary'); await j('/applications'); await j('/config');
  assert(calls.length === before, 'reading the dashboard (summary / applications / config) never triggers a check');
  res = await j('/applications', { method: 'POST', body: JSON.stringify({ name: 'Trip', url: 'https://trip.test', checkType: 'health_endpoint', checkPath: '/health', mode: 'manual_only' }) });
  assert(res.status === 201 && res.body.application.mode === 'manual_only' && calls.length === before, 'registering a manual-only app does NOT probe it');
  res = await j('/applications', { method: 'POST', body: JSON.stringify({ name: 'Trip2', url: 'https://trip2.test', checkType: 'homepage', mode: 'manual_only' }) });
  assert(res.status === 400, 'a manual-only app on a homepage check is rejected (it could load real pages)');
  res = await j('/applications', { method: 'POST', body: JSON.stringify({ name: 'Bad', url: 'https://bad.test', mode: 'every-second' }) });
  assert(res.status === 400, 'an unknown mode is rejected');
  res = await j('/applications/travel', { method: 'PATCH', body: JSON.stringify({ checkType: 'homepage' }) });
  assert(res.status === 400, 'editing a manual-only app to a homepage check is rejected');
  calls.length = 0;
  res = await j('/applications/travel/check', { method: 'POST' });
  assert(res.status === 200 && calls.join() === 'travel', 'Check now on the manual-only app works, and requests exactly that one app');
  calls.length = 0;
  const ca = await j('/check-all', { method: 'POST' });
  assert(ca.status === 200 && !calls.includes('travel') && ca.body.results.every((r) => r.id !== 'travel'), 'POST /check-all never includes the manual-only app');
  const again = await j('/check-all', { method: 'POST' });
  assert(again.status === 429, 'POST /check-all twice in a row => 429 (cooldown)');
  const anon = await fetch(`http://127.0.0.1:${srv.address().port}/ai/check-all`, { method: 'POST' });
  assert(anon.status === 401, 'POST /check-all needs the owner sign-in');
  const keyOnly = await fetch(`http://127.0.0.1:${srv.address().port}/ai/check-all`, { method: 'POST', headers: { 'x-api-key': 'anything' } });
  assert(keyOnly.status === 401, 'POST /check-all is not reachable with the shared API key');
  srv.close(); Object.assign(store, orig);

  // ── 5. Travel configuration ──
  const travel = targets.find((t) => /Travel/.test(t.name));
  assert(travel.mode === 'manual_only' && travel.checkType === 'health_endpoint' && travel.checkPath === '/health', 'Travel target: manual-only, health endpoint /health');
  const v = validateApplicationInput({ name: travel.name, url: travel.url, environment: 'production', checkType: travel.checkType, checkPath: travel.checkPath, mode: travel.mode });
  assert(v.errors.length === 0 && v.value.mode === 'manual_only', 'Travel target passes validation');
  assert(!selectTargets(targets, null).some((t) => /Travel/.test(t.name)) && !selectTargets(targets, 'travel').length, 'validator: Travel is excluded by default, even when named');
  const incl = selectTargets(targets, 'travel', { includeManualOnly: true });
  assert(incl.length === 1 && new URL(incl[0].url).pathname === '/health' && incl[0].noDiscover, 'validator --include-manual-only: requests ONLY /health, with no discovery');
  const lat = spawnSync(process.execPath, ['server/scripts/measureLatency.cjs', travel.url], { cwd: __dirname, encoding: 'utf8', timeout: 20000 });
  assert(lat.status === 1 && /MANUAL-ONLY/.test(lat.stderr), 'latency script: refuses to repeatedly time a manual-only application');
  const val = spawnSync(process.execPath, ['server/scripts/validateIntegrations.cjs', '--only', 'travel'], { cwd: __dirname, encoding: 'utf8', timeout: 20000 });
  assert(val.status === 1 && /NOT contacted/.test(val.stderr), 'validator CLI: naming Travel without the flag contacts nothing');
  assert(status.MODES.join() === 'daily,manual,manual_only', 'modes are exactly daily / manual / manual_only');

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
