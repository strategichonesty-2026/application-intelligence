// server/routes/appIntelligence.cjs
//
// Application Intelligence API (Phase 1: registry, health checks, incidents).
// Mounted behind requireApiKey. Every figure returned is computed from stored
// check records; nothing is estimated or defaulted to look healthy.
'use strict';

const express = require('express');
const store = require('../services/appIntelligence/store.cjs');
const monitor = require('../services/appIntelligence/monitor.cjs');
const inventory = require('../services/appIntelligence/inventory.cjs');
const starter = require('../services/appIntelligence/starter.cjs');
const { deriveStatus, needsAttention, monitoringHealth, staleLimitSeconds, CHECK_TYPES, MODES, FAILURES_TO_OPEN_INCIDENT, SUCCESSES_TO_RESOLVE } = require('../services/appIntelligence/status.cjs');
const { validateApplicationInput, ENVIRONMENTS } = require('../services/appIntelligence/validation.cjs');
const alerts = require('../services/appIntelligence/alerts.cjs');
const uptime = require('../services/appIntelligence/uptime.cjs');
const briefing = require('../services/appIntelligence/briefing.cjs');
const ownerAuth = require('../services/appIntelligence/ownerAuth.cjs');
const { heartbeatConfig } = require('../services/appIntelligence/heartbeat.cjs');
const { log } = require('../services/appIntelligence/safe.cjs');

const MAX_APPLICATIONS = 100; // keeps one scheduler pass bounded

function environmentName() {
  return process.env.APP_INTELLIGENCE_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
}

function present(app, latestIncident, now = new Date()) {
  const d = deriveStatus(app, now);
  return {
    id: app.id, name: app.name, description: app.description, url: app.url, environment: app.environment,
    status: d.status, statusNote: d.note, monitoringFault: d.monitoringFault, suspect: Boolean(d.suspect),
    enabled: app.enabled, mode: app.mode,
    check: {
      type: app.checkType, typeLabel: CHECK_TYPES[app.checkType].label, limitation: CHECK_TYPES[app.checkType].limitation,
      path: app.checkPath || null, endpoint: app.checkType === 'health_endpoint' && app.checkPath ? new URL(app.checkPath, app.url).toString() : app.url,
      expectedStatus: app.expectedStatus, intervalSeconds: app.intervalSeconds, timeoutMs: app.timeoutMs,
      slowThresholdMs: app.slowThresholdMs, staleAfterSeconds: staleLimitSeconds(app),
    },
    lastCheckedAt: app.lastCheckedAt, lastSuccessAt: app.lastSuccessAt,
    lastOutcome: app.lastOutcome, lastReason: app.lastReason, lastSummary: app.lastSummary, lastHttpStatus: app.lastHttpStatus,
    responseMs: app.lastResponseMs, consecutiveFailures: app.failStreak,
    latestIncident: latestIncident || null,
    createdAt: app.createdAt,
  };
}

function createRouter(pool, { allowPrivate = process.env.APP_INTELLIGENCE_ALLOW_PRIVATE === 'true', check, env = process.env, provider = alerts.createNotifier({ env }), limiter = ownerAuth.createLoginLimiter(), failDelayMs = 250 } = {}) {
  const router = express.Router();
  // req.ip, never the raw X-Forwarded-For header: Express applies it only for the trusted proxy hops.
  const clientKey = (req) => String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');

  // ── Sign-in (the ONLY unauthenticated route). The shared x-api-key is deliberately not accepted here:
  //    it ships in the public front-end bundle, so it cannot protect anything that matters.
  router.post('/auth/login', async (req, res) => {
    try {
      if (!ownerAuth.getConfig(env).configured) {
        return res.status(503).json({ success: false, code: 'auth_not_configured', error: 'Sign-in is not configured on the server. The owner must set the sign-in variables.' });
      }
      const client = clientKey(req);
      const gate = limiter.check(client);
      if (!gate.allowed) {
        res.set('Retry-After', String(gate.retryAfterSeconds));
        return res.status(429).json({ success: false, code: 'too_many_attempts', error: 'Too many sign-in attempts. Wait and try again later.' });
      }
      if (gate.delayMs) await new Promise((r) => setTimeout(r, gate.delayMs)); // global brake: slower, never a lock-out
      const given = req.body && req.body.password;
      const ok = await ownerAuth.verifyPassword(given, env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH);
      // Optional view-only passphrase: same sign-in form, but the token it earns only opens /showcase.
      const viewerOk = !ok && env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH && await ownerAuth.verifyPassword(given, env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH);
      if (!ok && !viewerOk) {
        limiter.fail(client);
        await new Promise((r) => setTimeout(r, failDelayMs)); // blunts timing and rapid guessing
        return res.status(401).json({ success: false, code: 'bad_credentials', error: 'Incorrect password.' });
      }
      limiter.succeed(client);
      const role = ok ? 'owner' : 'viewer';
      const { token, expiresAt } = ownerAuth.issueToken(env, Date.now(), role);
      return res.json({ success: true, token, expiresAt, role });
    } catch (err) {
      log.error('sign-in', err);
      return res.status(500).json({ success: false, error: 'Sign-in could not be completed.' });
    }
  });

  // ── Sign-in help, public by necessity (shown before anyone has signed in). It carries no secret: the minimum length and an
  //    optional reminder the owner wrote (APP_INTELLIGENCE_PASSWORD_HINT). The hint is hidden if it contains the passphrase or
  //    anything shaped like a key or hash, so a careless hint cannot give the passphrase away. Anyone can read it.
  // Hints are chosen by the owner in Settings (stored in the database) or, as a fallback, by the *_PASSWORD_HINT variables.
  const HINT_MAX = 120;
  const hintUnsafe = (text, ...plains) => !text || inventory.looksLikeSecret(text) || /scrypt\$/i.test(text) || plains.some((p) => p && text.toLowerCase().includes(String(p).toLowerCase()));
  async function currentHints() {
    const read = async (key, envVar) => {
      let raw = '';
      try { const row = await store.getServiceState(pool, key); raw = row && row.value ? String(row.value) : ''; } catch { raw = ''; }
      return (raw || String(env[envVar] || '')).trim().slice(0, HINT_MAX);
    };
    return { owner: await read('hint_owner', 'APP_INTELLIGENCE_PASSWORD_HINT'), viewer: await read('hint_viewer', 'APP_INTELLIGENCE_VIEWER_PASSWORD_HINT') };
  }
  router.get('/auth/hint', async (_req, res) => {
    const h = await currentHints();
    const ownerPlain = env.APP_INTELLIGENCE_OWNER_PASSWORD; const viewerPlain = env.APP_INTELLIGENCE_VIEWER_PASSWORD;
    res.json({
      success: true, minLength: ownerAuth.MIN_PASSWORD_LENGTH,
      hint: hintUnsafe(h.owner, ownerPlain, viewerPlain) ? null : h.owner,
      viewerHint: env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH && !hintUnsafe(h.viewer, ownerPlain, viewerPlain) ? h.viewer : null,
    });
  });

  // ── Showcase: names and up/down only, for the view-only passphrase (an owner token works too). It never includes URLs,
  //    error text, incidents or anything from the credential register.
  router.get('/showcase', (req, res) => {
    if (!ownerAuth.getConfig(env).configured) return res.status(503).json({ success: false, code: 'auth_not_configured', error: 'Sign-in is not configured on the server.' });
    const m = /^Bearer ([A-Za-z0-9._-]{20,2000})$/.exec(String(req.headers.authorization || ''));
    const ok = m && (ownerAuth.verifyToken(m[1], env) || ownerAuth.verifyToken(m[1], env, Date.now(), 'viewer'));
    if (!ok) return res.status(401).json({ success: false, code: 'auth_required', error: 'Sign in to continue.' });
    const now = new Date();
    return store.listApplications(pool).then((apps) => res.json({
      success: true, generatedAt: now.toISOString(),
      applications: apps.map((a) => ({ name: a.name, status: deriveStatus(a, now).status, lastCheckedAt: a.lastCheckedAt })),
    })).catch((err) => { log.error('showcase', err); res.status(500).json({ success: false, error: 'The status could not be read.' }); });
  });

  // ── Everything below requires a valid owner token. Fail closed.
  router.use((req, res, next) => {
    if (!ownerAuth.getConfig(env).configured) {
      return res.status(503).json({ success: false, code: 'auth_not_configured', error: 'Sign-in is not configured on the server.' });
    }
    const m = /^Bearer ([A-Za-z0-9._-]{20,2000})$/.exec(String(req.headers.authorization || ''));
    const payload = m ? ownerAuth.verifyToken(m[1], env) : null;
    if (!payload) return res.status(401).json({ success: false, code: 'auth_required', error: 'Sign in to continue.' });
    req.owner = payload;
    return next();
  });

  router.get('/auth/session', (req, res) => res.json({ success: true, expiresAt: new Date(req.owner.exp * 1000).toISOString() }));

  // Owner-only: read and change the sign-in reminders. A reminder must never reveal a passphrase.
  router.get('/auth/hints', async (_req, res) => {
    const h = await currentHints();
    res.json({ success: true, owner: h.owner, viewer: h.viewer, viewerEnabled: Boolean(env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH), max: HINT_MAX });
  });
  router.put('/auth/hints', async (req, res) => {
    try {
      const body = req.body || {}; const out = {};
      for (const field of ['owner', 'viewer']) {
        if (body[field] === undefined) continue;
        const text = String(body[field]).trim();
        if (text.length > HINT_MAX) return res.status(400).json({ success: false, error: `A reminder can be at most ${HINT_MAX} characters.` });
        const bad = text && (hintUnsafe(text, env.APP_INTELLIGENCE_OWNER_PASSWORD, env.APP_INTELLIGENCE_VIEWER_PASSWORD)
          || await ownerAuth.verifyPassword(text, env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH)
          || (env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH && await ownerAuth.verifyPassword(text, env.APP_INTELLIGENCE_VIEWER_PASSWORD_HASH)));
        if (bad) return res.status(400).json({ success: false, error: 'That reminder looks like the passphrase or a key. Write something that only jogs your memory.' });
        out[field] = text;
      }
      // An empty value stores a blank, which hides the reminder. (The variable fallback is only used if nothing was ever saved.)
      if (out.owner !== undefined) await store.setServiceState(pool, 'hint_owner', out.owner || ' ');
      if (out.viewer !== undefined) await store.setServiceState(pool, 'hint_viewer', out.viewer || ' ');
      return res.json({ success: true });
    } catch (err) { log.error('hints', err); return res.status(500).json({ success: false, error: 'The reminder could not be saved.' }); }
  });

  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    log.error(`${req.method} ${req.path}`, err);
    res.status(500).json({ success: false, error: 'The monitoring data could not be read. Please try again shortly.' });
  });

  router.get('/summary', wrap(async (_req, res) => {
    const now = new Date();
    const [apps, incidents, activeIncidents, lastRecorded, cycle] = await Promise.all([
      store.listApplications(pool), store.latestIncidentByApp(pool), store.countOpenIncidents(pool), store.lastCheckRecordedAt(pool),
      store.getServiceState(pool, 'last_cycle_completed_at')]);
    const counts = { total: apps.length, healthy: 0, reachableOnly: 0, attention: 0, unknown: 0, paused: 0, activeIncidents };
    apps.forEach((a) => {
      const d = deriveStatus(a, now);
      if (d.status === 'healthy') counts.healthy += 1;
      else if (d.status === 'reachable') counts.reachableOnly += 1;
      else if (d.status === 'paused') counts.paused += 1;
      else if (d.status === 'unknown' || d.status === 'pending') counts.unknown += 1;
      if (needsAttention(d.status, d.monitoringFault, d.suspect)) counts.attention += 1;
    });
    res.json({
      success: true, generatedAt: now.toISOString(), environment: environmentName(), counts,
      monitoring: {
        ...monitor.status(env),
        // Shared across instances (stored in the database), unlike the in-memory fields above.
        lastCycleCompletedAt: cycle ? cycle.value : null,
        health: monitoringHealth(cycle ? cycle.value : null, apps, now, { schedule: monitor.scheduleConfig(env).mode }),
        lastCheckRecordedAt: lastRecorded, hasIncidentHistory: Object.keys(incidents).length > 0,
        alerting: { configured: alerts.anyChannelConfigured(env) },
      },
    });
  }));

  router.get('/config', wrap(async (_req, res) => {
    res.json({
      success: true, environment: environmentName(), environments: ENVIRONMENTS,
      checkTypes: Object.entries(CHECK_TYPES).map(([id, v]) => ({ id, ...v })),
      rules: { checkModes: MODES, failuresToOpenIncident: FAILURES_TO_OPEN_INCIDENT, successesToResolve: SUCCESSES_TO_RESOLVE, retentionDays: 30 },
      monitoring: monitor.status(env), privateTargetsAllowed: allowPrivate,
      alerting: alerts.getAlertConfig(env),
      heartbeat: (() => { const h = heartbeatConfig(); return { configured: h.configured, valid: h.valid, error: h.valid ? null : h.error }; })(),
    });
  }));

  router.get('/applications', wrap(async (_req, res) => {
    const now = new Date();
    const [apps, incidents] = await Promise.all([store.listApplications(pool), store.latestIncidentByApp(pool)]);
    res.json({ success: true, generatedAt: now.toISOString(), applications: apps.map((a) => present(a, incidents[a.id], now)) });
  }));

  router.post('/applications', wrap(async (req, res) => {
    const { errors, value } = validateApplicationInput(req.body || {});
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' '), errors });
    if ((await store.listApplications(pool)).length >= MAX_APPLICATIONS) {
      return res.status(400).json({ success: false, error: `At most ${MAX_APPLICATIONS} applications can be registered in Phase 1.` });
    }
    const app = await store.createApplication(pool, value);
    // First check straight away so the new row is never an unexplained blank.
    // Manual-only applications are never probed unless the owner clicks Check now on them.
    if (app.mode !== 'manual_only') {
      try { await monitor.checkApplication(pool, app, { trigger: 'registration', allowPrivate, check }); } catch (e) { console.error(`[app-intelligence] first check not recorded: ${e.message}`); }
    }
    res.status(201).json({ success: true, application: present(await store.getApplication(pool, app.id), null) });
  }));

  router.get('/applications/:id', wrap(async (req, res) => {
    const app = await store.getApplication(pool, req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'This application is not registered.' });
    const [incidents, recent] = await Promise.all([store.latestIncidentByApp(pool), store.recentChecks(pool, { applicationId: app.id, limit: 10 })]);
    const timeline = await store.listTimeline(pool, { application: app.id, pageSize: 10 });
    res.json({ success: true, application: present(app, incidents[app.id]), incidents: timeline.items, recentChecks: recent });
  }));

  router.get('/uptime', wrap(async (req, res) => {
    const days = req.query.days === '7' ? 7 : 30;
    const [apps, rows] = await Promise.all([store.listApplications(pool), store.uptimeDaily(pool, days)]);
    res.json({ success: true, ...uptime.buildUptime({ apps, rows, days, now: new Date() }) });
  }));

  router.get('/applications/:id/history', wrap(async (req, res) => {
    const range = store.RANGES[req.query.range] ? req.query.range : '24h';
    const app = await store.getApplication(pool, req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'This application is not registered.' });
    res.json({ success: true, range, points: await store.checkHistory(pool, app.id, range) });
  }));

  router.patch('/applications/:id', wrap(async (req, res) => {
    const { errors, value } = validateApplicationInput(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' '), errors });
    const existing = await store.getApplication(pool, req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'This application is not registered.' });
    const merged = { ...existing, ...value };
    if (merged.checkType === 'health_endpoint' && !merged.checkPath) {
      return res.status(400).json({ success: false, error: 'A health endpoint path (for example /health) is required for this check type.' });
    }
    if (merged.mode === 'manual_only' && merged.checkType !== 'health_endpoint') {
      return res.status(400).json({ success: false, error: 'A manual-only application must use a health endpoint check, not a homepage check.' });
    }
    const updated = await store.updateApplication(pool, req.params.id, value);
    res.json({ success: true, application: present(updated, null) });
  }));

  router.delete('/applications/:id', wrap(async (req, res) => {
    const ok = await store.deleteApplication(pool, req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: 'This application is not registered.' });
    res.json({ success: true });
  }));

  router.post('/applications/:id/check', wrap(async (req, res) => {
    const app = await store.getApplication(pool, req.params.id);
    if (!app) return res.status(404).json({ success: false, error: 'This application is not registered.' });
    if (app.lastCheckedAt && Date.now() - new Date(app.lastCheckedAt).getTime() < monitor.MANUAL_COOLDOWN_MS) {
      return res.status(429).json({ success: false, error: 'This application was checked a few seconds ago. Wait a moment before checking again.' });
    }
    const result = await monitor.checkApplication(pool, app, { trigger: 'manual', allowPrivate, check });
    const fresh = await store.getApplication(pool, app.id);
    res.json({
      success: true,
      result: { outcome: result.outcome, summary: result.summary, httpStatus: result.httpStatus, responseMs: result.responseMs },
      application: present(fresh, null),
    });
  }));

  // "Check all": owner-triggered, one request per eligible application. Never includes manual-only applications.
  router.post('/check-all', wrap(async (_req, res) => {
    const out = await monitor.checkAll(pool, { allowPrivate, check, provider, env });
    if (out.cooldownSeconds) {
      res.set('Retry-After', String(out.cooldownSeconds));
      return res.status(429).json({ success: false, error: `Everything was checked a moment ago. Try again in ${out.cooldownSeconds} seconds.` });
    }
    const now = new Date();
    const [apps, incidents] = await Promise.all([store.listApplications(pool), store.latestIncidentByApp(pool)]);
    res.json({ success: true, results: out.results, applications: apps.map((a) => present(a, incidents[a.id], now)) });
  }));

  router.get('/incidents', wrap(async (req, res) => {
    const q = req.query;
    const status = ['open', 'resolved'].includes(q.status) ? q.status : undefined;
    const severity = ['critical', 'warning'].includes(q.severity) ? q.severity : undefined;
    const kind = ['application', 'monitoring'].includes(q.kind) ? q.kind : undefined;
    const range = store.RANGES[q.range] ? q.range : undefined;
    const result = await store.listTimeline(pool, { application: q.application || undefined, status, severity, kind, range, page: q.page, pageSize: q.pageSize });
    res.json({ success: true, generatedAt: new Date().toISOString(), ...result });
  }));

  router.get('/alerts/config', wrap(async (_req, res) => {
    res.json({ success: true, ...alerts.getAlertConfig(env), telegram: alerts.getTelegramConfig(env), maxAttempts: alerts.MAX_ATTEMPTS, retryBackoffMinutes: alerts.BACKOFF_MINUTES });
  }));

  router.get('/alerts', wrap(async (_req, res) => {
    res.json({ success: true, alerts: await alerts.recentAlerts(pool, 20) });
  }));

  router.post('/alerts/test', wrap(async (_req, res) => {
    const out = await alerts.sendTest(pool, provider);
    res.status(out.ok ? 200 : out.tooSoon ? 429 : out.configured ? 502 : 400).json({ success: out.ok, ...out });
  }));

  // ── "What's wrong?": a rule-based briefing from the owner's own records. No AI, no outside call, no cost.
  router.post('/ask', wrap(async (req, res) => {
    const question = String((req.body && req.body.question) || '').slice(0, 300);
    const [apps, credentials, subscriptions] = await Promise.all([store.listApplications(pool), inventory.listCredentials(pool), inventory.listSubscriptions(pool)]);
    const full = briefing.buildBriefing({ apps, credentials, subscriptions, now: new Date() });
    res.json({ success: true, ...briefing.answer(question, full) });
  }));

  // ── Secrets & Subscriptions: a hand-maintained inventory of METADATA ONLY (no secret value is ever accepted,
  //    stored, returned or logged; see services/appIntelligence/inventory.cjs). Owner sign-in is required.
  const badRequest = (res, errors) => res.status(400).json({ success: false, error: errors.join(' '), errors });
  const notFound = (res) => res.status(404).json({ success: false, error: 'That record does not exist.' });

  router.get('/inventory', wrap(async (_req, res) => {
    const now = Date.now();
    const [credentials, subscriptions] = await Promise.all([inventory.listCredentials(pool), inventory.listSubscriptions(pool)]);
    res.json({
      success: true, generatedAt: new Date(now).toISOString(),
      notice: 'Maintained by hand. Nothing here is checked against a provider, and no secret value is stored. Statuses, prices and dates are what you recorded.',
      credentials, subscriptions,
      summary: { credentials: inventory.summarizeCredentials(credentials, now), costs: inventory.costSummary(subscriptions), upcoming: inventory.upcomingDates(subscriptions, now) },
      dependencies: credentials.map(inventory.dependencyView),
      options: { credentialStatuses: inventory.CREDENTIAL_STATUSES, verification: inventory.VERIFICATION, consumerMigration: inventory.CONSUMER_MIGRATION, subscriptionStatuses: inventory.SUBSCRIPTION_STATUSES, billingFrequencies: inventory.BILLING_FREQUENCIES, priceBasis: inventory.PRICE_BASIS, environments: inventory.ENVIRONMENTS },
    });
  }));

  router.post('/credentials', wrap(async (req, res) => {
    const { errors, value } = inventory.validateCredential(req.body || {});
    errors.push(...(errors.length ? [] : inventory.checkCredentialClaims({ verification: 'unknown', status: 'unknown', ...value })));
    if (errors.length) return badRequest(res, errors);
    if ((await inventory.listCredentials(pool)).length >= inventory.MAX_ROWS) return badRequest(res, [`At most ${inventory.MAX_ROWS} credential records.`]);
    res.status(201).json({ success: true, credential: await inventory.createCredential(pool, value) });
  }));
  router.patch('/credentials/:id', wrap(async (req, res) => {
    const existing = await inventory.getCredential(pool, req.params.id); if (!existing) return notFound(res);
    const { errors, value } = inventory.validateCredential(req.body || {}, { partial: true });
    if (!errors.length) errors.push(...inventory.checkCredentialClaims({ ...existing, ...value }));
    if (errors.length) return badRequest(res, errors);
    res.json({ success: true, credential: (await inventory.updateCredential(pool, req.params.id, value)) || existing });
  }));
  router.delete('/credentials/:id', wrap(async (req, res) => { if (!(await inventory.deleteCredential(pool, req.params.id))) return notFound(res); res.json({ success: true }); }));

  router.post('/subscriptions', wrap(async (req, res) => {
    const { errors, value } = inventory.validateSubscription(req.body || {});
    if (!errors.length) errors.push(...inventory.checkSubscriptionClaims({ priceBasis: 'unknown', ...value }));
    if (errors.length) return badRequest(res, errors);
    if ((await inventory.listSubscriptions(pool)).length >= inventory.MAX_ROWS) return badRequest(res, [`At most ${inventory.MAX_ROWS} subscription records.`]);
    res.status(201).json({ success: true, subscription: await inventory.createSubscription(pool, value) });
  }));
  router.patch('/subscriptions/:id', wrap(async (req, res) => {
    const existing = await inventory.getSubscription(pool, req.params.id); if (!existing) return notFound(res);
    const { errors, value } = inventory.validateSubscription(req.body || {}, { partial: true });
    if (!errors.length) errors.push(...inventory.checkSubscriptionClaims({ ...existing, ...value }));
    if (errors.length) return badRequest(res, errors);
    res.json({ success: true, subscription: (await inventory.updateSubscription(pool, req.params.id, value)) || existing });
  }));
  router.delete('/subscriptions/:id', wrap(async (req, res) => { if (!(await inventory.deleteSubscription(pool, req.params.id))) return notFound(res); res.json({ success: true }); }));

  // ── Starting records: preview, then add only what is missing (see services/appIntelligence/starter.cjs).
  router.get('/starter/preview', wrap(async (_req, res) => { res.json({ success: true, plan: await starter.plan(pool) }); }));
  router.post('/starter/load', wrap(async (req, res) => {
    const b = req.body || {};
    const sel = { applications: b.applications === true, credentials: b.credentials === true, subscriptions: b.subscriptions === true };
    if (!sel.applications && !sel.credentials && !sel.subscriptions) return res.status(400).json({ success: false, error: 'Choose at least one kind of record to load.' });
    const added = await starter.load(pool, sel);
    res.json({ success: true, added, plan: await starter.plan(pool) });
  }));

  router.get('/activity', wrap(async (req, res) => {
    const checks = await store.recentChecks(pool, { applicationId: req.query.application || undefined, limit: Math.min(Number(req.query.limit) || 15, 50) });
    res.json({ success: true, generatedAt: new Date().toISOString(), checks });
  }));

  return router;
}

module.exports = createRouter;
module.exports._test = { present, environmentName };
