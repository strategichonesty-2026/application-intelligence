// test_appIntelligence_security.cjs
// Regression tests for the security controls of Application Intelligence.
// Offline: only throwaway servers on 127.0.0.1; no database; no external network.
// Run: node test_appIntelligence_security.cjs
process.env.API_SECRET_KEY = 'sk_test_SECRET_VALUE_1234567890abcdef';
process.env.RESEND_API_KEY = 're_TESTKEY_abcdefghijklmnop';
process.env.APP_INTELLIGENCE_HEARTBEAT_URL = 'https://hc.example.test/ping/TOKEN_abcdefghijklmnopqrstuvwxyz';
const http = require('http');
const fs = require('fs');
const express = require('express');
const checker = require('./server/services/appIntelligence/checker.cjs');
const { validateApplicationInput, parseUrl } = require('./server/services/appIntelligence/validation.cjs');
const alerts = require('./server/services/appIntelligence/alerts.cjs');
const heartbeat = require('./server/services/appIntelligence/heartbeat.cjs');
const { scrub } = require('./server/services/appIntelligence/safe.cjs');
const store = require('./server/services/appIntelligence/store.cjs');
const monitor = require('./server/services/appIntelligence/monitor.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` })); });
const baseApp = { url: 'https://app.example.test', checkType: 'homepage', expectedStatus: 200, timeoutMs: 1000, slowThresholdMs: 5000 };

(async () => {
  // ═══ 1. Registration-time URL validation ═══
  const bad = [
    'http://127.0.0.1/', 'http://localhost:3000', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data',
    'http://[::1]/', 'http://[fd00::1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://metadata.google.internal/', 'http://db.internal/',
    'http://intranet/', 'http://printer.local/', 'http://[::ffff:10.0.0.1]/', 'ftp://example.com/', 'http://localhost./', 'http://LOCALHOST:8080/', 'http://foo.localhost./', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://user:pass@example.com/', 'https://example.com/?token=abc',
  ];
  for (const u of bad) assert(Boolean(parseUrl(u, { allowPrivate: false }).error), `validate: rejects ${u}`);
  assert(!parseUrl('https://example.com/dashboard', { allowPrivate: false }).error, 'validate: accepts a normal public URL');
  const pathBad = ['//evil.test/x', '/\\evil.test', '/health?x=1', '/a@evil.test', 'health', 'https://evil.test/h', '/h#frag'];
  for (const p of pathBad) assert(validateApplicationInput({ name: 'A', url: 'https://example.com', checkType: 'health_endpoint', checkPath: p }).errors.length > 0, `validate: rejects health path ${p}`);

  // ═══ 2. Connect-time SSRF guard (DNS rebinding, mixed answers, literals) ═══
  const lookupWith = (addrs) => checker.makeGuardedLookup(false, (_h, _o, cb) => cb(null, addrs));
  const run = (lookup) => new Promise((r) => lookup('x.test', { all: true }, (err, list) => r({ err, list })));
  assert((await run(lookupWith([{ address: '93.184.216.34', family: 4 }]))).err === null, 'guard: public-only answer allowed');
  assert((await run(lookupWith([{ address: '10.0.0.7', family: 4 }]))).err.code === 'EBLOCKED', 'guard: private-only answer blocked at connect time (rebinding)');
  assert((await run(lookupWith([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]))).err.code === 'EBLOCKED', 'guard: a mixed public+metadata answer is blocked');
  assert((await run(lookupWith([{ address: '::ffff:127.0.0.1', family: 6 }]))).err.code === 'EBLOCKED', 'guard: IPv4-mapped loopback blocked');
  assert((await run(lookupWith([{ address: '64:ff9b::7f00:1', family: 6 }]))).err.code === 'EBLOCKED', 'guard: NAT64-embedded address blocked');
  let c = await checker.runHttpCheck({ ...baseApp, url: 'http://localhost:9/' }, { allowPrivate: false });
  assert(c.outcome === 'inconclusive' && c.reason === 'blocked_target', 'guard: hostname that resolves to loopback is refused (no connection made)');
  for (const lit of ['http://127.0.0.1:9/', 'http://[::1]:9/', 'http://2130706433:9/', 'http://169.254.169.254/', 'http://0.0.0.0:9/']) {
    c = await checker.runHttpCheck({ ...baseApp, url: lit }, { allowPrivate: false });
    assert(c.outcome === 'inconclusive' && c.reason === 'blocked_target', `guard: literal ${lit} refused`);
  }

  // ═══ 3. Redirect-based bypass ═══
  const redirectTo = (loc) => async (url, o) => (url.startsWith('https://public.example.test') ? { status: 302, ms: 1, headers: { location: loc }, body: '' } : checker.rawRequest(url, o));
  for (const loc of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:9/admin', 'http://[::1]:9/', 'http://2130706433:9/', 'ftp://internal.test/x', 'file:///etc/passwd']) {
    c = await checker.runHttpCheck({ ...baseApp, url: 'https://public.example.test/' }, { allowPrivate: false, request: redirectTo(loc) });
    assert(c.outcome === 'inconclusive' && c.reason === 'blocked_target', `redirect: public -> ${loc} is refused`);
  }
  c = await checker.runHttpCheck({ ...baseApp, url: 'https://public.example.test/' }, { allowPrivate: false, request: async () => ({ status: 302, ms: 1, headers: { location: '/again' }, body: '' }) });
  assert(c.outcome === 'failed' && c.reason === 'redirect_loop', 'redirect: endless redirects stop after a few hops');
  c = await checker.runHttpCheck({ ...baseApp, checkType: 'health_endpoint', checkPath: '//evil.test/x', url: 'https://app.example.test' }, { allowPrivate: false, request: async () => { throw new Error('must not be called'); } });
  assert(c.outcome === 'inconclusive' && c.reason === 'blocked_target', 'path: //host path cannot switch the checked origin');

  // ═══ 4. Authorization on every monitoring endpoint (details: test_appIntelligence_auth.cjs) ═══
  // The shared x-api-key ships in the public front-end bundle, so these routes must NOT accept it.
  const ownerAuthMod = require('./server/services/appIntelligence/ownerAuth.cjs');
  process.env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuthMod.hashPassword('security test password 1');
  process.env.APP_INTELLIGENCE_SESSION_SECRET = 'y'.repeat(48);
  const router = require('./server/routes/appIntelligence.cjs')({ query: async () => ({ rows: [] }), connect: async () => { throw new Error('no db'); } }, {});
  const web = express(); web.use(express.json()); web.use('/api/app-intelligence', router); // NO shared-key middleware in front
  const srv = await listen(web);
  const routes = router.stack.filter((l) => l.route && l.route.path !== '/auth/login').flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path.replace(/:id/, 'app-1') })));
  assert(routes.length >= 14, `auth: enumerated ${routes.length} protected monitoring routes`);
  let leaked = 0;
  for (const r of routes) {
    for (const headers of [{}, { 'x-api-key': process.env.API_SECRET_KEY }, { authorization: 'Bearer wrong' }, { 'x-api-key': 'wrong' }]) {
      const res = await fetch(`${srv.url}/api/app-intelligence${r.path}`, { method: r.method, headers: { 'content-type': 'application/json', ...headers }, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' });
      const body = await res.text();
      if (res.status !== 401 || /"success":true|"applications"|"alerts"/.test(body)) { leaked++; console.log('   unexpected:', r.method, r.path, Object.keys(headers), res.status); }
    }
  }
  assert(leaked === 0, 'auth: every route answers 401 with no credentials, with the VALID shared API key, and with wrong tokens, and returns no data');
  srv.server.close();
  const idx = fs.readFileSync('./server/index.cjs', 'utf8');
  assert(idx.indexOf("'/api/app-intelligence'") > -1 && /app\.use\('\/api\/app-intelligence'/.test(idx), 'wiring: index.cjs mounts the monitoring router (it enforces its own owner sign-in)');

  // ═══ 5. Secret hygiene ═══
  const dirty = `fail key=${process.env.API_SECRET_KEY} hb=${process.env.APP_INTELLIGENCE_HEARTBEAT_URL} resend=${process.env.RESEND_API_KEY} url=https://x.test/path?token=abc123abc123abc123abc123`;
  const cl = scrub(dirty);
  assert(!cl.includes('sk_test_SECRET') && !cl.includes('TOKEN_abcdef') && !cl.includes('re_TESTKEY') && !cl.includes('abc123abc123'), 'scrub: removes API key, heartbeat token, Resend key, URL query tokens');
  assert(!scrub('postgres://user:hunter2@db.example.com/x').includes('hunter2'), 'scrub: removes credentials from URLs');

  // ═══ 6. Alert configuration, provider behaviour and secret handling ═══
  assert(!alerts.getAlertConfig({}).configured && alerts.getAlertConfig({}).missing.length === 3, 'alerts: empty config lists all 3 missing variables');
  assert(alerts.getAlertConfig({ RESEND_API_KEY: 'nope', ALERT_EMAIL_FROM: 'x', ALERT_EMAIL_TO: 'a@b.co' }).invalid.length === 2, 'alerts: invalid key and sender are reported');
  const good = { RESEND_API_KEY: 're_abcdefghijkl', ALERT_EMAIL_FROM: 'Alerts <alerts@example.com>', ALERT_EMAIL_TO: 'owner@example.com' };
  const gc = alerts.getAlertConfig(good);
  assert(gc.configured && gc.recipients[0] === 'o•••@example.com' && !JSON.stringify(gc).includes('re_abcdefghijkl'), 'alerts: valid config; recipient masked; key never returned');
  let seen;
  const mk = (status, body, throws) => alerts.createResendProvider({ env: good, fetchImpl: async (u, o) => { seen = { u, o }; if (throws) throw Object.assign(new Error(`connect failed to ${u} with ${good.RESEND_API_KEY}`), { name: 'TypeError' }); return { ok: status < 300, status, json: async () => body }; } });
  let r = await mk(200, { id: 'abcd1234-5678' }).send({ subject: 's', text: 't', idempotencyKey: 'k1' });
  assert(r.ok && r.providerId === 'abcd1234-5678' && seen.o.headers['Idempotency-Key'] === 'k1', 'provider: 200 with id => accepted; idempotency key sent');
  r = await mk(200, {}).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable, 'provider: 200 WITHOUT an id is not treated as accepted');
  r = await mk(429, { message: 'rate limited' }).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable, 'provider: 429 is retryable');
  r = await mk(503, {}).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable, 'provider: 5xx is retryable');
  r = await mk(401, { message: `invalid key ${good.RESEND_API_KEY}` }).send({ subject: 's', text: 't' });
  assert(!r.ok && !r.retryable && !r.error.includes('re_abcdefghijkl') && r.error.includes('RESEND_API_KEY'), 'provider: 401 is permanent, error has a hint and no key');
  r = await mk(0, null, true).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable && !r.error.includes('re_abcdefghijkl'), 'provider: network failure retryable and secret-free');
  r = await alerts.createResendProvider({ env: {} }).send({ subject: 's', text: 't' });
  assert(!r.ok && !r.retryable && r.error.includes('not configured'), 'provider: missing credentials give a clear error and make no request');
  const msg = alerts.buildMessage('opened', { app: { name: 'A', environment: 'production', url: 'https://a.test' }, incident: { severity: 'critical', summary: 'No response.', firstDetectedAt: 't', failureCount: 3 } });
  const inj = alerts.buildMessage('opened', { app: { name: 'Evil\r\nBcc: attacker@evil.test', environment: 'production', url: 'https://a.test' }, incident: { severity: 'critical', summary: 's', firstDetectedAt: 't', failureCount: 3 } });
  assert(!/[\r\n]/.test(inj.subject), 'message: an application name cannot inject header lines into the subject');
  assert(msg.text.includes('https://a.test') && !/token|password|authorization/i.test(msg.text), 'message: contains app facts, no secrets');

  // ═══ 7. Heartbeat ═══
  const hb = await listen((q, s) => { hb.hits = (hb.hits || 0) + 1; s.statusCode = hb.status || 200; s.end('OK'); });
  const hbEnv = { APP_INTELLIGENCE_HEARTBEAT_URL: `${hb.url}/ping/SECRET_TOKEN_abcdefghijklmnop`, APP_INTELLIGENCE_HEARTBEAT_ALLOW_HTTP: '1' };
  assert((await heartbeat.sendHeartbeat({ env: {} })).reason === 'not_configured', 'heartbeat: not configured => nothing sent');
  assert(!heartbeat.heartbeatConfig({ APP_INTELLIGENCE_HEARTBEAT_URL: 'http://x.test/' }).valid, 'heartbeat: plain http rejected by default');
  assert(!heartbeat.heartbeatConfig({ APP_INTELLIGENCE_HEARTBEAT_URL: 'https://u:p@x.test/' }).valid, 'heartbeat: credentials in URL rejected');
  assert((await heartbeat.sendHeartbeat({ env: hbEnv })).sent && hb.hits === 1 && heartbeat.heartbeatStatus(hbEnv).lastSuccessAt, 'heartbeat: success recorded');
  hb.status = 500; const bad500 = await heartbeat.sendHeartbeat({ env: hbEnv });
  assert(!bad500.sent && !JSON.stringify(heartbeat.heartbeatStatus(hbEnv)).includes('SECRET_TOKEN'), 'heartbeat: failure recorded; token never exposed in status');
  const down = await listen(() => {}); const downUrl = down.url; await new Promise((res) => down.server.close(res));
  const unreachable = await heartbeat.sendHeartbeat({ env: { ...hbEnv, APP_INTELLIGENCE_HEARTBEAT_URL: `${downUrl}/p/SECRET_TOKEN_abcdefghijklmnop` } });
  assert(!unreachable.sent && !unreachable.error.includes('SECRET_TOKEN'), 'heartbeat: unreachable provider does not throw or leak the URL');

  // ═══ 8. Heartbeat only after a COMPLETED cycle; one instance per pass ═══
  const orig = {}; for (const k of Object.keys(store)) orig[k] = store[k];
  const mkPool = (got) => ({ query: async () => ({ rows: [] }), connect: async () => ({ query: async (sql) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ got }] } : { rows: [] }), release() {} }) });
  const dueApp = { id: 'a1', name: 'A', url: 'https://a.test', enabled: true, mode: 'daily', intervalSeconds: 60, lastCheckedAt: null, checkType: 'homepage' };
  const okCheck = async () => ({ outcome: 'ok', reason: null, summary: null, httpStatus: 200, responseMs: 5, checkedAt: new Date() });
  Object.assign(store, { listApplications: async () => [dueApp], recordResult: async () => ({}), setServiceState: async () => {}, pruneChecks: async () => {} });
  let beats = 0; const spy = async () => { beats++; return { sent: true }; };
  const noProvider = { send: async () => ({ ok: true, providerId: 'x' }) };
  let t = await monitor.tick(mkPool(false), { check: okCheck, heartbeat: spy, provider: noProvider });
  assert(t.skipped && beats === 0, 'tick: another instance holds the lock => skipped, no checks, no heartbeat');
  t = await monitor.tick(mkPool(true), { check: okCheck, heartbeat: spy, provider: noProvider });
  assert(t.ok && beats === 1, 'tick: completed cycle => exactly one heartbeat');
  store.recordResult = async () => { throw new Error('db write failed'); };
  t = await monitor.tick(mkPool(true), { check: okCheck, heartbeat: spy, provider: noProvider });
  assert(!t.ok && beats === 1, 'tick: a check that cannot be recorded => cycle failed => NO heartbeat');
  store.recordResult = async () => ({}); store.listApplications = async () => { throw new Error('db down'); };
  t = await monitor.tick(mkPool(true), { check: okCheck, heartbeat: spy, provider: noProvider });
  assert(!t.ok && beats === 1, 'tick: database unreadable => NO heartbeat');
  t = await monitor.tick({ query: async () => ({ rows: [] }), connect: async () => { throw new Error('pool exhausted'); } }, { check: okCheck, heartbeat: spy, provider: noProvider });
  assert(!t.ok && beats === 1, 'tick: cannot get a connection => NO heartbeat');
  Object.assign(store, orig);
  hb.server.close();

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
