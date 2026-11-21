// server/routes/commandCenter.cjs
//
// Command Center API (repositories). Mounted INSIDE the owner-only router, so every route here already requires the
// owner's sign-in. Read-only toward GitHub and toward every monitored application; the only things written are this
// console's own records. The GitHub token is read from the server environment and never appears in any response.
//
//   GET   /repos            every repository with its three signals kept apart
//   GET   /repos/:id        one repository
//   PATCH /repos/:id        owner decisions: type, priority, purpose, live URL, link to a monitored application
//   POST  /sync             pull from GitHub now (manual sync)
//   GET   /sync/status      when the last sync ran and what happened; whether a token is configured
//   GET   /portfolio        search the Master Portfolio (?q=&type=&status=&repo=); POST/PATCH/DELETE manage items; POST /portfolio/import
//   GET   /oss              the Open-source Library (?q=&decision=&repo=); POST/PATCH/DELETE manage entries
//   GET   /attention        what needs the owner's attention, each item with its evidence and when it was read
'use strict';

const express = require('express');
const store = require('../services/appIntelligence/store.cjs');
const repos = require('../services/appIntelligence/repos.cjs');
const repoSync = require('../services/appIntelligence/repoSync.cjs');
const github = require('../services/appIntelligence/github.cjs');
const inventory = require('../services/appIntelligence/inventory.cjs');
const portfolio = require('../services/appIntelligence/portfolio.cjs');
const oss = require('../services/appIntelligence/oss.cjs');
const { buildAttention } = require('../services/appIntelligence/attention.cjs');
const { deriveStatus } = require('../services/appIntelligence/status.cjs');
const { log } = require('../services/appIntelligence/safe.cjs');

const DEFAULT_OWNER = 'strategichonesty-2026';

/** The three signals, side by side and never merged: activity (GitHub pushes), deployment (config / GitHub), health (checker). */
function presentRepo(repo, appsById, now = new Date(), lastOkSyncStartedAt = null) {
  const eff = repos.effectiveKind(repo);
  const app = repo.appId ? appsById.get(repo.appId) : null;
  let health;
  if (app) { const d = deriveStatus(app, now); health = { state: d.status, note: d.note || '', lastCheckedAt: app.lastCheckedAt, source: 'Health checker' }; }
  else if (repos.isHealthCheckable(repo)) health = { state: 'not_checked', note: 'Not linked to a monitored application yet.', lastCheckedAt: null, source: 'Health checker' };
  else if (repo.kind) health = { state: 'not_applicable', note: 'Tools, content and archives are not health-checked.', lastCheckedAt: null, source: 'Health checker' };
  else health = { state: 'not_checked', note: 'Confirm the type first: only applications and services are health-checked.', lastCheckedAt: null, source: 'Health checker' };
  return {
    id: repo.id, name: repo.name, fullName: repo.fullName, htmlUrl: repo.htmlUrl, visibility: repo.visibility,
    type: { value: eff.kind, confirmed: eff.confirmed, evidence: repo.kindEvidence, suggested: repo.suggestedKind },
    purpose: { value: repo.purpose || repo.suggestedPurpose || '', owner: Boolean(repo.purpose) },
    stack: repo.stack, language: repo.language, liveUrl: repo.liveUrl,
    priority: repo.priority, priorityNote: repo.priorityNote,
    activity: { ...repos.repoActivity(repo, now.getTime()), pushedAt: repo.pushedAt, openPrs: repo.openPrs, defaultBranch: repo.defaultBranch, source: 'GitHub', readAt: repo.lastSeenAt },
    deployment: { state: repo.deployState, platform: repo.deployPlatform, evidence: repo.deployEvidence, checkedAt: repo.deployCheckedAt, source: 'GitHub deployments and config files' },
    health,
    // Present only if the last complete sync did not see it: it was deleted, renamed away from this owner, or access was removed.
    missing: Boolean(lastOkSyncStartedAt && repo.lastSeenAt && new Date(repo.lastSeenAt).getTime() < new Date(lastOkSyncStartedAt).getTime()),
    appId: repo.appId, scannedAt: repo.scannedAt, updatedAt: repo.updatedAt,
  };
}

function createRouter(pool, { env = process.env, makeClient } = {}) {
  const router = express.Router();
  const owner = () => String(env.GITHUB_OWNER || DEFAULT_OWNER);
  const client = makeClient || (() => github.createClient({ token: env.GITHUB_TOKEN }));
  const configured = () => Boolean(env.GITHUB_TOKEN);
  const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    log.error(`${req.method} ${req.path}`, err);
    res.status(500).json({ success: false, error: 'The repository data could not be read. Please try again shortly.' });
  });
  const lastOk = (last) => (last && last.ok && last.complete ? last.startedAt : null);
  const appsById = async () => new Map((await store.listApplications(pool)).map((a) => [a.id, a]));

  router.get('/repos', wrap(async (_req, res) => {
    const now = new Date();
    const [list, apps, last] = await Promise.all([repos.listRepos(pool), appsById(), repoSync.lastSync(pool)]);
    const items = list.map((r) => presentRepo(r, apps, now, lastOk(last)));
    res.json({
      success: true, generatedAt: now.toISOString(), repositories: items,
      counts: { total: items.length, needType: items.filter((i) => !i.type.confirmed).length },
      sync: { configured: configured(), owner: owner(), last },
    });
  }));

  router.get('/repos/:id', wrap(async (req, res) => {
    const repo = await repos.getRepo(pool, req.params.id);
    if (!repo) return res.status(404).json({ success: false, error: 'Repository not found.' });
    res.json({ success: true, repository: presentRepo(repo, await appsById(), new Date(), lastOk(await repoSync.lastSync(pool))) });
  }));

  router.patch('/repos/:id', wrap(async (req, res) => {
    const { errors, value } = repos.validateRepoPatch(req.body || {});
    if (errors.length) return res.status(400).json({ success: false, error: errors.join(' '), errors });
    if (value.appId) {
      const app = await store.getApplication(pool, value.appId);
      if (!app) return res.status(400).json({ success: false, error: 'That monitored application does not exist.' });
    }
    const updated = await repos.updateOwner(pool, req.params.id, value);
    if (!updated) return res.status(404).json({ success: false, error: 'Repository not found.' });
    res.json({ success: true, repository: presentRepo(updated, await appsById(), new Date(), lastOk(await repoSync.lastSync(pool))) });
  }));

  router.post('/sync', wrap(async (_req, res) => {
    if (!configured()) return res.status(503).json({ success: false, code: 'github_not_configured', error: 'GitHub access is not set up. Add a read-only GITHUB_TOKEN on the server first.' });
    let c; try { c = client(); } catch { return res.status(503).json({ success: false, code: 'github_not_configured', error: 'GitHub access is not set up. Add a read-only GITHUB_TOKEN on the server first.' }); }
    const status = await repoSync.runSync(pool, { client: c, owner: owner() });
    if (status.code === 'already_running') return res.status(409).json({ success: false, code: status.code, error: status.error });
    if (status.ok) return res.json({ success: true, sync: status });
    const why = (status.errors.find((e) => e.message) || {}).message || 'The sync could not be completed.';
    return res.status(502).json({ success: false, code: status.code, error: why, sync: status });
  }));

  router.get('/attention', wrap(async (_req, res) => {
    const now = new Date();
    const [list, apps, creds, subs, last] = await Promise.all([repos.listRepos(pool), store.listApplications(pool), inventory.listCredentials(pool), inventory.listSubscriptions(pool), repoSync.lastSync(pool)]);
    const byId = new Map(apps.map((a) => [a.id, a]));
    const result = buildAttention({
      apps: apps.map((a) => { const d = deriveStatus(a, now); return { id: a.id, name: a.name, status: d.status, monitoringFault: d.monitoringFault, suspect: Boolean(d.suspect), lastSummary: a.lastSummary, lastCheckedAt: a.lastCheckedAt }; }),
      credentials: creds, credentialReview: inventory.summarizeCredentials(creds, now.getTime()).needsReview,
      renewals: inventory.upcomingDates(subs, now.getTime(), 14), repos: list.map((r) => presentRepo(r, byId, now, lastOk(last))),
      sync: { configured: configured(), last },
    }, now.getTime());
    res.json({ success: true, generatedAt: now.toISOString(), ...result });
  }));

  // ── Master Portfolio ──
  const notFound = (res) => res.status(404).json({ success: false, error: 'Portfolio item not found.' });
  const bad = (res, errors) => res.status(400).json({ success: false, error: errors.join(' '), errors });
  router.get('/portfolio', wrap(async (req, res) => {
    const types = String(req.query.type || '').split(',').filter((t) => portfolio.TYPES.includes(t));
    const status = portfolio.STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const [items, counts] = await Promise.all([portfolio.listItems(pool, { types, status, repo: req.query.repo ? String(req.query.repo).slice(0, 100) : undefined, q: req.query.q ? String(req.query.q) : undefined }), portfolio.countByType(pool)]);
    res.json({ success: true, generatedAt: new Date().toISOString(), items, counts, types: portfolio.TYPES, statuses: portfolio.STATUSES });
  }));
  router.post('/portfolio', wrap(async (req, res) => {
    const { errors, value } = portfolio.validateItem(req.body || {});
    const claim = errors.length ? [] : portfolio.checkClaims({ evidenceLevel: 'unverified', ...value });
    if (errors.length || claim.length) return bad(res, [...errors, ...claim]);
    if ((await portfolio.totalRows(pool)) >= portfolio.MAX_ROWS) return bad(res, [`The portfolio is full (${portfolio.MAX_ROWS} records).`]);
    res.status(201).json({ success: true, item: await portfolio.createItem(pool, value) });
  }));
  router.patch('/portfolio/:id', wrap(async (req, res) => {
    const current = await portfolio.getItem(pool, req.params.id);
    if (!current) return notFound(res);
    const { errors, value } = portfolio.validateItem(req.body || {}, { partial: true });
    const claim = errors.length ? [] : portfolio.checkClaims({ ...current, ...value });
    if (errors.length || claim.length) return bad(res, [...errors, ...claim]);
    res.json({ success: true, item: await portfolio.updateItem(pool, req.params.id, value) });
  }));
  router.delete('/portfolio/:id', wrap(async (req, res) => { if (!(await portfolio.deleteItem(pool, req.params.id))) return notFound(res); res.json({ success: true }); }));
  router.post('/portfolio/import', wrap(async (req, res) => {
    const out = await portfolio.importItems(pool, req.body && req.body.items, { dryRun: req.body && req.body.dryRun !== false });
    if (out.error) return bad(res, [out.error]);
    res.json({ success: true, dryRun: !(req.body && req.body.dryRun === false), ...out });
  }));

  // ── Open-source Library ──
  const ossMissing = (res) => res.status(404).json({ success: false, error: 'Library entry not found.' });
  router.get('/oss', wrap(async (req, res) => {
    const decision = oss.DECISIONS.includes(req.query.decision) ? req.query.decision : undefined;
    const projects = await oss.listProjects(pool, { q: req.query.q ? String(req.query.q) : undefined, decision, repo: req.query.repo ? String(req.query.repo).slice(0, 100) : undefined });
    res.json({ success: true, generatedAt: new Date().toISOString(), projects, options: { licenseClasses: oss.LICENSE_CLASSES, maintenance: oss.MAINTENANCE, effort: oss.EFFORT, decisions: oss.DECISIONS } });
  }));
  router.post('/oss', wrap(async (req, res) => {
    const { errors, value } = oss.validateProject(req.body || {});
    const claim = errors.length ? [] : oss.checkClaims(value);
    if (errors.length || claim.length) return bad(res, [...errors, ...claim]);
    if ((await oss.totalRows(pool)) >= oss.MAX_ROWS) return bad(res, [`The library is full (${oss.MAX_ROWS} entries).`]);
    const created = await oss.createProject(pool, value);
    if (!created) return res.status(409).json({ success: false, error: 'That project is already in the library for this repository.' });
    res.status(201).json({ success: true, project: created });
  }));
  router.patch('/oss/:id', wrap(async (req, res) => {
    const current = await oss.getProject(pool, req.params.id);
    if (!current) return ossMissing(res);
    const { errors, value } = oss.validateProject(req.body || {}, { partial: true });
    const claim = errors.length ? [] : oss.checkClaims({ ...current, ...value });
    if (errors.length || claim.length) return bad(res, [...errors, ...claim]);
    const updated = await oss.updateProject(pool, req.params.id, value);
    if (updated === 'duplicate') return res.status(409).json({ success: false, error: 'That project is already in the library for this repository.' });
    res.json({ success: true, project: updated });
  }));
  router.delete('/oss/:id', wrap(async (req, res) => { if (!(await oss.deleteProject(pool, req.params.id))) return ossMissing(res); res.json({ success: true }); }));

  router.get('/sync/status', wrap(async (_req, res) => {
    res.json({ success: true, configured: configured(), owner: owner(), last: await repoSync.lastSync(pool) });
  }));

  return router;
}

module.exports = createRouter;
module.exports._test = { presentRepo };
