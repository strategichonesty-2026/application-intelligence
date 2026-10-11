// server/services/appIntelligence/checker.cjs
//
// Runs ONE HTTP check against a registered application and classifies it.
// Uses node:http/https directly (not fetch) so the address a connection
// really uses is validated at connect time, which closes the DNS-rebinding
// gap: a name that resolves to a public IP when registered cannot later be
// pointed at 169.254.169.254 or an internal service.
'use strict';

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { describeReason } = require('./status.cjs');
const egress = require('./egress.cjs');

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 64 * 1024;

function isPrivateAddress(addr) {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    const c = Number(addr.split('.')[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(addr)) {
    const l = addr.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('::ffff:')) return isPrivateAddress(l.slice(7));
    // unique-local, link-local, and prefixes that can embed an IPv4 address (NAT64, 6to4, Teredo)
    return /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('64:ff9b:') || l.startsWith('2002:') || l.startsWith('2001:0:') || l.startsWith('2001::');
  }
  return true;
}

function makeGuardedLookup(allowPrivate, resolver = dns.lookup) {
  return (hostname, options, cb) => {
    resolver(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        const e = new Error('blocked target'); e.code = 'EBLOCKED'; return cb(e);
      }
      if (options && options.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  };
}

function rawRequest(urlString, { timeoutMs, readBody, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    // IP literals never reach the DNS lookup hook, so guard them explicitly.
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && net.isIP(literal) && isPrivateAddress(literal)) {
      const e = new Error('blocked target'); e.code = 'EBLOCKED'; return reject(e);
    }
    const lib = url.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    let timedOut = false;
    const req = lib.request(url, {
      method: 'GET',
      lookup: makeGuardedLookup(allowPrivate),
      headers: { 'user-agent': 'ApplicationIntelligence-Monitor/1.0', accept: 'application/json, text/html;q=0.8, */*;q=0.5' },
    }, (res) => {
      const ms = Number((process.hrtime.bigint() - started) / 1000000n); // time to response headers
      if (!readBody) { res.destroy(); return resolve({ status: res.statusCode, ms, headers: res.headers, body: '' }); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= MAX_BODY_BYTES) chunks.push(c); else res.destroy(); });
      const done = () => (timedOut ? reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT_CHECK' })) : resolve({ status: res.statusCode, ms, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('end', done); res.on('close', done); res.on('error', done);
    });
    const timer = setTimeout(() => { timedOut = true; const e = new Error('timeout'); e.code = 'ETIMEDOUT_CHECK'; req.destroy(e); }, timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.on('response', (res) => res.on('close', () => clearTimeout(timer)));
    req.end();
  });
}

function classifyNetworkError(err) {
  const code = err && err.code;
  if (code === 'ETIMEDOUT_CHECK' || code === 'ETIMEDOUT') return 'timeout';
  if (code === 'EBLOCKED') return 'blocked_target';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failure';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'connection_reset';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN') return 'network_unreachable';
  if (typeof code === 'string' && (code.startsWith('CERT_') || code.startsWith('ERR_TLS') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_SSL_WRONG_VERSION_NUMBER')) return 'tls_error';
  return null; // unknown: treated as a monitoring-service problem, not an app failure
}

function interpretHealthBody(body) {
  let json;
  try { json = JSON.parse(body); } catch { return 'invalid_health_response'; }
  const raw = json && (json.status !== undefined ? json.status : json.ok !== undefined ? json.ok : json.healthy);
  if (raw === true) return 'ok';
  if (raw === false) return 'health_reports_unhealthy';
  if (typeof raw !== 'string') return 'invalid_health_response';
  const v = raw.toLowerCase();
  if (['ok', 'healthy', 'up', 'pass', 'passing', 'alive', 'ready'].includes(v)) return 'ok';
  if (['degraded', 'warn', 'warning', 'partial'].includes(v)) return 'health_reports_degraded';
  return 'health_reports_unhealthy';
}

// Field NAMES of a health response (never values), so a human can judge whether it checks dependencies.
// Names that look like private data (balances, accounts, tokens...) are dropped and flagged instead.
const SENSITIVE_KEY = /(balance|account|amount|transaction|iban|ssn|card|token|password|secret|email|phone|salary|invoice|statement|key)/i;
function describeShape(body) {
  let json; try { json = JSON.parse(body); } catch { return null; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const names = Object.keys(json).filter((k) => /^[A-Za-z0-9_\-]{1,32}$/.test(k)).slice(0, 20);
  const sensitive = names.some((k) => SENSITIVE_KEY.test(k));
  return sensitive ? { keys: [], sensitiveLooking: true } : { keys: names, sensitiveLooking: false };
}

function targetUrl(app) {
  if (app.checkType === 'health_endpoint' && app.checkPath) {
    const base = new URL(app.url);
    const target = new URL(app.checkPath, base);
    // A path such as //evil.test/x would silently switch the host. The check must stay on the registered origin.
    if (target.origin !== base.origin) { const e = new Error('blocked target'); e.code = 'EBLOCKED'; throw e; }
    return target.toString();
  }
  return app.url;
}

/**
 * @returns {{outcome, reason, httpStatus, responseMs, summary, checkedAt}}
 * Never throws. `request` is injectable for tests.
 */
async function runHttpCheck(app, opts = {}) {
  const { allowPrivate = false, request = rawRequest } = opts;
  let shapeOut = null;
  const checkedAt = new Date();
  const timeoutMs = app.timeoutMs || 8000;
  const expected = app.expectedStatus || 200;
  const ctx = { timeoutMs, expectedStatus: expected, slowMs: app.slowThresholdMs };
  const finish = (outcome, reason, httpStatus = null, responseMs = null) => ({
    outcome, reason, httpStatus, responseMs, checkedAt,
    summary: reason ? describeReason(reason, { ...ctx, httpStatus }) : null,
  });

  try {
    let url = targetUrl(app);
    let res;
    for (let hops = 0; ; hops += 1) {
      res = await request(url, { timeoutMs, readBody: app.checkType === 'health_endpoint', allowPrivate });
      if (res.status >= 300 && res.status < 400 && res.headers && res.headers.location && expected !== res.status) {
        if (hops >= MAX_REDIRECTS) return finish('failed', 'redirect_loop', res.status, res.ms);
        const next = new URL(res.headers.location, url);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') { const e = new Error('blocked target'); e.code = 'EBLOCKED'; throw e; }
        url = next.toString();
        continue;
      }
      break;
    }

    if (res.status === 401 || res.status === 403) return finish('inconclusive', 'auth_required', res.status, res.ms);
    if (res.status >= 500) return finish('failed', 'http_5xx', res.status, res.ms);
    const statusOk = app.checkType === 'homepage'
      ? (res.status === expected || (expected === 200 && res.status >= 200 && res.status < 300))
      : res.status === expected;
    // A server that ANSWERS 404/4xx is up. That is "could not verify" (wrong or moved path), never an outage.
    if (!statusOk) return finish('inconclusive', res.status === 404 || res.status === 410 ? 'not_found' : res.status >= 400 ? 'client_error' : 'unexpected_status', res.status, res.ms);

    if (app.checkType === 'health_endpoint') {
      const verdict = interpretHealthBody(res.body);
      // An unreadable health answer cannot verify OR refute health: "unable to verify", not a failure.
      if (verdict === 'invalid_health_response') return finish('inconclusive', verdict, res.status, res.ms);
      if (verdict !== 'ok') return finish(verdict === 'health_reports_degraded' ? 'degraded' : 'failed', verdict, res.status, res.ms);
      if (opts.captureShape) shapeOut = describeShape(res.body);
    }
    if (app.slowThresholdMs && res.ms > app.slowThresholdMs) return finish('degraded', 'slow_response', res.status, res.ms);
    const okResult = finish('ok', null, res.status, res.ms);
    if (shapeOut) okResult.healthShape = shapeOut;
    return okResult;
  } catch (err) {
    const reason = classifyNetworkError(err);
    // Refusing to contact an internal address is a policy decision, not an application failure and not a
    // monitoring-service crash: report it as "could not verify".
    if (reason === 'blocked_target') return finish('inconclusive', 'blocked_target');
    if (reason) return finish('failed', reason);
    return finish('monitor_error', 'monitor_internal');
  }
}

const RETRYABLE = new Set(['timeout', 'dns_failure', 'connection_refused', 'connection_reset', 'network_unreachable']);
// Failure kinds that a dead monitor network can also produce. Only these trigger the control probe.
const NETWORK_LEVEL = new Set(['timeout', 'dns_failure', 'connection_reset', 'network_unreachable']);

/**
 * One quick confirmation retry for network-level failures only (a dropped packet
 * or a deploy restart should not count as a failed check). HTTP answers such as
 * 500 are real answers and are not retried; the 3-in-a-row incident rule covers them.
 * If the failure persists and the control probe shows the MONITOR has no internet
 * access, the result becomes a monitoring fault instead of an application failure.
 */
async function runCheckWithRetry(app, opts = {}) {
  const { retryDelayMs = 2000, run = runHttpCheck, hasEgress = egress.hasEgress, ...rest } = opts;
  let result = await run(app, rest);
  if (result.outcome !== 'failed' || !RETRYABLE.has(result.reason)) return result;
  await new Promise((r) => setTimeout(r, retryDelayMs));
  result = await run(app, rest);
  if (result.outcome === 'failed' && NETWORK_LEVEL.has(result.reason) && !(await hasEgress())) {
    return { ...result, outcome: 'monitor_error', reason: 'monitor_no_egress', httpStatus: null, responseMs: null, summary: describeReason('monitor_no_egress') };
  }
  return result;
}

module.exports = { makeGuardedLookup, rawRequest, runCheckWithRetry, runHttpCheck, isPrivateAddress, interpretHealthBody, classifyNetworkError };
