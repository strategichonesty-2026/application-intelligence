// test_appIntelligence_auth.cjs
// Proves that an unauthorised BROWSER client cannot use privileged monitoring operations, and that the
// sign-in and token design fails closed. Offline: local servers and a stub database only.
// Every assertion is a failure case (attacker behaviour), not just the happy path.
// Run: node test_appIntelligence_auth.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');

const PASSWORD = 'correct horse battery staple 42';
const SHARED_KEY = 'shared_key_THAT_SHIPS_IN_THE_BUNDLE_0123456789';
const SECRET = 'session-secret-' + 'z'.repeat(40);
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const listen = (app) => new Promise((r) => { const s = http.createServer(app); s.listen(0, '127.0.0.1', () => r({ server: s, url: `http://127.0.0.1:${s.address().port}` })); });

// Capture everything the server prints, to prove no secret reaches the logs.
const logged = [];
for (const m of ['log', 'warn', 'error']) { const o = console[m]; console[m] = (...a) => { logged.push(a.join(' ')); o.apply(console, a); }; }

(async () => {
  const hash = await ownerAuth.hashPassword(PASSWORD);
  const env = { APP_INTELLIGENCE_OWNER_PASSWORD_HASH: hash, APP_INTELLIGENCE_SESSION_SECRET: SECRET, API_SECRET_KEY: SHARED_KEY };
  Object.assign(process.env, env);

  // ═══ 1. Password hashing ═══
  assert(/^scrypt\$65536\$8\$2\$/.test(hash) && !hash.includes(PASSWORD), 'hash: scrypt with recorded parameters; password not contained');
  assert(await ownerAuth.verifyPassword(PASSWORD, hash) && !(await ownerAuth.verifyPassword(PASSWORD + 'x', hash)) && !(await ownerAuth.verifyPassword('', hash)), 'hash: right password verifies; wrong and empty do not');
  assert(!(await ownerAuth.verifyPassword('x'.repeat(5000), hash)), 'hash: absurdly long password refused (no CPU abuse)');
  assert(ownerAuth.parseHash('scrypt$2$1$1$AAAA$BBBB') === null && ownerAuth.parseHash('scrypt$16384$8$99$AAAA$BBBB') === null && ownerAuth.parseHash('md5$x') === null, 'hash: weak/absurd scrypt parameters and other formats are rejected');
  let short = false; try { await ownerAuth.hashPassword('short'); } catch { short = true; }
  assert(short, 'hash: a short owner password cannot be turned into a hash');
  assert(!(await ownerAuth.verifyPassword(PASSWORD, 'not-a-hash')), 'hash: a malformed stored value never verifies');

  // ═══ 2. Token forgery and abuse ═══
  const now = Date.now();
  const good = ownerAuth.issueToken(env, now).token;
  assert(ownerAuth.verifyToken(good, env, now + 1000) !== null, 'token: a freshly issued token verifies');
  assert(ownerAuth.verifyToken(good, env, now + 8 * 3600 * 1000 + 5000) === null, 'token: expired after 8 hours');
  const [h, p, s] = good.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), exp: 9999999999 })).toString('base64url');
  assert(ownerAuth.verifyToken(`${h}.${forgedPayload}.${s}`, env, now) === null, 'token: tampered payload (extended expiry) is rejected');
  assert(ownerAuth.verifyToken(good, { ...env, APP_INTELLIGENCE_SESSION_SECRET: 'other-secret-' + 'q'.repeat(40) }, now) === null, 'token: signed with a different secret is rejected');
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'AIT' })).toString('base64url');
  assert(ownerAuth.verifyToken(`${noneHeader}.${p}.`, env, now) === null && ownerAuth.verifyToken(`${noneHeader}.${p}.${s}`, env, now) === null, 'token: alg "none" is rejected');
  const rsHeader = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'AIT' })).toString('base64url');
  assert(ownerAuth.verifyToken(`${rsHeader}.${p}.${s}`, env, now) === null, 'token: algorithm switching is rejected');
  const mk = (payload) => { const body = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`; return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`; };
  const base = JSON.parse(Buffer.from(p, 'base64url'));
  assert(ownerAuth.verifyToken(mk({ ...base, aud: 'media-studio' }), env, now) === null, 'token: a correctly signed token for a different audience is rejected');
  assert(ownerAuth.verifyToken(mk({ ...base, iat: base.iat + 99999, exp: base.exp + 99999 }), env, now) === null, 'token: issued-in-the-future is rejected');
  assert(ownerAuth.verifyToken(good, { ...env, APP_INTELLIGENCE_SESSION_VERSION: '2' }, now) === null, 'token: bumping APP_INTELLIGENCE_SESSION_VERSION signs every session out');
  assert(['', 'abc', 'a.b', 'a.b.c', 'x'.repeat(5000), null, undefined, 123].every((t) => ownerAuth.verifyToken(t, env, now) === null), 'token: garbage of every shape is rejected without throwing');
  assert(!good.includes(PASSWORD) && !good.includes(SECRET) && !good.includes(hash), 'token: contains neither the password, the hash nor the signing secret');

  // ═══ 3. Fail closed when sign-in is not configured ═══
  const unconfigured = require('./server/routes/appIntelligence.cjs')({ query: async () => ({ rows: [] }) }, { env: {} });
  let app = express(); app.use(express.json()); app.use('/ai', unconfigured);
  let srv = await listen(app);
  let r = await fetch(`${srv.url}/ai/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) });
  assert(r.status === 503 && (await r.json()).code === 'auth_not_configured', 'fail-closed: no sign-in configured => login answers 503, never succeeds');
  r = await fetch(`${srv.url}/ai/summary`, { headers: { authorization: `Bearer ${good}`, 'x-api-key': SHARED_KEY } });
  assert(r.status === 503, 'fail-closed: no sign-in configured => data routes answer 503 even with a (previously valid) token and the shared key');
  srv.server.close();
  const weak = require('./server/routes/appIntelligence.cjs')({ query: async () => ({ rows: [] }) }, { env: { APP_INTELLIGENCE_OWNER_PASSWORD_HASH: hash, APP_INTELLIGENCE_SESSION_SECRET: 'tooshort' } });
  app = express(); app.use(express.json()); app.use('/ai', weak); srv = await listen(app);
  r = await fetch(`${srv.url}/ai/summary`, { headers: { authorization: `Bearer ${good}` } });
  assert(r.status === 503, 'fail-closed: a too-short signing secret is treated as not configured');
  srv.server.close();
  const cfg = ownerAuth.getConfig({ APP_INTELLIGENCE_OWNER_PASSWORD_HASH: 'junk', APP_INTELLIGENCE_SESSION_SECRET: 'x' });
  assert(!cfg.configured && cfg.invalid.length === 2 && !JSON.stringify(cfg).includes('junk'), 'config: invalid values are reported by NAME only, never echoed');

  // ═══ 4. Enumerated routes vs. every kind of browser client ═══
  const fakePool = { query: async () => ({ rows: [], rowCount: 0 }), connect: async () => { throw new Error('no db'); } };
  const limiter = ownerAuth.createLoginLimiter();
  const router = require('./server/routes/appIntelligence.cjs')(fakePool, { env, limiter, failDelayMs: 1, provider: { send: async () => ({ ok: false, retryable: false, error: 'stub' }) } });
  app = express(); app.set('trust proxy', 1); app.use(express.json()); app.use('/ai', router); srv = await listen(app);
  const routes = router.stack.filter((l) => l.route && l.route.path !== '/auth/login').flatMap((l) => Object.keys(l.route.methods).map((m) => ({ method: m.toUpperCase(), path: l.route.path.replace(/:id/, 'app-1') })));
  const call = (rt, headers) => fetch(`${srv.url}/ai${rt.path}`, { method: rt.method, headers: { 'content-type': 'application/json', ...headers }, body: ['GET', 'DELETE'].includes(rt.method) ? undefined : '{}' });
  const privileged = routes.filter((x) => x.method !== 'GET');
  assert(privileged.length >= 5 && privileged.some((x) => x.path === '/alerts/test') && privileged.some((x) => x.method === 'DELETE') && privileged.some((x) => x.path.endsWith('/check')), `routes: ${routes.length} protected, including privileged operations (${privileged.map((x) => x.method + ' ' + x.path).join(', ')})`);
  const attackers = [
    ['an anonymous browser (no headers)', {}],
    ['a visitor who copied the public x-api-key from the JS bundle', { 'x-api-key': SHARED_KEY }],
    ['the shared key sent as a Bearer token', { authorization: `Bearer ${SHARED_KEY}` }],
    ['an expired token', { authorization: `Bearer ${ownerAuth.issueToken(env, now - 9 * 3600 * 1000).token}` }],
    ['a forged token', { authorization: `Bearer ${h}.${forgedPayload}.${s}` }],
    ['a token signed with another secret', { authorization: `Bearer ${ownerAuth.issueToken({ ...env, APP_INTELLIGENCE_SESSION_SECRET: 'other-' + 'k'.repeat(40) }).token}` }],
    ['a lowercase "bearer" scheme / extra whitespace', { authorization: `bearer ${good}` }],
  ];
  for (const [who, headers] of attackers) {
    let bad = 0; let dataLeak = false;
    for (const rt of routes) { const res = await call(rt, headers); const t = await res.text(); if (res.status !== 401) bad++; if (/"success":true/.test(t)) dataLeak = true; }
    assert(bad === 0 && !dataLeak, `${who}: all ${routes.length} routes answer 401 (including ${privileged.length} privileged operations), no data returned`);
  }
  let ok = 0; for (const rt of routes) { const res = await call(rt, { authorization: `Bearer ${good}` }); if (res.status !== 401 && res.status !== 503) ok++; }
  assert(ok === routes.length, `owner token: all ${routes.length} routes are reachable (not 401/503), so the gate is not simply closing everything`);

  // ═══ 5. Sign-in: wrong passwords, rate limiting, secrecy ═══
  const login = (password, ip) => fetch(`${srv.url}/ai/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '203.0.113.9' }, body: JSON.stringify({ password }) });
  r = await login(PASSWORD, '198.51.100.1'); let body = await r.json();
  assert(r.status === 200 && body.success && ownerAuth.verifyToken(body.token, env) && !JSON.stringify(body).includes(PASSWORD) && !JSON.stringify(body).includes(hash), 'login: correct password returns a verifiable token and nothing else sensitive');
  r = await login('wrong-password-1'); const bad1 = await r.json();
  r = await login(undefined); const bad2 = await r.json();
  assert(bad1.code === 'bad_credentials' && bad2.code === 'bad_credentials' && !bad1.token && bad1.error === 'Incorrect password.', 'login: wrong/missing password gives one generic error and no token');
  r = await login({ $ne: 1 }); assert(r.status === 401, 'login: a non-string password (NoSQL-style object) is rejected');
  const statuses = []; for (let i = 0; i < 8; i++) statuses.push((await login('guess-' + i, '203.0.113.50')).status);
  assert(statuses.slice(0, 3).every((x) => x === 401) && statuses.includes(429), `login: brute force from one client is stopped (${statuses.join(',')})`);
  r = await login(PASSWORD, '203.0.113.50');
  assert(r.status === 429 && Number(r.headers.get('retry-after')) > 0, 'login: while locked out even the CORRECT password is refused, with Retry-After');
  r = await login(PASSWORD, '198.51.100.77');
  assert(r.status === 200, 'login: a different client is not locked out by someone else\'s guesses');
  // Spoofing: the caller controls the LEFT part of X-Forwarded-For; the trusted proxy appends the real address on the right.
  const sp = []; for (let i = 0; i < 8; i++) sp.push((await login('spoof-guess-' + i, `10.9.9.${i}, 203.0.113.60`)).status);
  assert(sp.includes(429), `login: inventing a different X-Forwarded-For on every guess does NOT dodge the per-client limit (${sp.join(',')})`);
  const g = ownerAuth.createLoginLimiter({ perClient: 5, slowAfter: 20, slowDelayMs: 2000 });
  for (let i = 0; i < 40; i++) g.fail('distributed-' + i);
  const brake = g.check('the-real-owner');
  assert(brake.allowed && brake.delayMs === 2000, 'login: a distributed flood only SLOWS sign-in (delay), it never locks the owner out');
  const t0 = 1000; let tt = t0; const lt = ownerAuth.createLoginLimiter({ perClient: 2, slowAfter: 99, windowMs: 1000, now: () => tt });
  lt.fail('a'); lt.fail('a'); const blockedNow = !lt.check('a').allowed; tt = t0 + 1500;
  assert(blockedNow && lt.check('a').allowed, 'login: the lockout expires after the window');
  srv.server.close();

  // ═══ 6. Secrets never appear in server output ═══
  const everything = logged.join('\n');
  assert(![PASSWORD, SECRET, hash, good].some((x) => everything.includes(x)), 'logs: no password, signing secret, password hash or token was printed during any of the above');

  // ═══ 7. Wiring in index.cjs and the browser code ═══
  const idx = fs.readFileSync('./server/index.cjs', 'utf8');
  assert(!/require\('cors'\)|cors\(/.test(idx) && /securityHeaders/.test(idx) && /trust proxy/.test(idx), 'wiring: same-origin app: no CORS middleware at all (cross-site pages are refused by the browser), security headers and an explicit proxy-trust setting are installed');
  const src = (f) => fs.readFileSync(f, 'utf8');
  const aiFiles = []; const walk = (d) => fs.readdirSync(d).forEach((n) => { const f = path.join(d, n); fs.statSync(f).isDirectory() ? walk(f) : /\.(jsx?|css)$/.test(n) && aiFiles.push(f); }); walk('./src/intelligence');
  const offenders = aiFiles.filter((f) => /VITE_API_KEY|x-api-key|API_SECRET/i.test(src(f)));
  assert(aiFiles.length > 20 && offenders.length === 0, `browser code: none of the ${aiFiles.length} console files references the shared API key or its header (${offenders.join(', ') || 'clean'})`);
  assert(!/localStorage/.test(src('./src/intelligence/data/auth.js')) && /sessionStorage/.test(src('./src/intelligence/data/auth.js')), 'browser code: the session token is kept in sessionStorage, not localStorage');
  assert(/Authorization:\s*`Bearer/.test(src('./src/intelligence/data/api.js')), 'browser code: requests use the session token');

  // ═══ 8. What a real production build ships (dummy key; Vite embeds VITE_* variables) ═══
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-bundle-'));
  const DUMMY = 'DUMMY_BUNDLE_KEY_' + crypto.randomBytes(8).toString('hex');
  const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { env: { ...process.env, VITE_API_KEY: DUMMY, VITE_API_URL: 'https://api.example.test' }, encoding: 'utf8' });
  const files = fs.existsSync(path.join(out, 'assets')) ? fs.readdirSync(path.join(out, 'assets')).filter((f) => f.endsWith('.js')) : [];
  const read = (f) => fs.readFileSync(path.join(out, 'assets', f), 'utf8');
  const consoleChunk = files.filter((f) => /Owner password/.test(read(f)));
  assert(build.status === 0 && files.length >= 1 && consoleChunk.length >= 1, `build: production build succeeded (${files.length} JS files; console chunk found)`);
  assert(consoleChunk.every((f) => !read(f).includes(DUMMY) && !/x-api-key/i.test(read(f))), 'BUILD: the Application Intelligence chunk contains neither the build-time key nor the x-api-key header name');
  const allText = fs.readdirSync(out, { recursive: true }).filter((f) => /\.(js|css|html|map)$/.test(String(f))).map((f) => fs.readFileSync(path.join(out, String(f)), 'utf8'));
  assert(allText.length >= 3 && allText.every((t) => !t.includes(DUMMY)), `BUILD: the build-time key (VITE_API_KEY) is in NONE of the ${allText.length} shipped files: this app never embeds one`);
  assert(allText.every((t) => !/x-api-key/i.test(t)), 'BUILD: no shipped file even contains the x-api-key header name');
  assert(allText.some((t) => /Authorization:\s*`Bearer|Authorization:"Bearer|Authorization:`Bearer/.test(t.replace(/\s/g, ''))) || allText.some((t) => t.includes('Bearer ')), 'BUILD: browser requests identify the user with a session token (Authorization: Bearer)');
  const srcFilesWithKey = []; const walkSrc = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walkSrc(f); else if (/\.(jsx?|cjs|mjs)$/.test(e.name) && /VITE_API_KEY/.test(fs.readFileSync(f, 'utf8'))) srcFilesWithKey.push(f); });
  walkSrc(path.join(__dirname, 'src'));
  assert(srcFilesWithKey.length === 0, `SOURCE: no front-end source file reads VITE_API_KEY (${srcFilesWithKey.join(', ') || 'clean'})`);
  fs.rmSync(out, { recursive: true, force: true });

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
