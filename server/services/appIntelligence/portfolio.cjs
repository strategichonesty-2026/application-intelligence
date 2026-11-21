// server/services/appIntelligence/portfolio.cjs
//
// Command Center: the Master Portfolio. One searchable list of decisions, risks, opportunities, ideas, requirements and
// issues, each tied (by name) to a repository and carrying its evidence and the date that evidence was checked.
//
//   * The records live ONLY in this console's database. Nothing is committed to the repository (it is public), so there is
//     no built-in "starter" list: records come from the owner, either one at a time or through the validated Import.
//   * Honesty rule (same as the credential register): an item can only be "verified" with evidence text AND a check date.
//   * Metadata only: every text field is screened, and anything that looks like a secret value is refused.
//   * Search uses PostgreSQL full-text search (a generated column plus one index): no new service or package.
'use strict';

const crypto = require('crypto');
const inventory = require('./inventory.cjs');

const TYPES = ['decision', 'risk', 'opportunity', 'idea', 'requirement', 'issue'];
const STATUSES = ['open', 'decided', 'done', 'dropped'];
const LEVELS = ['high', 'medium', 'low'];
const EVIDENCE = ['verified', 'inferred', 'unverified'];
const MAX_ROWS = 500;
const MAX_IMPORT = 100;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ai_portfolio_items (
    id                  TEXT PRIMARY KEY,
    type                TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT NOT NULL DEFAULT '',
    repo_name           TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'open',
    level               TEXT,
    evidence            TEXT NOT NULL DEFAULT '',
    evidence_level      TEXT NOT NULL DEFAULT 'unverified',
    evidence_checked_at DATE,
    source              TEXT NOT NULL DEFAULT 'owner',
    dedupe_key          TEXT UNIQUE,
    search              tsvector GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || coalesce(repo_name, '') || ' ' || coalesce(evidence, ''))
    ) STORED,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_ai_portfolio_search ON ai_portfolio_items USING GIN (search);
  CREATE INDEX IF NOT EXISTS idx_ai_portfolio_type ON ai_portfolio_items(type, status);
`;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const today = (now) => new Date(now).toISOString().slice(0, 10);
const d = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);

const COLS = { type: 'type', title: 'title', body: 'body', repoName: 'repo_name', status: 'status', level: 'level', evidence: 'evidence', evidenceLevel: 'evidence_level', evidenceCheckedAt: 'evidence_checked_at', source: 'source' };

const mapItem = (r) => ({
  id: r.id, type: r.type, title: r.title, body: r.body, repoName: r.repo_name, status: r.status, level: r.level,
  evidence: r.evidence, evidenceLevel: r.evidence_level, evidenceCheckedAt: d(r.evidence_checked_at), source: r.source,
  createdAt: r.created_at ? new Date(r.created_at).toISOString() : null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

/** Returns { errors, value }. `partial` = PATCH. Never throws. */
function validateItem(body, { partial = false, now = Date.now() } = {}) {
  const errors = []; const out = {}; const has = (k) => body && body[k] !== undefined;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: ['Send a JSON object.'], value: {} };
  const leaks = inventory.findSecretFields(body);
  if (leaks.length) return { errors: [`The field "${leaks[0]}" looks like a secret value. The portfolio stores no secrets: reword it.`], value: {} };
  if (!partial || has('type')) { if (!TYPES.includes(body.type)) errors.push(`Type must be one of: ${TYPES.join(', ')}.`); else out.type = body.type; }
  if (!partial || has('title')) { const t = str(body.title, 200); if (!t) errors.push('A title is required.'); else out.title = t; }
  if (has('body')) out.body = str(body.body, 3000);
  if (has('repoName')) out.repoName = str(body.repoName, 100);
  if (has('status')) { if (!STATUSES.includes(body.status)) errors.push(`Status must be one of: ${STATUSES.join(', ')}.`); else out.status = body.status; }
  if (has('level')) { if (body.level === null || body.level === '') out.level = null; else if (LEVELS.includes(body.level)) out.level = body.level; else errors.push(`Level must be one of: ${LEVELS.join(', ')}.`); }
  if (has('evidence')) out.evidence = str(body.evidence, 1000);
  if (has('evidenceLevel')) { if (!EVIDENCE.includes(body.evidenceLevel)) errors.push(`Evidence level must be one of: ${EVIDENCE.join(', ')}.`); else out.evidenceLevel = body.evidenceLevel; }
  if (has('evidenceCheckedAt')) {
    const v = body.evidenceCheckedAt;
    if (v === null || v === '') out.evidenceCheckedAt = null;
    else if (!isDate(v)) errors.push('The date checked must be a date (YYYY-MM-DD).');
    else if (v > today(now)) errors.push('The date checked cannot be in the future: it records something that already happened.');
    else out.evidenceCheckedAt = v;
  }
  if (has('source')) out.source = str(body.source, 60) || 'owner';
  return { errors, value: out };
}

/** Rules needing the whole record: nothing is "verified" without evidence and a date. */
function checkClaims(rec) {
  const errors = [];
  if (rec.evidenceLevel === 'verified' && (!String(rec.evidence || '').trim() || !rec.evidenceCheckedAt)) errors.push('"Verified" needs evidence (what you checked and where) and the date you checked it. Use "inferred" or "unverified" otherwise.');
  return errors;
}

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const dedupeKey = (it) => `${it.type}|${norm(it.title)}|${norm(it.repoName)}`;

// ── persistence ──────────────────────────────────────────────────────────────────────────────────────────
const newId = () => `pf-${crypto.randomUUID().slice(0, 8)}`;
const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Filters: types (list), status, repo (name), q (full-text, plus partial matches on title and repository name). */
async function listItems(pool, { types, status, repo, q } = {}) {
  const where = []; const params = [];
  if (Array.isArray(types) && types.length) { params.push(types); where.push(`type = ANY($${params.length})`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (repo) { params.push(repo.toLowerCase()); where.push(`lower(repo_name) = $${params.length}`); }
  let order = 'ORDER BY CASE level WHEN \'high\' THEN 0 WHEN \'medium\' THEN 1 WHEN \'low\' THEN 2 ELSE 3 END, updated_at DESC';
  const text = str(q, 120);
  if (text) {
    params.push(text); const a = params.length; params.push(`%${likeEscape(text.toLowerCase())}%`); const b = params.length;
    where.push(`(search @@ websearch_to_tsquery('english', $${a}) OR lower(title) LIKE $${b} OR lower(repo_name) LIKE $${b} OR lower(body) LIKE $${b})`);
    order = `ORDER BY ts_rank(search, websearch_to_tsquery('english', $${a})) DESC, updated_at DESC`;
  }
  const { rows } = await pool.query(`SELECT * FROM ai_portfolio_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${order} LIMIT ${MAX_ROWS}`, params);
  return rows.map(mapItem);
}
async function countByType(pool) {
  const { rows } = await pool.query('SELECT type, count(*)::int AS n FROM ai_portfolio_items GROUP BY type');
  return Object.fromEntries(TYPES.map((t) => [t, (rows.find((r) => r.type === t) || { n: 0 }).n]));
}
async function getItem(pool, id) { const { rows } = await pool.query('SELECT * FROM ai_portfolio_items WHERE id = $1', [id]); return rows[0] ? mapItem(rows[0]) : null; }
async function totalRows(pool) { return (await pool.query('SELECT count(*)::int AS n FROM ai_portfolio_items')).rows[0].n; }

async function createItem(pool, v, { dedupe = false } = {}) {
  const keys = Object.keys(COLS).filter((k) => v[k] !== undefined);
  const params = [newId(), ...keys.map((k) => v[k])];
  let cols = `id, ${keys.map((k) => COLS[k]).join(', ')}`; let marks = `$1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}`;
  if (dedupe) { params.push(dedupeKey(v)); cols += ', dedupe_key'; marks += `, $${params.length}`; }
  const { rows } = await pool.query(`INSERT INTO ai_portfolio_items (${cols}) VALUES (${marks}) RETURNING *`, params);
  return mapItem(rows[0]);
}
async function updateItem(pool, id, v) {
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(COLS)) if (v[k] !== undefined) { params.push(v[k]); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) return getItem(pool, id);
  const { rows } = await pool.query(`UPDATE ai_portfolio_items SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  return rows[0] ? mapItem(rows[0]) : null;
}
const deleteItem = async (pool, id) => (await pool.query('DELETE FROM ai_portfolio_items WHERE id = $1', [id])).rowCount > 0;

/**
 * Import a list of records the owner pasted. Every record is validated like a form entry; duplicates (same type, title
 * and repository) are skipped, never overwritten. `dryRun` shows what would happen and writes nothing.
 */
async function importItems(pool, items, { dryRun = false, now = Date.now() } = {}) {
  const result = { added: [], skipped: [], invalid: [] };
  if (!Array.isArray(items) || !items.length) return { ...result, error: 'Send a list of records.' };
  if (items.length > MAX_IMPORT) return { ...result, error: `Import at most ${MAX_IMPORT} records at a time.` };
  const existing = new Set((await listItems(pool, {})).map(dedupeKey));
  let room = MAX_ROWS - existing.size;
  for (let i = 0; i < items.length; i += 1) {
    const { errors, value } = validateItem({ source: 'import', ...items[i] }, { now });
    const claim = errors.length ? [] : checkClaims({ evidenceLevel: 'unverified', ...value });
    const all = [...errors, ...claim];
    if (all.length) { result.invalid.push({ index: i, title: str(items[i] && items[i].title, 80), errors: all }); continue; }
    const key = dedupeKey(value);
    if (existing.has(key)) { result.skipped.push({ index: i, title: value.title }); continue; }
    if (room <= 0) { result.invalid.push({ index: i, title: value.title, errors: [`The portfolio is full (${MAX_ROWS} records).`] }); continue; }
    existing.add(key); room -= 1;
    result.added.push({ index: i, title: value.title, type: value.type });
    if (!dryRun) await createItem(pool, value, { dedupe: true });
  }
  return result;
}

module.exports = {
  SCHEMA, TYPES, STATUSES, LEVELS, EVIDENCE, MAX_ROWS, MAX_IMPORT,
  validateItem, checkClaims, dedupeKey, listItems, countByType, getItem, totalRows, createItem, updateItem, deleteItem, importItems,
};
