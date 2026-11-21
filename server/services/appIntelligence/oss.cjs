// server/services/appIntelligence/oss.cjs
//
// Command Center: the Open-source Library. A short, owner-curated list of open-source projects that could fill a gap
// in one of the applications, with the facts needed to decide: licence, any commercial restriction, maintenance,
// last release, security note and integration effort.
//
//   * Nothing here is looked up automatically and no project is pre-loaded. Every fact starts as "not checked".
//   * Honesty rule: a project can only be marked "verified" with a source (a link or note saying where the facts came
//     from) AND the date they were checked. Otherwise it stays "to verify". Unknown stays unknown.
//   * Metadata only: every text field is screened and anything that looks like a secret is refused.
'use strict';

const crypto = require('crypto');
const inventory = require('./inventory.cjs');

const LICENSE_CLASSES = ['permissive', 'weak_copyleft', 'strong_copyleft', 'source_available', 'unknown'];
const MAINTENANCE = ['active', 'slow', 'stale', 'unknown'];
const EFFORT = ['low', 'medium', 'high', 'unknown'];
const DECISIONS = ['to_evaluate', 'adopt', 'watch', 'reject'];
const MAX_ROWS = 300;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_oss_projects (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    url               TEXT NOT NULL DEFAULT '',
    gap               TEXT NOT NULL DEFAULT '',
    repo_name         TEXT NOT NULL DEFAULT '',
    license           TEXT NOT NULL DEFAULT '',
    license_class     TEXT NOT NULL DEFAULT 'unknown',
    commercial_note   TEXT NOT NULL DEFAULT '',
    maintenance       TEXT NOT NULL DEFAULT 'unknown',
    last_release      DATE,
    security_note     TEXT NOT NULL DEFAULT '',
    effort            TEXT NOT NULL DEFAULT 'unknown',
    decision          TEXT NOT NULL DEFAULT 'to_evaluate',
    verified_source   TEXT NOT NULL DEFAULT '',
    verified_at       DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_oss_name ON ai_oss_projects (lower(name), lower(repo_name));
`;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const today = (now) => new Date(now).toISOString().slice(0, 10);
const d = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const COLS = { name: 'name', url: 'url', gap: 'gap', repoName: 'repo_name', license: 'license', licenseClass: 'license_class', commercialNote: 'commercial_note', maintenance: 'maintenance', lastRelease: 'last_release', securityNote: 'security_note', effort: 'effort', decision: 'decision', verifiedSource: 'verified_source', verifiedAt: 'verified_at' };

const mapRow = (r) => ({
  id: r.id, name: r.name, url: r.url, gap: r.gap, repoName: r.repo_name, license: r.license, licenseClass: r.license_class,
  commercialNote: r.commercial_note, maintenance: r.maintenance, lastRelease: d(r.last_release), securityNote: r.security_note,
  effort: r.effort, decision: r.decision, verifiedSource: r.verified_source, verifiedAt: d(r.verified_at),
  verified: Boolean(r.verified_source && r.verified_at),
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/** Only web links are accepted, so a stored link can never run code when clicked. */
const isWebUrl = (u) => { try { const p = new URL(u); return p.protocol === 'https:' || p.protocol === 'http:'; } catch { return false; } };

function validateProject(body, { partial = false, now = Date.now() } = {}) {
  const errors = []; const out = {}; const has = (k) => body && body[k] !== undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Send a JSON object.'], value: {} };
  const leaks = inventory.findSecretFields(body);
  if (leaks.length) return { errors: [`The field "${leaks[0]}" looks like a secret value. The library stores no secrets: reword it.`], value: {} };
  if (!partial || has('name')) { const n = str(body.name, 120); if (!n) errors.push('A name is required.'); else out.name = n; }
  if (has('url')) { const u = str(body.url, 300); if (u && !isWebUrl(u)) errors.push('The link must start with https:// or http://.'); else out.url = u; }
  for (const [k, max] of [['gap', 500], ['repoName', 100], ['license', 80], ['commercialNote', 500], ['securityNote', 500], ['verifiedSource', 300]]) if (has(k)) out[k] = str(body[k], max);
  const enums = [['licenseClass', LICENSE_CLASSES], ['maintenance', MAINTENANCE], ['effort', EFFORT], ['decision', DECISIONS]];
  for (const [k, list] of enums) if (has(k)) { if (!list.includes(body[k])) errors.push(`${k} must be one of: ${list.join(', ')}.`); else out[k] = body[k]; }
  for (const k of ['lastRelease', 'verifiedAt']) if (has(k)) {
    const v = body[k];
    if (v === null || v === '') out[k] = null;
    else if (!isDate(v)) errors.push(`${k === 'verifiedAt' ? 'The date checked' : 'The last release date'} must be a date (YYYY-MM-DD).`);
    else if (v > today(now)) errors.push('Dates cannot be in the future: they record something that already happened.');
    else out[k] = v;
  }
  return { errors, value: out };
}

/** Whole-record rules. The two verification fields travel together; a project cannot be adopted on unchecked facts. */
function checkClaims(rec) {
  const errors = []; const src = String(rec.verifiedSource || '').trim();
  if (Boolean(src) !== Boolean(rec.verifiedAt)) errors.push('To mark facts as checked, give both where you checked them (source) and the date. Otherwise leave both empty.');
  if (rec.decision === 'adopt' && !(src && rec.verifiedAt)) errors.push('A project cannot be marked "adopt" until its licence and maintenance are checked. Add the source and date first.');
  if (rec.decision === 'adopt' && (rec.licenseClass === 'unknown' || rec.licenseClass === 'strong_copyleft')) errors.push('Check the licence before adopting: it is unknown or strong copyleft, which may restrict commercial use.');
  return errors;
}

const newId = () => `oss-${crypto.randomUUID().slice(0, 8)}`;
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function listProjects(pool, { q, decision, repo } = {}) {
  const where = []; const params = [];
  if (decision) { params.push(decision); where.push(`decision = $${params.length}`); }
  if (repo) { params.push(repo.toLowerCase()); where.push(`lower(repo_name) = $${params.length}`); }
  const text = str(q, 120);
  if (text) { params.push(`%${likeEscape(text.toLowerCase())}%`); where.push(`(lower(name) LIKE $${params.length} OR lower(gap) LIKE $${params.length} OR lower(license) LIKE $${params.length} OR lower(repo_name) LIKE $${params.length})`); }
  const { rows } = await pool.query(`SELECT * FROM ai_oss_projects ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(name) LIMIT ${MAX_ROWS}`, params);
  return rows.map(mapRow);
}
async function getProject(pool, id) { const { rows } = await pool.query('SELECT * FROM ai_oss_projects WHERE id = $1', [id]); return rows[0] ? mapRow(rows[0]) : null; }
async function totalRows(pool) { return (await pool.query('SELECT count(*)::int AS n FROM ai_oss_projects')).rows[0].n; }

/** Returns the created project, or null when the same name+repository already exists. */
async function createProject(pool, v) {
  const keys = Object.keys(COLS).filter((k) => v[k] !== undefined);
  const params = [newId(), ...keys.map((k) => v[k])];
  const { rows } = await pool.query(`INSERT INTO ai_oss_projects (id, ${keys.map((k) => COLS[k]).join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT DO NOTHING RETURNING *`, params);
  return rows[0] ? mapRow(rows[0]) : null;
}
async function updateProject(pool, id, v) {
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(COLS)) if (v[k] !== undefined) { params.push(v[k]); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) return getProject(pool, id);
  try {
    const { rows } = await pool.query(`UPDATE ai_oss_projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
    return rows[0] ? mapRow(rows[0]) : null;
  } catch (err) { if (err && err.code === '23505') return 'duplicate'; throw err; }
}
const deleteProject = async (pool, id) => (await pool.query('DELETE FROM ai_oss_projects WHERE id = $1', [id])).rowCount > 0;

module.exports = { LICENSE_CLASSES, MAINTENANCE, EFFORT, DECISIONS, MAX_ROWS, SCHEMA, validateProject, checkClaims, listProjects, getProject, totalRows, createProject, updateProject, deleteProject };
