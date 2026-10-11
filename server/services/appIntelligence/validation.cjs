// server/services/appIntelligence/validation.cjs
//
// Input rules for registering / editing a monitored application. Returns clean
// values or a list of human-readable problems; never throws on bad input.
'use strict';

const net = require('net');
const { CHECK_TYPES, MODES } = require('./status.cjs');
const { isPrivateAddress } = require('./checker.cjs');

const ENVIRONMENTS = ['production', 'staging', 'development'];

function parseUrl(raw, { allowPrivate = process.env.APP_INTELLIGENCE_ALLOW_PRIVATE === 'true' } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'Enter a full URL, for example https://app.example.com.' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http:// and https:// addresses can be monitored.' };
  if (u.username || u.password) return { error: 'Remove the username and password from the URL. Credentials must never be stored here.' };
  if (u.search) return { error: 'Remove the query string (the part after ?). It can carry tokens, and health checks do not need one.' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, ''); // 'localhost.' is still localhost
  const internalName = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localdomain') || !host.includes('.') && !net.isIP(host);
  if (!allowPrivate && (internalName || (net.isIP(host) && isPrivateAddress(host)))) {
    return { error: 'This address points to a private or internal network. Only publicly reachable applications can be monitored.' };
  }
  u.hash = '';
  return { url: u };
}

function intInRange(value, min, max, label, errors, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${label} must be a whole number between ${min} and ${max}.`); return fallback; }
  return n;
}

function validateApplicationInput(body, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('name')) {
    const name = String(body.name || '').trim();
    if (!name) errors.push('Application name is required.');
    else if (name.length > 80) errors.push('Application name must be 80 characters or fewer.');
    else out.name = name;
  }
  if (has('description')) {
    const d = String(body.description || '').trim();
    if (d.length > 400) errors.push('Description must be 400 characters or fewer.');
    else out.description = d;
  }
  if (!partial || has('url')) {
    const parsed = parseUrl(body.url);
    if (parsed.error) errors.push(parsed.error); else out.url = parsed.url.toString();
  }
  if (!partial || has('environment')) {
    const env = String(body.environment || 'production').toLowerCase();
    if (!ENVIRONMENTS.includes(env)) errors.push(`Environment must be one of: ${ENVIRONMENTS.join(', ')}.`);
    else out.environment = env;
  }
  if (!partial || has('checkType')) {
    const t = String(body.checkType || 'homepage');
    if (!CHECK_TYPES[t]) errors.push(`Check type must be one of: ${Object.keys(CHECK_TYPES).join(', ')}.`);
    else out.checkType = t;
  }
  if (has('checkPath')) {
    const p = String(body.checkPath || '').trim();
    if (p && (!p.startsWith('/') || p.startsWith('//') || p.includes('://') || p.includes('\\') || p.includes('?') || p.includes('#') || p.includes('@') || p.length > 200)) errors.push('Health endpoint path must start with a single / (for example /health), with no query string.');
    else out.checkPath = p;
  }
  const exp = intInRange(body.expectedStatus, 100, 599, 'Expected HTTP status', errors, partial && !has('expectedStatus') ? undefined : 200);
  if (exp !== undefined) out.expectedStatus = exp;
  const interval = intInRange(body.intervalSeconds, 60, 86400, 'Check interval (seconds)', errors, partial && !has('intervalSeconds') ? undefined : 300);
  if (interval !== undefined) out.intervalSeconds = interval;
  const timeout = intInRange(body.timeoutMs, 1000, 30000, 'Timeout (ms)', errors, partial && !has('timeoutMs') ? undefined : 8000);
  if (timeout !== undefined) out.timeoutMs = timeout;
  // OFF unless the owner sets it. No default response-time limit is assumed (see the thresholds proposal in the docs).
  if (body.slowThresholdMs === null || body.slowThresholdMs === '' || (body.slowThresholdMs === undefined && !partial)) out.slowThresholdMs = null;
  else {
    const slow = intInRange(body.slowThresholdMs, 100, 30000, 'Slow-response threshold (ms)', errors, undefined);
    if (slow !== undefined) out.slowThresholdMs = slow;
  }
  if (has('enabled')) out.enabled = Boolean(body.enabled);
  if (has('mode')) {
    if (!MODES.includes(body.mode)) errors.push(`Check mode must be one of: ${MODES.join(', ')}.`);
    else out.mode = body.mode;
  }
  // A manual-only application is never probed on its own, and when the owner does check it the request must be
  // the lightest possible: a dedicated health endpoint, never the homepage.
  if (out.mode === 'manual_only' && out.checkType && out.checkType !== 'health_endpoint') errors.push('A manual-only application must use a health endpoint check, not a homepage check.');

  if (out.checkType === 'health_endpoint' && !partial && !out.checkPath) errors.push('A health endpoint path (for example /health) is required for this check type.');
  return { errors, value: out };
}

module.exports = { validateApplicationInput, parseUrl, ENVIRONMENTS };
