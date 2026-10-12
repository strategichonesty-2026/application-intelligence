// test_starter.cjs: "Load suggested starting records" adds only what is missing, never changes or deletes, never contacts
// an application, and is owner-only. Offline (in-memory store), plus a Postgres round trip when AI_TEST_DATABASE_URL is set.
const express = require('express');
const store = require('./server/services/appIntelligence/store.cjs');
const inventory = require('./server/services/appIntelligence/inventory.cjs');
const starter = require('./server/services/appIntelligence/starter.cjs');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const targets = require('./server/scripts/appIntelligenceTargets.cjs');
const inv = require('./server/scripts/inventoryTargets.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };

(async () => {
  let fetchCalls = 0; const realFetch = global.fetch; global.fetch = async (...a) => { if (!String(a[0]).startsWith('http://127.0.0.1')) fetchCalls++; return realFetch(...a); };
  const mem = { apps: [], creds: [], subs: [] }; let n = 0;
  const orig = { store: { ...store }, inventory: { ...inventory } };
  Object.assign(store, { listApplications: async () => mem.apps.map((x) => ({ ...x })), createApplication: async (_p, v) => { const r = { id: `app-${++n}`, ...v }; mem.apps.push(r); return r; }, latestIncidentByApp: async () => ({}) });
  Object.assign(inventory, { listCredentials: async () => mem.creds.map((x) => ({ ...x })), createCredential: async (_p, v) => { mem.creds.push({ id: `c${++n}`, ...v }); return v; }, listSubscriptions: async () => mem.subs.map((x) => ({ ...x })), createSubscription: async (_p, v) => { mem.subs.push({ id: `s${++n}`, ...v }); return v; } });

  // ── plan on an empty system ──
  let p = await starter.plan({});
  assert(p.applications.add.length === targets.length && p.applications.invalid.length === 0 && p.credentials.add.length === inv.credentials.length && p.subscriptions.add.length === inv.subscriptions.length, `empty system: plans ${p.applications.add.length} applications, ${p.credentials.add.length} credential records, ${p.subscriptions.add.length} subscription records`);
  assert(p.applications.add.find((a) => /Travel/.test(a.name)).mode === 'manual_only' && p.applications.add.find((a) => a.unconfirmed), 'plan: Travel is manual-only and the unconfirmed application is flagged as unconfirmed');

  // ── apps you already added are skipped (matched by address, not name) ──
  mem.apps.push({ id: 'mine-1', name: 'My own name for Media Studio', url: 'https://MEDIA.strategichonesty.com' }, { id: 'mine-2', name: 'Sched', url: 'https://scheduler.strategichonesty.com/' });
  p = await starter.plan({});
  assert(p.applications.skip.length === 2 && p.applications.add.length === targets.length - 2 && !p.applications.add.some((a) => /Media Studio|Scheduler/.test(a.name)), 'existing applications are recognised by web address (case and trailing slash ignored) even under a different name');

  // ── load: only the selected kinds, only what is missing ──
  const sizeBefore = mem.creds.length + mem.subs.length;
  let added = await starter.load({}, { applications: true });
  assert(added.applications === targets.length - 2 && added.credentials === 0 && added.subscriptions === 0 && mem.creds.length + mem.subs.length === sizeBefore, 'loading applications only adds applications');
  assert(mem.apps.find((a) => a.id === 'mine-1').name === 'My own name for Media Studio' && mem.apps.length === targets.length, 'your existing application keeps its own name and settings (nothing is updated)');
  assert(mem.apps.filter((a) => a.mode === 'manual_only').length === 1 && fetchCalls === 0, 'new applications are added WITHOUT any check: no request was sent to any application');
  added = await starter.load({}, { credentials: true, subscriptions: true });
  assert(added.credentials === inv.credentials.length && added.subscriptions === inv.subscriptions.length, 'loading the registers adds every missing record');
  added = await starter.load({}, { applications: true, credentials: true, subscriptions: true });
  assert(added.applications === 0 && added.credentials === 0 && added.subscriptions === 0 && mem.creds.length === inv.credentials.length, 'loading again adds nothing (idempotent)');
  assert(mem.creds.every((c) => c.verification !== 'verified' && c.status !== 'revoked' && !c.lastRotatedAt) && mem.subs.every((s) => s.price === null && s.priceBasis === 'unknown') && !inventory.findSecretFields({ c: mem.creds, s: mem.subs }).length, 'loaded records claim nothing: not verified, not rotated, not revoked, no invented price, no secret-shaped value');
  mem.creds.pop(); p = await starter.plan({});
  assert(p.credentials.add.length === 1 && p.credentials.skip.length === inv.credentials.length - 1, 'a deleted record is offered again; everything else stays skipped');

  // ── HTTP: owner-only, validated ──
  const env = { APP_INTELLIGENCE_OWNER_PASSWORD_HASH: await ownerAuth.hashPassword('dummy starter owner passphrase'), APP_INTELLIGENCE_SESSION_SECRET: 'starter-secret-'.padEnd(48, 's'), API_SECRET_KEY: 'dummy_key_0123456789_0123456789' };
  Object.assign(process.env, env);
  const token = ownerAuth.issueToken(env).token;
  const web = express(); web.use(express.json()); web.use('/ai', require('./server/routes/appIntelligence.cjs')({}, { env, failDelayMs: 0 }));
  const srv = await new Promise((r) => { const s = web.listen(0, '127.0.0.1', () => r(s)); }); const api = `http://127.0.0.1:${srv.address().port}/ai`;
  const call = (m, path, body, h) => fetch(api + path, { method: m, headers: { 'content-type': 'application/json', ...h }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const sizeA = mem.apps.length + mem.creds.length + mem.subs.length; let leaked = 0;
  for (const h of [{}, { 'x-api-key': env.API_SECRET_KEY }, { authorization: `Bearer ${'a'.repeat(40)}` }]) for (const [m, path, b] of [['GET', '/starter/preview'], ['POST', '/starter/load', { applications: true, credentials: true, subscriptions: true }]]) if ((await call(m, path, b, h)).status !== 401) leaked++;
  assert(leaked === 0 && mem.apps.length + mem.creds.length + mem.subs.length === sizeA, 'authorization: preview and load answer 401 to anonymous callers, the shared key and a forged token; nothing was added');
  const own = { authorization: `Bearer ${token}` };
  let r = await call('GET', '/starter/preview', null, own); assert(r.status === 200 && r.body.plan.credentials.add.length === 1, 'owner: preview works and is read-only');
  r = await call('POST', '/starter/load', {}, own); assert(r.status === 400, 'owner: loading with nothing selected is refused');
  r = await call('POST', '/starter/load', { credentials: 'yes' }, own); assert(r.status === 400, 'owner: only an explicit true selects a kind');
  r = await call('POST', '/starter/load', { credentials: true }, own); assert(r.status === 200 && r.body.added.credentials === 1 && r.body.plan.credentials.add.length === 0, 'owner: loading adds the one missing record and returns the new plan');
  srv.close(); Object.assign(store, orig.store); Object.assign(inventory, orig.inventory);

  // ── real Postgres ──
  if (process.env.AI_TEST_DATABASE_URL) {
    const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
    await store.initSchema(pool); for (const t of ['ai_checks', 'ai_incidents', 'ai_alerts', 'ai_applications', 'ai_credentials', 'ai_subscriptions']) await pool.query(`DELETE FROM ${t}`);
    await store.createApplication(pool, { name: 'Pre-existing', url: 'https://media.strategichonesty.com/', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, slowThresholdMs: null, mode: 'manual' });
    const a1 = await starter.load(pool, { applications: true, credentials: true, subscriptions: true }); const a2 = await starter.load(pool, { applications: true, credentials: true, subscriptions: true });
    const apps = await store.listApplications(pool);
    assert(a1.applications === targets.length - 1 && a2.applications === 0 && a2.credentials === 0 && apps.length === targets.length, 'database: loads once, second load adds nothing, the pre-existing application is untouched');
    assert(apps.find((x) => /Travel/.test(x.name)).mode === 'manual_only' && (await pool.query('SELECT count(*)::int n FROM ai_checks')).rows[0].n === 0, 'database: Travel is stored manual-only and no check row was created (no check was run)');
    assert((await inventory.listCredentials(pool)).length === inv.credentials.length && (await inventory.listSubscriptions(pool)).length === inv.subscriptions.length, 'database: all credential and subscription records stored');
    for (const t of ['ai_applications', 'ai_credentials', 'ai_subscriptions']) await pool.query(`DELETE FROM ${t}`); await pool.end();
  } else console.log('ℹ️  database round trip skipped (set AI_TEST_DATABASE_URL)');
  global.fetch = realFetch;
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
