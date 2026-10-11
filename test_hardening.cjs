// test_hardening.cjs: password hashing and sign-in throttling properties of the owner sign-in.
// Offline, dummy values. Run: node test_hardening.cjs
const crypto = require('crypto');
const express = require('express');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const bodyLimits = require('./server/middleware/bodyLimits.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const PASSWORD = 'dummy hardening passphrase 2026';

(async () => {
  const env = process.env;
  env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuth.hashPassword(PASSWORD);
  env.APP_INTELLIGENCE_SESSION_SECRET = 'hardening-secret-'.padEnd(48, 'h');
  assert(/^scrypt\$65536\$8\$2\$/.test(env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH), 'hash: new hashes use scrypt N=2^16, r=8, p=2');
  let tooShort = false; try { await ownerAuth.hashPassword('only fifteen ch'); } catch { tooShort = true; }
  assert(tooShort && ownerAuth.MIN_PASSWORD_LENGTH === 16, 'hash: a passphrase shorter than 16 characters is refused');
  const legacy = await ownerAuth.hashPassword('legacy params passphrase ok', { N: 16384, r: 8, p: 1 });
  assert(await ownerAuth.verifyPassword('legacy params passphrase ok', legacy), 'hash: a hash made with the old, weaker parameters still verifies');
  const real = crypto.scrypt; let live = 0; let peak = 0;
  crypto.scrypt = (...a) => { live++; peak = Math.max(peak, live); const cb = a[a.length - 1]; a[a.length - 1] = (...r) => { live--; cb(...r); }; return real(...a); };
  await Promise.all(Array.from({ length: 8 }, () => ownerAuth.verifyPassword('wrong passphrase value', env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH)));
  crypto.scrypt = real;
  assert(peak <= ownerAuth.MAX_CONCURRENT_VERIFICATIONS, `hash: 8 simultaneous guesses never hash more than ${ownerAuth.MAX_CONCURRENT_VERIFICATIONS} at once (peak ${peak})`);

  const app = express(); app.set('trust proxy', 1);
  app.use('/ai', bodyLimits.consoleJson(), require('./server/routes/appIntelligence.cjs')({ query: async () => ({ rows: [] }) }, { env, failDelayMs: 0, limiter: ownerAuth.createLoginLimiter({ perClient: 5, slowAfter: 3, slowDelayMs: 150 }) }));
  const srv = await listen(app); const base = `http://127.0.0.1:${srv.address().port}/ai/auth/login`;
  const login = (password, xff) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': xff }, body: JSON.stringify({ password }) });
  for (let i = 0; i < 4; i++) await login('wrong guess ' + i, `10.5.5.${i}`);   // a distributed flood from different addresses
  const t0 = Date.now(); const r = await login(PASSWORD, '203.0.113.50'); const took = Date.now() - t0;
  assert(r.status === 200 && took >= 150, `no lock-out: after a distributed flood the real owner still signs in, only slower (${took} ms)`);
  const lim = ownerAuth.createLoginLimiter({ perClient: 5, slowAfter: 20, slowDelayMs: 2000 }); for (let i = 0; i < 40; i++) lim.fail('c' + i);
  const gate = lim.check('owner'); assert(gate.allowed && gate.delayMs === 2000, 'limiter: a global flood adds a delay, never a refusal');
  let blocked = ownerAuth.createLoginLimiter({ perClient: 2, windowMs: 1000, now: () => 1000 }); blocked.fail('a'); blocked.fail('a'); assert(!blocked.check('a').allowed && blocked.check('b').allowed, 'limiter: only the offending client is blocked');
  srv.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
