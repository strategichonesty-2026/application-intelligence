// server/services/appIntelligence/ownerAuth.cjs
//
// Owner sign-in for the Application Intelligence console.
//
// WHY: the Media Studio front-end ships the shared API key (VITE_API_KEY) inside its public JavaScript,
// so that key is not a secret and must never be what protects monitoring operations (register/delete
// applications, run checks, send email). This module replaces it for this API:
//
//   * the owner proves knowledge of a password that exists ONLY on the server (as a scrypt hash);
//   * the server returns a short-lived signed token (HMAC-SHA256, 8 h) scoped to this API only;
//   * the browser keeps it in sessionStorage (gone when the tab closes), never in the bundle;
//   * the shared x-api-key is NOT accepted by these routes at all.
//
// Fail closed: if the password hash or the signing secret is missing/invalid, sign-in and every
// protected route answer 503. They never fall back to "open".
//
// Nothing here ever logs, returns, or echoes a password, hash, secret or token.
'use strict';

const crypto = require('crypto');

const TOKEN_TTL_SECONDS = 8 * 60 * 60;
const MAX_PASSWORD_LENGTH = 200;
const MIN_PASSWORD_LENGTH = 16; // a passphrase; the only thing standing between the internet and the owner session
const DEFAULT_SCRYPT = { N: 65536, r: 8, p: 2 }; // 64 MiB per hash: one of OWASP's equivalent scrypt settings (N=2^16, r=8, p=2)
const MAX_CONCURRENT_VERIFICATIONS = 2; // bounds memory (~128 MiB) and CPU however many guesses arrive at once
const MIN_SECRET_LENGTH = 32;

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

// ── password hashing: scrypt$N$r$p$salt$hash (all base64url, parameters recorded in the string) ──
function scryptAsync(password, salt, N, r, p, len) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, len, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password, { N = DEFAULT_SCRYPT.N, r = DEFAULT_SCRYPT.r, p = DEFAULT_SCRYPT.p } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, N, r, p, 32);
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(key)}`;
}

function parseHash(stored) {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(String(stored || ''));
  if (!m) return null;
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (N < 16384 || N > 1048576 || (N & (N - 1)) !== 0 || r < 8 || r > 16 || p < 1 || p > 4) return null; // refuse weak or absurd parameters
  return { N, r, p, salt: unb64u(m[4]), hash: unb64u(m[5]) };
}

// At most MAX_CONCURRENT_VERIFICATIONS hashes run at once; the rest wait. A flood of guesses therefore
// cannot exhaust memory or starve the rest of the API, and cannot be answered faster than the hash allows.
let activeVerifications = 0; const waiting = [];
const acquire = () => new Promise((resolve) => { if (activeVerifications < MAX_CONCURRENT_VERIFICATIONS) { activeVerifications += 1; resolve(); } else waiting.push(resolve); });
const release = () => { const next = waiting.shift(); if (next) next(); else activeVerifications -= 1; };

async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed || typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
  await acquire();
  try {
    let key;
    try { key = await scryptAsync(password, parsed.salt, parsed.N, parsed.r, parsed.p, parsed.hash.length); } catch { return false; }
    return key.length === parsed.hash.length && crypto.timingSafeEqual(key, parsed.hash);
  } finally { release(); }
}

const sign = (data, secret) => b64u(crypto.createHmac('sha256', secret).update(data).digest());

// One profile per protected surface. Each has its OWN audience, token type, password hash, signing secret and
// session version, so a token (or secret) for one surface is worthless against the other.
const AI_PROFILE = { audience: 'app-intelligence', typ: 'AIT', passwordHashVar: 'APP_INTELLIGENCE_OWNER_PASSWORD_HASH', secretVar: 'APP_INTELLIGENCE_SESSION_SECRET', versionVar: 'APP_INTELLIGENCE_SESSION_VERSION' };

function createOwnerAuth(profile = AI_PROFILE) {
  const { audience, typ, passwordHashVar, secretVar, versionVar } = profile;
  const version = (env) => String(env[versionVar] || '1');

  // ── configuration (validated without ever revealing values) ──
  function getConfig(env = process.env) {
    const missing = []; const invalid = [];
    if (!env[passwordHashVar]) missing.push(passwordHashVar);
    else if (!parseHash(env[passwordHashVar])) invalid.push(`${passwordHashVar} (not a valid scrypt hash; create one with server/scripts/hashOwnerPassword.cjs)`);
    if (!env[secretVar]) missing.push(secretVar);
    else if (String(env[secretVar]).length < MIN_SECRET_LENGTH) invalid.push(`${secretVar} (must be at least ${MIN_SECRET_LENGTH} characters)`);
    return { configured: !missing.length && !invalid.length, missing, invalid };
  }

  function issueToken(env = process.env, now = Date.now()) {
    const header = b64u(JSON.stringify({ alg: 'HS256', typ }));
    const iat = Math.floor(now / 1000);
    const payload = b64u(JSON.stringify({ aud: audience, sub: 'owner', iat, exp: iat + TOKEN_TTL_SECONDS, ver: version(env), jti: crypto.randomBytes(8).toString('hex') }));
    const body = `${header}.${payload}`;
    return { token: `${body}.${sign(body, env[secretVar])}`, expiresAt: new Date((iat + TOKEN_TTL_SECONDS) * 1000).toISOString() };
  }

  /** Returns the payload for a valid token, or null. Never throws. */
  function verifyToken(token, env = process.env, now = Date.now()) {
    try {
      if (typeof token !== 'string' || token.length > 2000 || !env[secretVar]) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [h, p, s] = parts;
      const header = JSON.parse(unb64u(h).toString('utf8'));
      if (header.alg !== 'HS256' || header.typ !== typ) return null; // no "none", no alg switching
      const expected = Buffer.from(sign(`${h}.${p}`, env[secretVar]));
      const given = Buffer.from(s);
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
      const payload = JSON.parse(unb64u(p).toString('utf8'));
      const nowSec = Math.floor(now / 1000);
      if (payload.aud !== audience || payload.sub !== 'owner') return null;
      if (!Number.isFinite(payload.exp) || payload.exp <= nowSec) return null;
      if (!Number.isFinite(payload.iat) || payload.iat > nowSec + 60) return null;
      if (payload.ver !== version(env)) return null; // bump the version to revoke every session
      return payload;
    } catch { return null; }
  }

  return { getConfig, issueToken, verifyToken, passwordHashVar, secretVar, audience };
}

// ── brute-force protection ──
//  * PER CLIENT: after `perClient` failures in the window that client (and only that client) is refused (429).
//    "Client" is Express's req.ip, which honours X-Forwarded-For ONLY for the proxy hops the deployment trusts
//    (app.set('trust proxy', n)); a caller cannot choose its own identity by sending the header.
//  * GLOBAL: many failures from many clients never lock the owner out. Once `slowAfter` failures have happened
//    in the window every attempt is delayed by `slowDelayMs` (and hashing is serialised, see verifyPassword), so a
//    distributed guess is slowed to a crawl while the real owner, with the right password, still gets in.
function createLoginLimiter({ perClient = 5, slowAfter = 20, slowDelayMs = 2000, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const clients = new Map(); let globalHits = [];
  const prune = (arr, t) => arr.filter((x) => t - x < windowMs);
  return {
    check(client) {
      const t = now(); globalHits = prune(globalHits, t);
      const mine = prune(clients.get(client) || [], t); clients.set(client, mine);
      if (clients.size > 5000) clients.clear(); // bounded memory
      const blocked = mine.length >= perClient;
      return {
        allowed: !blocked,
        retryAfterSeconds: blocked ? Math.max(1, Math.ceil((mine[0] + windowMs - t) / 1000)) : 0,
        delayMs: globalHits.length >= slowAfter ? slowDelayMs : 0,
      };
    },
    fail(client) { const t = now(); globalHits.push(t); clients.set(client, [...prune(clients.get(client) || [], t), t]); },
    succeed(client) { clients.delete(client); },
  };
}

/**
 * Easy set-up: if APP_INTELLIGENCE_OWNER_PASSWORD (a passphrase of 16+ characters) is set and no hash is, the hash is
 * made at start-up, and a stable signing secret is derived from the passphrase when none is given. The passphrase
 * then lives as a service variable (the same place any secret lives), instead of a pre-made hash. A hash/secret that
 * is set always wins. Never logs or returns a value. Returns { mode, problems }.
 */
async function prepareAuthEnv(env = process.env) {
  const problems = [];
  const hasHash = Boolean(env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH);
  const plain = env.APP_INTELLIGENCE_OWNER_PASSWORD;
  let mode = 'hash';
  if (!hasHash && plain) {
    if (typeof plain !== 'string' || plain.length < MIN_PASSWORD_LENGTH) problems.push(`APP_INTELLIGENCE_OWNER_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (it is ${String(plain).length}).`);
    else {
      env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await hashPassword(plain);
      if (!env.APP_INTELLIGENCE_SESSION_SECRET) env.APP_INTELLIGENCE_SESSION_SECRET = crypto.createHmac('sha256', plain).update('application-intelligence/session-signing/v1').digest('base64url');
      mode = 'passphrase';
    }
  } else if (hasHash && plain) problems.push('Both APP_INTELLIGENCE_OWNER_PASSWORD_HASH and APP_INTELLIGENCE_OWNER_PASSWORD are set: the hash is used and the passphrase variable is ignored. Remove one of them.');
  const hint = String(env.APP_INTELLIGENCE_PASSWORD_HINT || '').trim();
  if (hint && plain && hint.toLowerCase().includes(String(plain).toLowerCase())) problems.push('APP_INTELLIGENCE_PASSWORD_HINT contains the passphrase itself, so it is NOT shown on the sign-in page. Write a reminder that does not reveal it.');
  const cfg = createOwnerAuth(AI_PROFILE).getConfig(env);
  if (!cfg.configured) problems.push(...cfg.missing.map((m) => `${m} is not set.`), ...cfg.invalid.map((m) => `${m}.`));
  return { mode, problems, configured: cfg.configured };
}

const ai = createOwnerAuth(AI_PROFILE);

module.exports = {
  hashPassword, verifyPassword, createLoginLimiter, parseHash, createOwnerAuth, prepareAuthEnv, AI_PROFILE, TOKEN_TTL_SECONDS, MIN_PASSWORD_LENGTH, DEFAULT_SCRYPT, MAX_CONCURRENT_VERIFICATIONS,
  // Application Intelligence instance (unchanged public API)
  getConfig: ai.getConfig, issueToken: ai.issueToken, verifyToken: ai.verifyToken,
};
