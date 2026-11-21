// server/services/appIntelligence/repos.cjs
//
// Command Center: one row per GitHub repository (current state only, no history snapshots).
//
//   * Three signals stay separate. Repository ACTIVITY comes from GitHub push dates. DEPLOYMENT comes from deploy
//     config files / GitHub Deployments. Application HEALTH is not stored here: it stays in the existing checker and is
//     reached through `app_id` (a repository only has health once the owner links it to a monitored application).
//   * Two kinds of column, never mixed:
//       SYNC columns  (github_id, full_name, pushed_at, suggested_kind, stack, deploy_*): written only by the sync.
//       OWNER columns (kind, purpose, live_url, priority, priority_note, app_id): written only by the owner.
//     A re-sync therefore can never overwrite a decision the owner made.
//   * Classification is a SUGGESTION with evidence. `kind` stays NULL until the owner confirms it.
//   * Metadata only. Anything read from GitHub that looks like a secret is dropped before it is stored.
'use strict';

const crypto = require('crypto');
const inventory = require('./inventory.cjs');

const KINDS = ['application', 'service', 'tool', 'content', 'archive'];
const PRIORITIES = ['invest', 'maintain', 'hold', 'retire'];
const DEPLOY_STATES = ['deployed', 'configured', 'failed', 'none', 'unknown'];
const MAX_REPOS = 200;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_repos (
    id                 TEXT PRIMARY KEY,
    github_id          BIGINT NOT NULL UNIQUE,
    full_name          TEXT NOT NULL,
    name               TEXT NOT NULL,
    html_url           TEXT NOT NULL DEFAULT '',
    visibility         TEXT NOT NULL DEFAULT 'private',
    archived           BOOLEAN NOT NULL DEFAULT false,
    default_branch     TEXT NOT NULL DEFAULT '',
    gh_description     TEXT NOT NULL DEFAULT '',
    language           TEXT NOT NULL DEFAULT '',
    pushed_at          TIMESTAMPTZ,
    open_prs           INTEGER,
    suggested_kind     TEXT,
    kind_evidence      TEXT NOT NULL DEFAULT '',
    suggested_purpose  TEXT NOT NULL DEFAULT '',
    stack              JSONB NOT NULL DEFAULT '[]',
    deploy_platform    TEXT NOT NULL DEFAULT '',
    deploy_state       TEXT NOT NULL DEFAULT 'unknown',
    deploy_evidence    TEXT NOT NULL DEFAULT '',
    deploy_checked_at  TIMESTAMPTZ,
    scan_pushed_at     TIMESTAMPTZ,
    scanned_at         TIMESTAMPTZ,
    last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    kind               TEXT,
    purpose            TEXT NOT NULL DEFAULT '',
    live_url           TEXT NOT NULL DEFAULT '',
    priority           TEXT,
    priority_note      TEXT NOT NULL DEFAULT '',
    app_id             TEXT REFERENCES ai_applications(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_ai_repos_pushed ON ai_repos(pushed_at DESC);
`;

const iso = (v) => (v ? new Date(v).toISOString() : null);

function mapRepo(r) {
  return {
    id: r.id, githubId: Number(r.github_id), fullName: r.full_name, name: r.name, htmlUrl: r.html_url,
    visibility: r.visibility, archived: r.archived, defaultBranch: r.default_branch, ghDescription: r.gh_description,
    language: r.language, pushedAt: iso(r.pushed_at), openPrs: r.open_prs,
    suggestedKind: r.suggested_kind, kindEvidence: r.kind_evidence, suggestedPurpose: r.suggested_purpose, stack: r.stack || [],
    deployPlatform: r.deploy_platform, deployState: r.deploy_state, deployEvidence: r.deploy_evidence, deployCheckedAt: iso(r.deploy_checked_at),
    scanPushedAt: iso(r.scan_pushed_at), scannedAt: iso(r.scanned_at), lastSeenAt: iso(r.last_seen_at),
    kind: r.kind, purpose: r.purpose, liveUrl: r.live_url, priority: r.priority, priorityNote: r.priority_note, appId: r.app_id,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}

// ── pure helpers (take `now` so they are testable) ───────────────────────────────────────────────────────
const DAY = 86400000;

/** Repository ACTIVITY only: says nothing about whether anything is deployed or working. */
function repoActivity(repo, now = Date.now()) {
  if (repo.archived) return { state: 'archived', days: null };
  if (!repo.pushedAt) return { state: 'unknown', days: null };
  const days = Math.max(0, Math.floor((now - Date.parse(repo.pushedAt)) / DAY));
  return { state: days <= 14 ? 'active' : days <= 60 ? 'recent' : 'dormant', days };
}

/** The type the owner confirmed, else the suggestion (flagged as unconfirmed), else nothing. */
function effectiveKind(repo) {
  if (repo.kind) return { kind: repo.kind, confirmed: true };
  if (repo.suggestedKind) return { kind: repo.suggestedKind, confirmed: false };
  return { kind: null, confirmed: false };
}

/** Only a confirmed application or service is health-checked; a suggestion never starts a check. */
const isHealthCheckable = (repo) => Boolean(repo.kind) && (repo.kind === 'application' || repo.kind === 'service');

// ── owner edits ──────────────────────────────────────────────────────────────────────────────────────────
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Validates an owner PATCH. Returns { errors, value }. Never throws. Sync columns cannot be set through this. */
function validateRepoPatch(body) {
  const errors = []; const out = {}; const has = (k) => body && body[k] !== undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Send a JSON object.'], value: {} };
  const leaks = inventory.findSecretFields(body);
  if (leaks.length) return { errors: [`The field "${leaks[0]}" looks like a secret value. Nothing here stores secrets: reword it.`], value: {} };
  if (has('kind')) {
    if (body.kind === null || body.kind === '') out.kind = null;
    else if (KINDS.includes(body.kind)) out.kind = body.kind;
    else errors.push(`Type must be one of: ${KINDS.join(', ')}.`);
  }
  if (has('priority')) {
    if (body.priority === null || body.priority === '') out.priority = null;
    else if (PRIORITIES.includes(body.priority)) out.priority = body.priority;
    else errors.push(`Priority must be one of: ${PRIORITIES.join(', ')}.`);
  }
  if (has('purpose')) out.purpose = str(body.purpose, 500);
  if (has('priorityNote')) out.priorityNote = str(body.priorityNote, 500);
  if (has('liveUrl')) {
    const u = str(body.liveUrl, 300);
    if (!u) out.liveUrl = '';
    else {
      let p; try { p = new URL(u); } catch { p = null; }
      if (!p || p.protocol !== 'https:') errors.push('The live URL must be a full https:// address.');
      else if (p.username || p.password || p.search || p.hash) errors.push('Remove credentials, query strings and fragments: use the plain page address.');
      else out.liveUrl = p.toString();
    }
  }
  if (has('appId')) {
    if (body.appId === null || body.appId === '') out.appId = null;
    else if (typeof body.appId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(body.appId)) out.appId = body.appId;
    else errors.push('appId must be the id of a monitored application, or null.');
  }
  if (!errors.length && !Object.keys(out).length) errors.push('Nothing to change: send one of kind, priority, purpose, priorityNote, liveUrl, appId.');
  return { errors, value: out };
}

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────────
const OWNER_COLS = { kind: 'kind', purpose: 'purpose', liveUrl: 'live_url', priority: 'priority', priorityNote: 'priority_note', appId: 'app_id' };
const newId = () => `repo-${crypto.randomUUID().slice(0, 8)}`;

/** Text read from GitHub is stored only if it does not look like a secret. */
const clean = (v, max) => { const s = str(v, max); return inventory.looksLikeSecret(s) ? '' : s; };

/**
 * Insert or refresh one repository from a sync. Matches on the GitHub numeric id, so a rename or transfer updates the
 * same row. Touches SYNC columns only. `scan` is optional and carries the content-scan results.
 */
async function upsertSynced(pool, gh, scan, now = new Date()) {
  const p = [
    newId(), gh.githubId, clean(gh.fullName, 200), clean(gh.name, 100), clean(gh.htmlUrl, 300), gh.visibility === 'public' ? 'public' : 'private',
    Boolean(gh.archived), clean(gh.defaultBranch, 100), clean(gh.description, 500), clean(gh.language, 60), gh.pushedAt || null,
    Number.isInteger(gh.openPrs) ? gh.openPrs : null, now.toISOString(),
  ];
  const { rows } = await pool.query(
    `INSERT INTO ai_repos (id, github_id, full_name, name, html_url, visibility, archived, default_branch, gh_description, language, pushed_at, open_prs, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (github_id) DO UPDATE SET full_name = EXCLUDED.full_name, name = EXCLUDED.name, html_url = EXCLUDED.html_url,
       visibility = EXCLUDED.visibility, archived = EXCLUDED.archived, default_branch = EXCLUDED.default_branch,
       gh_description = EXCLUDED.gh_description, language = EXCLUDED.language, pushed_at = EXCLUDED.pushed_at,
       open_prs = COALESCE(EXCLUDED.open_prs, ai_repos.open_prs), last_seen_at = EXCLUDED.last_seen_at, updated_at = NOW()
     RETURNING *`, p);
  let repo = mapRepo(rows[0]);
  if (scan) repo = await saveScan(pool, repo.id, scan, now);
  return repo;
}

/** Stores content-scan results (suggested type, purpose, stack, deployment) and remembers which push was scanned. */
async function saveScan(pool, id, scan, now = new Date()) {
  const kind = scan.suggestedKind === null || KINDS.includes(scan.suggestedKind) ? scan.suggestedKind : null;
  const state = DEPLOY_STATES.includes(scan.deployState) ? scan.deployState : 'unknown';
  const stack = (Array.isArray(scan.stack) ? scan.stack : []).map((s) => clean(s, 60)).filter(Boolean).slice(0, 20);
  const { rows } = await pool.query(
    `UPDATE ai_repos SET suggested_kind = $2, kind_evidence = $3, suggested_purpose = $4, stack = $5::jsonb,
       deploy_platform = $6, deploy_state = $7, deploy_evidence = $8, deploy_checked_at = $9,
       scan_pushed_at = pushed_at, scanned_at = $9, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id, kind, clean(scan.kindEvidence, 300), clean(scan.suggestedPurpose, 500), JSON.stringify(stack),
      clean(scan.deployPlatform, 60), state, clean(scan.deployEvidence, 300), now.toISOString()]);
  return rows[0] ? mapRepo(rows[0]) : null;
}

async function listRepos(pool) { return (await pool.query('SELECT * FROM ai_repos ORDER BY pushed_at DESC NULLS LAST, lower(name)')).rows.map(mapRepo); }
async function getRepo(pool, id) { const { rows } = await pool.query('SELECT * FROM ai_repos WHERE id = $1', [id]); return rows[0] ? mapRepo(rows[0]) : null; }

/** Applies a validated owner patch. Returns the updated repo or null if it does not exist. */
async function updateOwner(pool, id, v) {
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(OWNER_COLS)) if (v[k] !== undefined) { params.push(v[k]); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) return getRepo(pool, id);
  const { rows } = await pool.query(`UPDATE ai_repos SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  return rows[0] ? mapRepo(rows[0]) : null;
}

module.exports = {
  SCHEMA, KINDS, PRIORITIES, DEPLOY_STATES, MAX_REPOS,
  repoActivity, effectiveKind, isHealthCheckable, validateRepoPatch,
  upsertSynced, saveScan, listRepos, getRepo, updateOwner,
};
