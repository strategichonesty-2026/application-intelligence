'use strict';
// Local-only import of ChatGPT and Claude export files.
// - Reads export files read-only; writes nothing next to them.
// - Stores each conversation's ORIGINAL text unchanged (raw_text) plus normalized messages.
// - No network, no AI, no object storage. Only a database client that the caller has already guard-checked.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { streamArrayElements, sha256File } = require('./jsonStream.cjs');
const { parseConversation, ParseError } = require('./normalize.cjs');

const MAX_ERRORS = 50;
const FILE_PATTERN = /^conversations(-\d+)?\.json$/i;
const LOCK_KEY = 7294501;

class InputError extends Error { constructor(m) { super(m); this.name = 'InputError'; } }

function sha256Text(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

// Expands files/folders into the list of conversation files. A .zip must be unzipped first (no ZIP dependency).
function resolveInputs(paths, { maxDepth = 3 } = {}) {
  if (!paths || !paths.length) throw new InputError('No export file or folder given.');
  const files = [];
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < maxDepth) walk(p, depth + 1);
      else if (e.isFile() && FILE_PATTERN.test(e.name)) files.push(p);
    }
  };
  for (const p of paths) {
    let st;
    try { st = fs.statSync(p); } catch { throw new InputError(`Not found: ${path.basename(p)}`); }
    if (st.isDirectory()) {
      const before = files.length;
      walk(p, 0);
      if (files.length === before) throw new InputError(`No conversations.json or conversations-NNN.json found in folder: ${path.basename(p)}`);
    } else if (/\.zip$/i.test(p)) {
      throw new InputError('This is a ZIP file. Unzip it first (the importer needs no ZIP library), then give it the folder or the conversations file inside.');
    } else if (/\.json$/i.test(p)) files.push(p);
    else throw new InputError(`Unsupported file type: ${path.basename(p)} (expected .json)`);
  }
  return [...new Set(files.map((f) => path.resolve(f)))];
}

function newFileSummary(file) {
  return { file: path.basename(file), platform: null, found: 0, added: 0, updated: 0, skipped: 0, failed: 0, messages: 0, characters: 0, skippedFile: false, reason: null, status: null, errors: [], errorsTruncated: 0, stats: { timestampsMissing: 0, timestampsInvalid: 0, nulCharsRemoved: 0, unreadableMessages: 0, syntheticIds: 0, warnings: 0 } };
}
function addError(sum, e) { if (sum.errors.length < MAX_ERRORS) sum.errors.push(e); else sum.errorsTruncated++; }
function mergeStats(sum, st, warnings) {
  for (const k of Object.keys(st)) sum.stats[k] += st[k];
  sum.stats.warnings += (warnings || []).length;
}

// Reads and checks every conversation without touching any database (--dry-run).
async function dryRunFile(file, opts = {}) {
  const sum = newFileSummary(file);
  sum.sha256 = await sha256File(file);
  for await (const el of streamArrayElements(file, opts)) {
    if (el.error) { addError(sum, { index: el.index ?? null, error: el.error }); if (el.fatal) sum.status = 'partial'; else sum.failed++; if (!el.fatal) sum.found++; continue; }
    sum.found++;
    try {
      const c = parseConversation(el.text, opts.platform);
      if (sum.platform && sum.platform !== c.platform) throw new ParseError('conversation format differs from the rest of the file');
      sum.platform = c.platform;
      sum.added++;
      sum.messages += c.messages.length;
      sum.characters += c.messages.reduce((n, m) => n + m.text.length, 0);
      if (!c.externalId) sum.stats.syntheticIds++;
      mergeStats(sum, c.stats, c.warnings);
    } catch (e) { sum.failed++; addError(sum, { index: el.index, error: e instanceof ParseError ? e.message : 'unexpected error' }); }
  }
  sum.status = sum.status || (sum.failed ? 'partial' : 'done');
  return sum;
}

async function insertMessages(client, convId, messages) {
  if (!messages.length) return;
  const col = (f) => messages.map(f);
  await client.query(
    `insert into pih_messages (conversation_id, position, source_id, role, text, created_at_src, active_branch, hidden, content_type, has_attachment, unreadable)
     select $1, * from unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::bool[], $8::bool[], $9::text[], $10::bool[], $11::bool[])`,
    [convId, col((m) => m.position), col((m) => m.sourceId), col((m) => m.role), col((m) => m.text), col((m) => m.createdAt), col((m) => m.activeBranch), col((m) => m.hidden), col((m) => m.contentType), col((m) => m.hasAttachment), col((m) => m.unreadable)],
  );
}

// Stores one parsed conversation. Returns 'added' | 'updated' | 'skipped'.
async function storeConversation(client, importId, c, rawText) {
  const rawSha = sha256Text(rawText);
  const synthetic = !c.externalId;
  const externalId = c.externalId || `sha256:${rawSha}`;
  await client.query('begin');
  try {
    const ex = await client.query('select id, raw_sha256, title, raw_text, import_id from pih_conversations where platform = $1 and external_id = $2 for update', [c.platform, externalId]);
    let outcome;
    let convId;
    if (ex.rows.length && ex.rows[0].raw_sha256 === rawSha) {
      outcome = 'skipped';
    } else if (ex.rows.length) {
      // the conversation grew or changed since the last export: keep the earlier original in history, never silently drop it
      const old = ex.rows[0];
      convId = old.id;
      await client.query('insert into pih_conversation_history (conversation_id, import_id, title, raw_text, raw_sha256) values ($1,$2,$3,$4,$5)', [convId, old.import_id, old.title, old.raw_text, old.raw_sha256]);
      await client.query('delete from pih_messages where conversation_id = $1', [convId]);
      await client.query('update pih_conversations set title=$2, created_at_src=$3, updated_at_src=$4, import_id=$5, message_count=$6, raw_text=$7, raw_sha256=$8, id_synthetic=$9, imported_at=now() where id=$1',
        [convId, c.title, c.createdAt, c.updatedAt, importId, c.messages.length, rawText, rawSha, synthetic]);
      await insertMessages(client, convId, c.messages);
      outcome = 'updated';
    } else {
      const ins = await client.query('insert into pih_conversations (platform, external_id, id_synthetic, title, created_at_src, updated_at_src, import_id, message_count, raw_text, raw_sha256) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id',
        [c.platform, externalId, synthetic, c.title, c.createdAt, c.updatedAt, importId, c.messages.length, rawText, rawSha]);
      convId = ins.rows[0].id;
      await insertMessages(client, convId, c.messages);
      outcome = 'added';
    }
    await client.query('commit');
    return outcome;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

async function importFile(client, file, opts = {}) {
  const sum = newFileSummary(file);
  const st = fs.statSync(file);
  sum.sha256 = await sha256File(file);
  const prev = await client.query("select id from pih_imports where file_sha256 = $1 and status = 'done' order by id limit 1", [sum.sha256]);
  if (prev.rows.length) {
    sum.skippedFile = true; sum.status = 'skipped'; sum.reason = `this exact file was already imported (import #${prev.rows[0].id})`;
    return sum;
  }
  const imp = await client.query('insert into pih_imports (file_name, file_sha256, file_bytes) values ($1,$2,$3) returning id', [path.basename(file), sum.sha256, st.size]);
  const importId = imp.rows[0].id;
  sum.importId = importId;
  let fatal = false;

  for await (const el of streamArrayElements(file, opts)) {
    if (el.error) {
      addError(sum, { index: el.index ?? null, error: el.error });
      if (el.fatal) fatal = true; else { sum.found++; sum.failed++; }
      continue;
    }
    sum.found++;
    let c;
    try {
      c = parseConversation(el.text, opts.platform);
      if (sum.platform && sum.platform !== c.platform) throw new ParseError('conversation format differs from the rest of the file');
    } catch (e) { sum.failed++; addError(sum, { index: el.index, error: e instanceof ParseError ? e.message : 'unexpected error' }); continue; }
    sum.platform = c.platform;
    try {
      const outcome = await storeConversation(client, importId, c, el.text);
      sum[outcome]++;
      if (outcome === 'added' || outcome === 'updated') {
        sum.messages += c.messages.length;
        sum.characters += c.messages.reduce((n, m) => n + m.text.length, 0);
        mergeStats(sum, c.stats, c.warnings);
        if (!c.externalId) sum.stats.syntheticIds++;
      }
    } catch (e) {
      // only the database error code is kept: server messages can quote the data that failed
      sum.failed++; addError(sum, { index: el.index, id: c.externalId || null, error: `database error${e && e.code ? ` (${e.code})` : ''}` });
    }
  }

  sum.status = fatal ? (sum.added + sum.updated + sum.skipped ? 'partial' : 'failed') : (sum.failed ? 'partial' : 'done');
  await client.query('update pih_imports set platform=$2, status=$3, found=$4, added=$5, updated=$6, skipped=$7, failed=$8, messages_added=$9, characters=$10, stats=$11, errors=$12, finished_at=now() where id=$1',
    [importId, sum.platform, sum.status, sum.found, sum.added, sum.updated, sum.skipped, sum.failed, sum.messages, sum.characters, JSON.stringify(sum.stats), JSON.stringify(sum.errors)]);
  return sum;
}

async function runImport(client, files, opts = {}) {
  const lock = await client.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
  if (!lock.rows[0].ok) throw new InputError('Another import is already running against this database.');
  const results = [];
  try {
    for (const f of files) results.push(await importFile(client, f, opts));
  } catch (e) {
    // never leave an import row looking like it is still running
    await client.query("update pih_imports set status='failed', finished_at=now() where status='running'").catch(() => {});
    throw e;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
  }
  return results;
}

function totals(results) {
  const t = { files: results.length, filesSkipped: 0, found: 0, added: 0, updated: 0, skipped: 0, failed: 0, messages: 0, characters: 0, timestampsMissing: 0, timestampsInvalid: 0, nulCharsRemoved: 0, unreadableMessages: 0, syntheticIds: 0 };
  for (const r of results) {
    if (r.skippedFile) { t.filesSkipped++; continue; }
    for (const k of ['found', 'added', 'updated', 'skipped', 'failed', 'messages', 'characters']) t[k] += r[k];
    for (const k of ['timestampsMissing', 'timestampsInvalid', 'nulCharsRemoved', 'unreadableMessages', 'syntheticIds']) t[k] += r.stats[k];
  }
  return t;
}

module.exports = { resolveInputs, runImport, dryRunFile, totals, InputError, sha256Text, FILE_PATTERN };
