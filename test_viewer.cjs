// test_viewer.cjs: the optional view-only sign-in (for showing friends). Offline, dummy values.
// Proves: it is OFF unless configured; a viewer token opens ONLY /showcase; the showcase carries names and
// status only (no URL, error text or secret); an owner token still opens everything; tokens are not interchangeable.
process.env.NODE_ENV = 'test';
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const store = require('./server/services/appIntelligence/store.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const OWNER = 'dummy owner passphrase 4242'; const VIEWER = 'dummy viewer passphrase 9191';
const SECRET_URL = 'https://private-host.example.invalid/secret-path';
(async () => {
  let r = await ownerAuth.prepareAuthEnv({ APP_INTELLIGENCE_OWNER_PASSWORD: OWNER, APP_INTELLIGENCE_VIEWER_PASSWORD: 'short' });
  assert(r.problems.some((p) => /VIEWER_PASSWORD must be at least 16/.test(p)) && !r.problems.join(' ').includes('short"'), 'a short viewer passphrase is refused with a plain message');
  r = await ownerAuth.prepareAuthEnv({ APP_INTELLIGENCE_OWNER_PASSWORD: OWNER, APP_INTELLIGENCE_VIEWER_PASSWORD: OWNER });
  assert(r.problems.some((p) => /same as the owner/.test(p)), 'a viewer passphrase equal to the owner passphrase is refused');

  const env = { APP_INTELLIGENCE_OWNER_PASSWORD: OWNER, APP_INTELLIGENCE_VIEWER_PASSWORD: VIEWER };
  await ownerAuth.prepareAuthEnv(env);
  const now = new Date().toISOString();
  store.listApplications = async () => [{ name: 'Demo App', url: SECRET_URL, checkType: 'homepage', enabled: true, mode: 'manual', lastCheckedAt: now, lastSuccessAt: now, lastOutcome: 'ok', lastReason: 'internal detail', lastSummary: 'internal detail', failStreak: 0, intervalSeconds: 3600, expectedStatus: 200 }];
  const kv = {}; store.getServiceState = async (_p, k) => (k in kv ? { value: kv[k] } : null); store.setServiceState = async (_p, k, v) => { kv[k] = v; };
  const express = require('express');
  const mk = (e) => { const app = express(); app.use(express.json()); app.use('/api/app-intelligence', require('./server/routes/appIntelligence.cjs')({ query: async () => ({ rows: [] }) }, { env: e, failDelayMs: 1 })); return new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); }); };
  const srv = await mk(env); const base = `http://127.0.0.1:${srv.address().port}/api/app-intelligence`;
  const login = (password) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  const get = (p, token) => fetch(base + p, { headers: token ? { authorization: `Bearer ${token}` } : {} });

  const o = await login(OWNER); const v = await login(VIEWER); const bad = await login('wrong passphrase of length');
  assert(o.status === 200 && o.body.role === 'owner' && v.status === 200 && v.body.role === 'viewer' && bad.status === 401, 'owner passphrase gives an owner token, viewer passphrase a viewer token, anything else 401');

  let res = await get('/showcase', v.body.token); const body = await res.json(); const text = JSON.stringify(body);
  assert(res.status === 200 && body.applications.length === 1 && body.applications[0].name === 'Demo App' && 'status' in body.applications[0], 'viewer token reads the showcase (name and status)');
  assert(!text.includes('private-host') && !text.includes('internal detail') && !/url|reason|summary|credential/i.test(text), 'the showcase carries no URL, error text or secret-register data');
  assert((await get('/showcase', o.body.token)).status === 200, 'an owner token can also read the showcase');
  assert((await get('/showcase')).status === 401, 'no token: 401');

  for (const p of ['/summary', '/applications', '/credentials', '/subscriptions', '/incidents', '/config', '/activity', '/inventory', '/auth/session']) {
    const x = await get(p, v.body.token);
    assert(x.status === 401, `viewer token is refused on ${p}`);
  }
  const post = await fetch(`${base}/check-all`, { method: 'POST', headers: { authorization: `Bearer ${v.body.token}`, 'content-type': 'application/json' }, body: '{}' });
  assert(post.status === 401, 'viewer token cannot run checks');
  assert((await get('/auth/session', o.body.token)).status === 200, 'owner token still opens the owner routes');
  // ── sign-in reminders ──
  const hints = () => fetch(`${base}/auth/hint`).then((x) => x.json());
  const put = (body, token) => fetch(`${base}/auth/hints`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert((await hints()).hint === null, 'no reminder saved: the sign-in page shows none');
  assert((await put({ owner: 'x' }, v.body.token)).status === 401 && (await get('/auth/hints', v.body.token)).status === 401, 'a viewer cannot read or change reminders');
  assert((await put({ owner: 'first school plus lucky number', viewer: 'the usual friends word' }, o.body.token)).status === 200, 'the owner can save reminders');
  let h = await hints(); assert(h.hint === 'first school plus lucky number' && h.viewerHint === 'the usual friends word', 'both reminders are shown on the public sign-in help');
  assert((await put({ owner: `it is ${OWNER}` }, o.body.token)).status === 400 && (await put({ owner: OWNER }, o.body.token)).status === 400 && (await put({ viewer: VIEWER }, o.body.token)).status === 400, 'a reminder containing or equal to a passphrase is refused');
  assert((await put({ owner: 'x'.repeat(121) }, o.body.token)).status === 400, 'a too-long reminder is refused');
  assert((await put({ owner: '' }, o.body.token)).status === 200 && (await hints()).hint === null, 'clearing a reminder hides it');
  srv.close();

  const envOff = { APP_INTELLIGENCE_OWNER_PASSWORD: OWNER }; await ownerAuth.prepareAuthEnv(envOff);
  const off = await mk(envOff); const b2 = `http://127.0.0.1:${off.address().port}/api/app-intelligence`;
  const lr = await fetch(`${b2}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: VIEWER }) });
  assert(lr.status === 401, 'without APP_INTELLIGENCE_VIEWER_PASSWORD the view-only sign-in does not exist');
  off.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
