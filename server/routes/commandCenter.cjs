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
'use strict';

const express = require('express');
const store = require('../services/appIntelligence/store.cjs');
const repos = require('../services/appIntelligence/repos.cjs');
const repoSync = require('../services/appIntelligence/repoSync.cjs');
const github = require('../services/appIntelligence/github.cjs');
const { deriveStatus } = require('../services/appIntelligence/status.cjs');
const { log } = require('../services/appIntelligence/safe.cjs');

const DEFAULT_OWNER = 'strategichonesty-2026';

/** The three signals, side by side and never merged: activity (GitHub pushes), deployment (config / GitHub), health (checker). */
function presentRepo(repo, appsById, now = new Date()) {
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
  const appsById = async () => new Map((await store.listApplications(pool)).map((a) => [a.id, a]));

  router.get('/repos', wrap(async (_req, res) => {
    const now = new Date();
    const [list, apps, last] = await Promise.all([repos.listRepos(pool), appsById(), repoSync.lastSync(pool)]);
    const items = list.map((r) => presentRepo(r, apps, now));
    res.json({
      success: true, generatedAt: now.toISOString(), repositories: items,
      counts: { total: items.length, needType: items.filter((i) => !i.type.confirmed).length },
      sync: { configured: configured(), owner: owner(), last },
    });
  }));

  router.get('/repos/:id', wrap(async (req, res) => {
    const repo = await repos.getRepo(pool, req.params.id);
    if (!repo) return res.status(404).json({ success: false, error: 'Repository not found.' });
    res.json({ success: true, repository: presentRepo(repo, await appsById(), new Date()) });
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
    res.json({ success: true, repository: presentRepo(updated, await appsById(), new Date()) });
  }));

  router.post('/sync', wrap(async (_req, res) => {
    if (!configured()) return res.status(503).json({ success: false, code: 'github_not_configured', error: 'GitHub access is not set up. Add a read-only GITHUB_TOKEN on the server first.' });
    let c; try { c = client(); } catch { return res.status(503).json({ success: false, code: 'github_not_configured', error: 'GitHub access is not set up. Add a read-only GITHUB_TOKEN on the server first.' }); }
    const status = await repoSync.runSync(pool, { client: c, owner: owner() });
    if (status.code === 'already_running') return res.status(409).json({ success: false, code: status.code, error: status.error });
    return res.status(status.ok ? 200 : 502).json({ success: status.ok, sync: status });
  }));

  router.get('/sync/status', wrap(async (_req, res) => {
    res.json({ success: true, configured: configured(), owner: owner(), last: await repoSync.lastSync(pool) });
  }));

  return router;
}

module.exports = createRouter;
module.exports._test = { presentRepo };
