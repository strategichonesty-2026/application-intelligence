// server/services/appIntelligence/inventory.cjs
//
// Secrets & Subscriptions: a hand-maintained INVENTORY of credentials and paid subscriptions.
//
//   * It stores METADATA ONLY: names, providers, environment-variable NAMES, where the value is kept
//     (a password-manager entry or a dashboard path), status, dates, who depends on it. It never stores,
//     shows, imports or logs a secret value, and it rejects any field that looks like one.
//   * Nothing here talks to a provider. Statuses, dates and prices are what the owner recorded; a credential is
//     only "verified"/"revoked" if the owner says so AND records evidence and a verification date. The page says
//     plainly that it is manually maintained, not live.
'use strict';

const crypto = require('crypto');

const CREDENTIAL_STATUSES = ['active', 'rotation_required', 'exposed', 'pending_migration', 'revoked', 'unknown'];
const VERIFICATION = ['verified', 'inferred', 'unknown'];
const CONSUMER_MIGRATION = ['not_needed', 'pending', 'migrated', 'unknown'];
const SUBSCRIPTION_STATUSES = ['active', 'cancelled', 'unknown'];
const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'usage', 'free', 'unknown'];
const PRICE_BASIS = ['verified', 'estimate', 'unknown'];
const ENVIRONMENTS = ['production', 'staging', 'development', 'all'];
const MAX_ROWS = 300;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_credentials (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    provider         TEXT NOT NULL DEFAULT '',
    environment      TEXT NOT NULL DEFAULT 'production',
    applications     JSONB NOT NULL DEFAULT '[]',
    env_var_name     TEXT NOT NULL DEFAULT '',
    purpose          TEXT NOT NULL DEFAULT '',
    permissions      TEXT NOT NULL DEFAULT '',
    storage_reference TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'unknown',
    last_verified_at DATE,
    last_rotated_at  DATE,
    next_review_at   DATE,
    verification     TEXT NOT NULL DEFAULT 'unknown',
    evidence         TEXT NOT NULL DEFAULT '',
    consumers        JSONB NOT NULL DEFAULT '[]',
    migration_notes  TEXT NOT NULL DEFAULT '',
    revocation_impact TEXT NOT NULL DEFAULT '',
    rotation_step    INTEGER,
    rollback_notes   TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS ai_subscriptions (
    id               TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,
    service          TEXT NOT NULL DEFAULT '',
    applications     JSONB NOT NULL DEFAULT '[]',
    plan             TEXT NOT NULL DEFAULT '',
    price            NUMERIC(12,2),
    currency         TEXT NOT NULL DEFAULT 'USD',
    price_basis      TEXT NOT NULL DEFAULT 'unknown',
    billing_frequency TEXT NOT NULL DEFAULT 'unknown',
    renewal_date     DATE,
    trial_ends_at    DATE,
    usage_limits     TEXT NOT NULL DEFAULT '',
    spending_cap     TEXT NOT NULL DEFAULT '',
    cap_status       TEXT NOT NULL DEFAULT 'unknown',
    status           TEXT NOT NULL DEFAULT 'unknown',
    account_url      TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    last_verified_at DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// ── Never accept anything that looks like a secret value ──────────────────────────────────────────────
// Deliberately broad: a false positive costs the owner a reworded note; a false negative would put a live
// credential in a database and on a screen. The offending FIELD is named in the error, never its content.
const SECRET_SHAPES = [
  /(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])/,                         // hex keys / hashes
  /(?<![A-Za-z0-9])(sk|pk|rk|re|r8|ghp|gho|ghu|ghs|xox[bpsa]|AKIA|AIza)[-_][A-Za-z0-9_-]{12,}/, // provider prefixes
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/,
  /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,                             // JWT
  /\bscrypt\$\d+\$/,                                                          // our own password hash format
  /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/,                                          // Telegram bot token
  /(?<![A-Za-z0-9/])(?=[A-Za-z0-9+/_=-]{32,}(?![A-Za-z0-9+/_=-]))(?=[A-Za-z0-9+/_=-]*\d)(?=[A-Za-z0-9+/_=-]*[A-Za-z])(?=[A-Za-z0-9+/_=-]*[A-Z])[A-Za-z0-9+/_=-]{32,}/, // long mixed-case token-like run
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,                               // credentials inside a URL
  /[?&](api[_-]?key|key|token|secret|password|access[_-]?token|sig|signature)=/i, // secret in a query string
];
function looksLikeSecret(text) { return typeof text === 'string' && SECRET_SHAPES.some((re) => re.test(text)); }

function collectStrings(value, path, out) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collectStrings(v, `${path}.${k}`, out);
}
function findSecretFields(record) {
  const strings = []; collectStrings(record, '', strings);
  return strings.filter(([, v]) => looksLikeSecret(v)).map(([p]) => p.replace(/^\./, '') || 'value');
}

// ── validation ─────────────────────────────────────────────────────────────────────────────────────────
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const today = (now) => new Date(now).toISOString().slice(0, 10);

function list(value, max, itemMax, label, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) { errors.push(`${label} must be a list of at most ${max} entries.`); return []; }
  return value.map((x) => str(x, itemMax)).filter(Boolean);
}
function optDate(body, key, label, errors, { allowFuture = true, now } = {}) {
  const v = body[key];
  if (v === undefined || v === null || v === '') return null;
  if (!isDate(v)) { errors.push(`${label} must be a date (YYYY-MM-DD).`); return null; }
  if (!allowFuture && v > today(now)) { errors.push(`${label} cannot be in the future: it records something that already happened.`); return null; }
  return v;
}
const oneOf = (v, set, label, errors, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  if (!set.includes(v)) { errors.push(`${label} must be one of: ${set.join(', ')}.`); return fallback; }
  return v;
};

function validateConsumers(raw, errors) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 40) { errors.push('Consumers must be a list of at most 40 entries.'); return []; }
  return raw.map((c, i) => {
    if (!c || typeof c !== 'object') { errors.push(`Consumer ${i + 1} must be an object.`); return null; }
    const name = str(c.name, 120);
    if (!name) { errors.push(`Consumer ${i + 1} needs a name.`); return null; }
    return {
      name,
      environment: oneOf(c.environment, ENVIRONMENTS, `Consumer ${i + 1} environment`, errors, 'production'),
      authMethod: str(c.authMethod, 120),
      verification: oneOf(c.verification, VERIFICATION, `Consumer ${i + 1} verification`, errors, 'unknown'),
      migration: oneOf(c.migration, CONSUMER_MIGRATION, `Consumer ${i + 1} migration status`, errors, 'unknown'),
      impact: str(c.impact, 400),
    };
  }).filter(Boolean);
}

/** Returns { errors, value }. `partial` = PATCH (only supplied fields are validated). Never throws. */
function validateCredential(body, { partial = false, now = Date.now() } = {}) {
  const errors = []; const out = {}; const has = (k) => body[k] !== undefined;
  if (!body || typeof body !== 'object') return { errors: ['Send a JSON object.'], value: {} };
  const leaks = findSecretFields(body);
  if (leaks.length) return { errors: [`The field "${leaks[0]}" looks like a secret value. This page stores only names and references, never the secret itself. Reword it (for example "stored in the password manager, entry 'X'").`], value: {} };

  if (!partial || has('name')) { const n = str(body.name, 120); if (!n) errors.push('Credential name is required.'); else out.name = n; }
  if (has('provider')) out.provider = str(body.provider, 80);
  if (has('environment')) out.environment = oneOf(body.environment, ENVIRONMENTS, 'Environment', errors, 'production');
  if (has('applications')) out.applications = list(body.applications, 30, 120, 'Applications', errors);
  if (has('envVarName')) {
    const v = str(body.envVarName, 80);
    if (v && !/^[A-Za-z][A-Za-z0-9_]{1,79}$/.test(v)) errors.push('The environment variable NAME may only contain letters, digits and underscores (it is a name, not a value).');
    else out.envVarName = v;
  }
  for (const [k, max] of [['purpose', 500], ['permissions', 500], ['storageReference', 300], ['evidence', 1000], ['migrationNotes', 1500], ['revocationImpact', 1000], ['rollbackNotes', 1500]]) if (has(k)) out[k] = str(body[k], max);
  if (has('status')) out.status = oneOf(body.status, CREDENTIAL_STATUSES, 'Status', errors, 'unknown');
  if (has('verification')) out.verification = oneOf(body.verification, VERIFICATION, 'Verification', errors, 'unknown');
  if (has('lastVerifiedAt')) out.lastVerifiedAt = optDate(body, 'lastVerifiedAt', 'Last verified', errors, { allowFuture: false, now });
  if (has('lastRotatedAt')) out.lastRotatedAt = optDate(body, 'lastRotatedAt', 'Last rotated', errors, { allowFuture: false, now });
  if (has('nextReviewAt')) out.nextReviewAt = optDate(body, 'nextReviewAt', 'Next review', errors, { now });
  if (has('rotationStep')) {
    if (body.rotationStep === null || body.rotationStep === '') out.rotationStep = null;
    else if (Number.isInteger(body.rotationStep) && body.rotationStep >= 1 && body.rotationStep <= 99) out.rotationStep = body.rotationStep;
    else errors.push('Rotation step must be a whole number from 1 to 99.');
  }
  if (has('consumers')) out.consumers = validateConsumers(body.consumers, errors);
  return { errors, value: out };
}

/** Rules that need the whole record: nothing is "verified", "rotated" or "revoked" without evidence. */
function checkCredentialClaims(rec) {
  const errors = [];
  const evidence = String(rec.evidence || '').trim();
  if (rec.verification === 'verified' && (!evidence || !rec.lastVerifiedAt)) errors.push('"Verified" needs evidence (what you checked and where) and the date you checked it.');
  if (rec.status === 'revoked' && (!evidence || !rec.lastVerifiedAt)) errors.push('"Revoked" needs evidence that the key was revoked at the provider and the date you confirmed it. Nothing is revoked by this page.');
  if (rec.lastRotatedAt && !evidence) errors.push('A rotation date needs evidence (for example "new key created in the provider dashboard, old one deleted"). Nothing is rotated by this page.');
  return errors;
}

function validateSubscription(body, { partial = false, now = Date.now() } = {}) {
  const errors = []; const out = {}; const has = (k) => body[k] !== undefined;
  if (!body || typeof body !== 'object') return { errors: ['Send a JSON object.'], value: {} };
  const leaks = findSecretFields(body);
  if (leaks.length) return { errors: [`The field "${leaks[0]}" looks like a secret value. This page stores no secrets.`], value: {} };

  if (!partial || has('provider')) { const p = str(body.provider, 80); if (!p) errors.push('Provider is required.'); else out.provider = p; }
  if (has('service')) out.service = str(body.service, 120);
  if (has('applications')) out.applications = list(body.applications, 30, 120, 'Applications', errors);
  if (has('plan')) out.plan = str(body.plan, 120);
  if (has('currency')) { const c = str(body.currency, 3).toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) errors.push('Currency must be a 3-letter code such as USD.'); else out.currency = c; }
  if (has('billingFrequency')) out.billingFrequency = oneOf(body.billingFrequency, BILLING_FREQUENCIES, 'Billing frequency', errors, 'unknown');
  if (has('priceBasis')) out.priceBasis = oneOf(body.priceBasis, PRICE_BASIS, 'Price basis', errors, 'unknown');
  if (has('price')) {
    if (body.price === null || body.price === '') out.price = null;
    else if (typeof body.price === 'number' && Number.isFinite(body.price) && body.price >= 0 && body.price <= 1e7) out.price = Math.round(body.price * 100) / 100;
    else errors.push('Price must be a number of 0 or more.');
  }
  if (has('status')) out.status = oneOf(body.status, SUBSCRIPTION_STATUSES, 'Status', errors, 'unknown');
  if (has('renewalDate')) out.renewalDate = optDate(body, 'renewalDate', 'Renewal date', errors, { now });
  if (has('trialEndsAt')) out.trialEndsAt = optDate(body, 'trialEndsAt', 'Trial end', errors, { now });
  if (has('lastVerifiedAt')) out.lastVerifiedAt = optDate(body, 'lastVerifiedAt', 'Last verified', errors, { allowFuture: false, now });
  for (const [k, max] of [['usageLimits', 500], ['spendingCap', 300], ['notes', 1500]]) if (has(k)) out[k] = str(body[k], max);
  if (has('capStatus')) out.capStatus = oneOf(body.capStatus, ['verified', 'unverified', 'not_supported', 'unknown'], 'Cap status', errors, 'unknown');
  if (has('accountUrl')) {
    const u = str(body.accountUrl, 300);
    if (u) {
      let parsed; try { parsed = new URL(u); } catch { parsed = null; }
      if (!parsed || parsed.protocol !== 'https:') errors.push('The billing/account URL must be a full https:// address.');
      else if (parsed.username || parsed.password || parsed.search || parsed.hash) errors.push('Remove credentials, query strings and fragments from the URL: use the plain account page address.');
      else out.accountUrl = parsed.toString();
    } else out.accountUrl = '';
  }
  return { errors, value: out };
}

function checkSubscriptionClaims(rec) {
  const errors = [];
  if (rec.priceBasis && rec.priceBasis !== 'unknown' && (rec.price === null || rec.price === undefined)) errors.push('A price basis of "verified" or "estimate" needs a price. Leave the basis as "unknown" if you do not know it.');
  if (rec.priceBasis === 'verified' && !rec.lastVerifiedAt) errors.push('A verified price needs the date you checked it.');
  if (rec.price !== null && rec.price !== undefined && (!rec.priceBasis || rec.priceBasis === 'unknown')) errors.push('Say whether the price is "verified" or an "estimate".');
  return errors;
}

// ── pure summaries (all take `now` so they are testable) ────────────────────────────────────────────────
function summarizeCredentials(creds, now = Date.now()) {
  const counts = Object.fromEntries(CREDENTIAL_STATUSES.map((s) => [s, 0]));
  const t = today(now); const needsReview = [];
  for (const c of creds) {
    counts[c.status] = (counts[c.status] || 0) + 1;
    const overdue = c.nextReviewAt && c.nextReviewAt <= t && c.status !== 'revoked';
    const attention = ['rotation_required', 'exposed', 'pending_migration'].includes(c.status);
    if (attention || overdue) needsReview.push({ id: c.id, name: c.name, status: c.status, reason: attention ? c.status : 'review_due' });
  }
  const verification = { verified: 0, inferred: 0, unknown: 0 };
  creds.forEach((c) => { verification[c.verification] = (verification[c.verification] || 0) + 1; });
  return { total: creds.length, byStatus: counts, verification, needsReview };
}

const MONTHS = { monthly: 1, quarterly: 3, annual: 12 };
/** Per-currency totals. Only ACTIVE, priced, periodic subscriptions are summed; verified and estimated are kept apart. */
function costSummary(subs) {
  const byCurrency = {}; let missingPrice = 0; let usageBased = 0; let unknownStatus = 0; let active = 0; let cancelled = 0;
  for (const s of subs) {
    if (s.status === 'cancelled') { cancelled += 1; continue; }
    if (s.status === 'unknown') unknownStatus += 1; else active += 1;
    if (s.status !== 'active') continue; // unknown-status rows never inflate a total
    if (s.billingFrequency === 'usage') { usageBased += 1; continue; }
    const months = s.billingFrequency === 'free' ? 1 : MONTHS[s.billingFrequency];
    const price = s.billingFrequency === 'free' ? 0 : s.price;
    if (!months || price === null || price === undefined || s.priceBasis === 'unknown') { missingPrice += 1; continue; }
    const c = (byCurrency[s.currency] = byCurrency[s.currency] || { monthlyVerified: 0, monthlyEstimated: 0, annualVerified: 0, annualEstimated: 0, verifiedCount: 0, estimatedCount: 0 });
    const monthly = Number(price) / months;
    if (s.priceBasis === 'verified') { c.monthlyVerified += monthly; c.annualVerified += monthly * 12; c.verifiedCount += 1; }
    else { c.monthlyEstimated += monthly; c.annualEstimated += monthly * 12; c.estimatedCount += 1; }
  }
  for (const c of Object.values(byCurrency)) for (const k of Object.keys(c)) if (k.startsWith('monthly') || k.startsWith('annual')) c[k] = Math.round(c[k] * 100) / 100;
  return { byCurrency, missingPrice, usageBased, unknownStatus, activeCount: active, cancelledCount: cancelled, total: subs.length };
}

function daysBetween(fromIso, toIso) { return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000); }
/** Renewals and trial expirations within `withinDays` (past-due dates are flagged, not hidden). Active/unknown only. */
function upcomingDates(subs, now = Date.now(), withinDays = 45) {
  const t = today(now); const out = [];
  for (const s of subs) {
    if (s.status === 'cancelled') continue;
    for (const [kind, date] of [['renewal', s.renewalDate], ['trial_end', s.trialEndsAt]]) {
      if (!date) continue;
      const days = daysBetween(t, date);
      if (days <= withinDays) out.push({ id: s.id, provider: s.provider, service: s.service, kind, date, daysAway: days, overdue: days < 0 });
    }
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}

/** Per-credential dependency view: what breaks, what must be migrated first, and whether it is safe to rotate. */
function dependencyView(cred) {
  const consumers = cred.consumers || [];
  const blockers = consumers.filter((c) => c.migration === 'pending' || c.migration === 'unknown');
  const unverified = consumers.filter((c) => c.verification !== 'verified');
  let readiness;
  if (cred.status === 'revoked') readiness = 'already_revoked';
  else if (!consumers.length) readiness = 'unknown_consumers';
  else if (blockers.length) readiness = 'blocked_by_consumers';
  else if (unverified.length) readiness = 'verify_consumers_first';
  else readiness = 'ready';
  return {
    id: cred.id, name: cred.name, rotationStep: cred.rotationStep || null, readiness,
    blockers: blockers.map((c) => ({ name: c.name, migration: c.migration, environment: c.environment })),
    unverifiedConsumers: unverified.map((c) => c.name),
    consumers,
    impactIfRevoked: cred.revocationImpact || (consumers.length ? consumers.map((c) => c.impact).filter(Boolean).join(' ') : ''),
    rollbackNotes: cred.rollbackNotes || '',
  };
}

// ── persistence ────────────────────────────────────────────────────────────────────────────────────────
const CRED_COLS = { name: 'name', provider: 'provider', environment: 'environment', applications: 'applications', envVarName: 'env_var_name', purpose: 'purpose', permissions: 'permissions', storageReference: 'storage_reference', status: 'status', lastVerifiedAt: 'last_verified_at', lastRotatedAt: 'last_rotated_at', nextReviewAt: 'next_review_at', verification: 'verification', evidence: 'evidence', consumers: 'consumers', migrationNotes: 'migration_notes', revocationImpact: 'revocation_impact', rotationStep: 'rotation_step', rollbackNotes: 'rollback_notes' };
const SUB_COLS = { provider: 'provider', service: 'service', applications: 'applications', plan: 'plan', price: 'price', currency: 'currency', priceBasis: 'price_basis', billingFrequency: 'billing_frequency', renewalDate: 'renewal_date', trialEndsAt: 'trial_ends_at', usageLimits: 'usage_limits', spendingCap: 'spending_cap', capStatus: 'cap_status', status: 'status', accountUrl: 'account_url', notes: 'notes', lastVerifiedAt: 'last_verified_at' };
const JSON_COLS = new Set(['applications', 'consumers']);
const d = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

const mapCredential = (r) => ({
  id: r.id, name: r.name, provider: r.provider, environment: r.environment, applications: r.applications || [], envVarName: r.env_var_name,
  purpose: r.purpose, permissions: r.permissions, storageReference: r.storage_reference, status: r.status,
  lastVerifiedAt: d(r.last_verified_at), lastRotatedAt: d(r.last_rotated_at), nextReviewAt: d(r.next_review_at),
  verification: r.verification, evidence: r.evidence, consumers: r.consumers || [], migrationNotes: r.migration_notes,
  revocationImpact: r.revocation_impact, rotationStep: r.rotation_step, rollbackNotes: r.rollback_notes, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});
const mapSubscription = (r) => ({
  id: r.id, provider: r.provider, service: r.service, applications: r.applications || [], plan: r.plan,
  price: r.price === null || r.price === undefined ? null : Number(r.price), currency: r.currency, priceBasis: r.price_basis,
  billingFrequency: r.billing_frequency, renewalDate: d(r.renewal_date), trialEndsAt: d(r.trial_ends_at), usageLimits: r.usage_limits,
  spendingCap: r.spending_cap, capStatus: r.cap_status, status: r.status, accountUrl: r.account_url, notes: r.notes,
  lastVerifiedAt: d(r.last_verified_at), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

const newId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const param = (col, v) => (JSON_COLS.has(col) ? JSON.stringify(v) : v);

async function listCredentials(pool) { return (await pool.query('SELECT * FROM ai_credentials ORDER BY lower(name), environment')).rows.map(mapCredential); }
async function getCredential(pool, id) { const { rows } = await pool.query('SELECT * FROM ai_credentials WHERE id = $1', [id]); return rows[0] ? mapCredential(rows[0]) : null; }
async function listSubscriptions(pool) { return (await pool.query('SELECT * FROM ai_subscriptions ORDER BY lower(provider), lower(service)')).rows.map(mapSubscription); }
async function getSubscription(pool, id) { const { rows } = await pool.query('SELECT * FROM ai_subscriptions WHERE id = $1', [id]); return rows[0] ? mapSubscription(rows[0]) : null; }

async function insert(pool, table, cols, prefix, v, map) {
  const keys = Object.keys(cols).filter((k) => v[k] !== undefined);
  const id = newId(prefix);
  const { rows } = await pool.query(
    `INSERT INTO ${table} (id, ${keys.map((k) => cols[k]).join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [id, ...keys.map((k) => param(cols[k], v[k]))]);
  return map(rows[0]);
}
async function update(pool, table, cols, id, v, map) {
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(cols)) if (v[k] !== undefined) { params.push(param(col, v[k])); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) return null;
  const { rows } = await pool.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  return rows[0] ? map(rows[0]) : null;
}

const createCredential = (pool, v) => insert(pool, 'ai_credentials', CRED_COLS, 'cred', v, mapCredential);
const updateCredential = (pool, id, v) => update(pool, 'ai_credentials', CRED_COLS, id, v, mapCredential);
const deleteCredential = async (pool, id) => (await pool.query('DELETE FROM ai_credentials WHERE id = $1', [id])).rowCount > 0;
const createSubscription = (pool, v) => insert(pool, 'ai_subscriptions', SUB_COLS, 'sub', v, mapSubscription);
const updateSubscription = (pool, id, v) => update(pool, 'ai_subscriptions', SUB_COLS, id, v, mapSubscription);
const deleteSubscription = async (pool, id) => (await pool.query('DELETE FROM ai_subscriptions WHERE id = $1', [id])).rowCount > 0;

module.exports = {
  SCHEMA, CREDENTIAL_STATUSES, VERIFICATION, CONSUMER_MIGRATION, SUBSCRIPTION_STATUSES, BILLING_FREQUENCIES, PRICE_BASIS, ENVIRONMENTS, MAX_ROWS,
  looksLikeSecret, findSecretFields, validateCredential, checkCredentialClaims, validateSubscription, checkSubscriptionClaims,
  summarizeCredentials, costSummary, upcomingDates, dependencyView,
  listCredentials, getCredential, createCredential, updateCredential, deleteCredential,
  listSubscriptions, getSubscription, createSubscription, updateSubscription, deleteSubscription,
};
