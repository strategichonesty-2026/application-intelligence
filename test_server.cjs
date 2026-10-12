// test_server.cjs: the standalone server as deployed (real Express app from server/index.cjs, fake database).
// Proves the separation and hardening properties: one origin, no CORS, strict CSP, no key accepted, small bodies,
// spoof-proof sign-in throttle, health route, static serving. Offline, dummy credentials. Run: node test_server.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.NODE_ENV = 'test';
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const { createApp } = require('./server/index.cjs');
const { CSP } = require('./server/middleware/securityHeaders.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const listen = (app) => new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const PASSWORD = 'dummy standalone passphrase 2026';

(async () => {
  const env = process.env;
  env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuth.hashPassword(PASSWORD);
  env.APP_INTELLIGENCE_SESSION_SECRET = 'standalone-secret-'.padEnd(48, 's');
  env.API_SECRET_KEY = 'dummy_key_that_must_not_open_anything_0123456789';
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-dist-'));
  fs.mkdirSync(path.join(dist, 'assets')); fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>'); fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const pool = { query: async () => ({ rows: [{ n: 0 }] }), connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) };
  const srv = await listen(createApp({ pool, dist })); const base = `http://127.0.0.1:${srv.address().port}`;
  const get = (p, h = {}) => fetch(base + p, { headers: h, redirect: 'manual' });
  const login = (password, xff) => fetch(`${base}/api/app-intelligence/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(xff ? { 'x-forwarded-for': xff } : {}) }, body: JSON.stringify({ password }) });

  // ── serving ──
  let r = await get('/healthz'); let b = await r.json();
  assert(r.status === 200 && b.status === 'ok' && !/database|postgres/i.test(JSON.stringify(b)), 'health: /healthz answers without credentials and reveals nothing about the database');
  r = await get('/'); const html = await r.text();
  assert(r.status === 200 && html.includes('id="root"'), 'static: the console shell is served at /');
  r = await get('/applications/anything'); assert(r.status === 200 && (await r.text()).includes('id="root"'), 'static: unknown non-API paths fall back to the console shell');
  r = await get('/assets/app-abc123.js'); assert(r.status === 200 && /immutable/.test(r.headers.get('cache-control')), 'static: hashed assets are cached as immutable');
  r = await get('/'); assert(r.headers.get('cache-control') === 'no-store', 'static: the HTML shell is never cached');
  r = await get('/api/nope'); assert(r.status === 404 && (await r.json()).success === false, 'api: unknown API paths answer JSON 404 (not the HTML shell)');

  // ── headers ──
  const h = (await get('/')).headers;
  assert(h.get('content-security-policy') === CSP && /connect-src 'self'/.test(CSP) && /script-src 'self'/.test(CSP) && /default-src 'none'/.test(CSP) && /frame-ancestors 'none'/.test(CSP), 'headers: strict CSP (own origin only: scripts, connections, framing)');
  assert(h.get('x-content-type-options') === 'nosniff' && h.get('referrer-policy') === 'no-referrer' && h.get('x-frame-options') === 'DENY' && !h.get('x-powered-by'), 'headers: nosniff, no referrer, no framing, no x-powered-by');
  const ch = (await fetch(`${base}/api/app-intelligence/summary`, { headers: { origin: 'https://evil.example', authorization: 'Bearer x' } })).headers;
  assert(!ch.get('access-control-allow-origin'), 'cors: no cross-origin permission is ever granted (same-origin app, no CORS middleware)');
  const pre = await fetch(`${base}/api/app-intelligence/summary`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert(!pre.headers.get('access-control-allow-origin'), 'cors: a cross-site preflight gets no permission');

  // ── authentication ──
  r = await get('/api/app-intelligence/summary'); assert(r.status === 401, 'auth: the API refuses anonymous callers');
  r = await get('/api/app-intelligence/summary', { 'x-api-key': env.API_SECRET_KEY }); assert(r.status === 401, 'auth: no shared API key exists in this app; a key header opens nothing');
  r = await login(PASSWORD, '198.51.100.1'); b = await r.json(); const token = b.token;
  assert(r.status === 200 && typeof token === 'string', 'auth: sign-in with the right passphrase returns a session token');
  r = await get('/api/app-intelligence/auth/session', { authorization: `Bearer ${token}` }); assert(r.status === 200, 'auth: the token opens the session check');
  r = await get('/api/app-intelligence/inventory', { authorization: `Bearer ${token}` }); assert(r.status !== 401 && r.status !== 503, 'auth: the token reaches protected routes (inventory)');
  const expired = ownerAuth.issueToken(env, Date.now() - 9 * 3600 * 1000).token;
  r = await get('/api/app-intelligence/summary', { authorization: `Bearer ${expired}` }); assert(r.status === 401, 'auth: an expired token is refused');
  const savedVer = env.APP_INTELLIGENCE_SESSION_VERSION; env.APP_INTELLIGENCE_SESSION_VERSION = '2';
  r = await get('/api/app-intelligence/summary', { authorization: `Bearer ${token}` }); assert(r.status === 401, 'auth: bumping APP_INTELLIGENCE_SESSION_VERSION signs everyone out');
  if (savedVer === undefined) delete env.APP_INTELLIGENCE_SESSION_VERSION; else env.APP_INTELLIGENCE_SESSION_VERSION = savedVer;

  // ── sign-in help (public, no secrets) ──
  r = await get('/api/app-intelligence/auth/hint'); b = await r.json();
  assert(r.status === 200 && b.minLength === 16 && b.hint === null, 'hint: public, says the minimum length, and shows no hint when none is configured');
  env.APP_INTELLIGENCE_PASSWORD_HINT = '  the four words about my kitchen  '; r = await get('/api/app-intelligence/auth/hint'); b = await r.json();
  assert(b.hint === 'the four words about my kitchen', 'hint: the owner\'s reminder is shown (trimmed)');
  env.APP_INTELLIGENCE_OWNER_PASSWORD = PASSWORD; env.APP_INTELLIGENCE_PASSWORD_HINT = `it starts with ${PASSWORD.toUpperCase()}`; r = await get('/api/app-intelligence/auth/hint'); b = await r.json();
  assert(b.hint === null && !JSON.stringify(b).toLowerCase().includes(PASSWORD.toLowerCase()), 'hint: a hint that contains the passphrase is never shown');
  env.APP_INTELLIGENCE_PASSWORD_HINT = 'sk_' + 'a'.repeat(30); r = await get('/api/app-intelligence/auth/hint'); b = await r.json(); assert(b.hint === null, 'hint: anything shaped like a key is never shown');
  env.APP_INTELLIGENCE_PASSWORD_HINT = 'x'.repeat(500); r = await get('/api/app-intelligence/auth/hint'); b = await r.json(); assert(b.hint.length === 120, 'hint: capped at 120 characters');
  delete env.APP_INTELLIGENCE_OWNER_PASSWORD; delete env.APP_INTELLIGENCE_PASSWORD_HINT;

  // ── bodies and throttling ──
  r = await fetch(`${base}/api/app-intelligence/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x', pad: 'a'.repeat(200 * 1024) }) });
  assert(r.status === 413, `bodies: a 200 kB body is refused with 413 before parsing (got ${r.status})`);
  r = await fetch(`${base}/api/app-intelligence/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' }); assert(r.status === 400, 'bodies: malformed JSON answers 400, not a stack trace');
  const st = []; for (let i = 0; i < 8; i++) st.push((await login('wrong guess ' + i, `10.7.7.${i}, 203.0.113.77`)).status);
  assert(st.slice(0, 5).every((x) => x === 401) && st.slice(5).every((x) => x === 429), `throttle: inventing a different X-Forwarded-For per guess does not help; the real client is stopped after 5 (${st.join(',')})`);

  // ── fail closed ──
  const savedHash = env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH; delete env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH;
  r = await login(PASSWORD, '203.0.113.200'); b = await r.json(); assert(r.status === 503 && b.code === 'auth_not_configured', 'fail closed: with no password configured sign-in answers 503 and nothing opens');
  env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = savedHash;
  srv.close();
  const missing = await listen(createApp({ pool, dist: path.join(dist, 'missing') })); r = await fetch(`http://127.0.0.1:${missing.address().port}/`); assert(r.status === 503, 'start-up: without a built console the server says so clearly (503) instead of crashing'); missing.close();

  // ── project hygiene ──
  const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  assert(!pkg.dependencies.cors && Object.keys(pkg.dependencies).sort().join() === 'dotenv,express,pg,react,react-dom', `dependencies: only ${Object.keys(pkg.dependencies).join(', ')} (no media, AI or provider SDKs)`);
  const files = ['server/index.cjs', 'server/db.cjs', ...fs.readdirSync('server/services/appIntelligence').filter((f) => f !== 'safe.cjs').map((f) => `server/services/appIntelligence/${f}`), 'server/routes/appIntelligence.cjs']; // safe.cjs only lists names to redact from logs
  assert(files.every((f) => !/media-studio|MEDIA_STUDIO|API_SECRET_KEY|studioAuth/.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''))), 'separation: no server code refers to Media Studio, its sign-in or its shared key');
  assert(!fs.existsSync('./server/middleware/auth.cjs'), 'separation: there is no shared-key middleware in this app');

  fs.rmSync(dist, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
