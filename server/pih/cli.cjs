#!/usr/bin/env node
'use strict';
// Personal Intelligence Hub: local-only importer for ChatGPT and Claude exports.
//   node server/pih/cli.cjs [--env-file FILE] [--platform chatgpt|claude] [--dry-run] [--confirm-db NAME] <folder-or-conversations.json>...
// The database URL is read from PIH_DATABASE_URL (environment) or --env-file. It is never accepted as an argument.
// No network access, no AI provider, no cloud storage: see docs/PIH_IMPORTER.md.
const readline = require('readline');
const { GuardError, parseLocalDatabaseUrl, loadDatabaseUrl, verifyConnectedServer } = require('./dbGuard.cjs');
const { ensureSchema } = require('./schema.cjs');
const { resolveInputs, runImport, dryRunFile, totals, InputError } = require('./importer.cjs');

const USAGE = `Usage: node server/pih/cli.cjs [options] <export folder or conversations.json> [more files]

  --dry-run            Read and check the files and print sizes. No database is used.
  --env-file FILE      Settings file containing PIH_DATABASE_URL (keep it OUTSIDE any Git repository, chmod 600).
  --confirm-db NAME    Non-interactive confirmation: must equal the database name shown.
  --platform NAME      chatgpt or claude (default: detected from the file).
  --help               This text.

The database must be on this computer (127.0.0.1, localhost or ::1). Unzip the export first.`;

const REFUSED_FLAGS = ['--password', '--database-url', '--db-url', '--url', '--host', '--connection-string', '--dsn'];

function parseArgs(argv) {
  const o = { paths: [], dryRun: false, envFile: null, confirmDb: null, platform: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.split('=')[0];
    if (REFUSED_FLAGS.includes(name)) throw new InputError(`${name} is not accepted. Database settings come only from PIH_DATABASE_URL or --env-file (arguments show up in process lists and shell history).`);
    const val = () => { if (a.includes('=')) return a.slice(a.indexOf('=') + 1); if (i + 1 >= argv.length) throw new InputError(`${name} needs a value`); return argv[++i]; };
    if (name === '--dry-run') o.dryRun = true;
    else if (name === '--help' || name === '-h') o.help = true;
    else if (name === '--env-file') o.envFile = val();
    else if (name === '--confirm-db') o.confirmDb = val();
    else if (name === '--platform') { o.platform = val(); if (!['chatgpt', 'claude'].includes(o.platform)) throw new InputError('--platform must be chatgpt or claude'); }
    else if (a.startsWith('-')) throw new InputError(`Unknown option: ${name}`);
    else o.paths.push(a);
  }
  return o;
}

const n = (x) => Number(x).toLocaleString('en-US');

function formatSummary(results, t, { dryRun }) {
  const L = [];
  L.push(dryRun ? '\nDRY RUN: nothing was written anywhere.' : '\nImport summary');
  for (const r of results) {
    L.push(`\n  ${r.file}${r.platform ? ` [${r.platform}]` : ''}`);
    if (r.skippedFile) { L.push(`    SKIPPED: ${r.reason}`); continue; }
    L.push(`    conversations found ${n(r.found)} | ${dryRun ? 'readable' : 'added'} ${n(r.added)}${dryRun ? '' : ` | updated ${n(r.updated)} | already present ${n(r.skipped)}`} | failed ${n(r.failed)}`);
    L.push(`    messages ${n(r.messages)} | characters ${n(r.characters)} | status ${r.status}${r.importId ? ` | import #${r.importId}` : ''}`);
    const s = r.stats;
    const notes = [];
    if (s.timestampsMissing) notes.push(`${n(s.timestampsMissing)} missing timestamps`);
    if (s.timestampsInvalid) notes.push(`${n(s.timestampsInvalid)} unreadable timestamps`);
    if (s.unreadableMessages) notes.push(`${n(s.unreadableMessages)} messages with no readable text`);
    if (s.syntheticIds) notes.push(`${n(s.syntheticIds)} conversations without an id (content hash used)`);
    if (s.nulCharsRemoved) notes.push(`${n(s.nulCharsRemoved)} NUL characters dropped from search text (original kept)`);
    if (s.warnings) notes.push(`${n(s.warnings)} structure warnings`);
    if (notes.length) L.push(`    notes: ${notes.join('; ')}`);
    for (const e of r.errors) L.push(`    ERROR ${e.index === null || e.index === undefined ? '(file)' : `conversation #${e.index + 1}`}${e.id ? ` [${e.id}]` : ''}: ${e.error}`);
    if (r.errorsTruncated) L.push(`    ... and ${n(r.errorsTruncated)} more errors (see pih_imports.errors; only the first 50 are kept)`);
  }
  L.push(`\n  TOTAL: ${n(t.files)} file(s), ${n(t.found)} conversations found, ${n(t.added)} ${dryRun ? 'readable' : 'added'}${dryRun ? '' : `, ${n(t.updated)} updated, ${n(t.skipped)} already present`}, ${n(t.failed)} failed`);
  L.push(`         ${n(t.messages)} messages, ${n(t.characters)} characters (about ${n(Math.ceil(t.characters / 4))} tokens if ever analysed; nothing has been sent anywhere)`);
  if (t.filesSkipped) L.push(`         ${n(t.filesSkipped)} file(s) skipped because they were already imported`);
  return L.join('\n');
}

function exitCodeFor(results) {
  if (results.some((r) => r.status === 'failed')) return 1;
  if (results.some((r) => r.status === 'partial')) return 2;
  return 0;
}

function askConfirm(question, deps) {
  if (deps.confirm) return deps.confirm(question);
  if (!process.stdin.isTTY) return Promise.resolve(null);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a); }));
}

async function main(argv, deps = {}) {
  const out = deps.out || ((s) => process.stdout.write(`${s}\n`));
  const err = deps.err || ((s) => process.stderr.write(`${s}\n`));
  const env = deps.env || process.env;
  let client = null;
  try {
    const o = parseArgs(argv);
    if (o.help || (!o.paths.length)) { out(USAGE); return o.help ? 0 : 1; }
    const files = resolveInputs(o.paths);
    const opts = { platform: o.platform, chunkSize: deps.chunkSize };

    if (o.dryRun) {
      const results = [];
      for (const f of files) results.push(await dryRunFile(f, opts));
      const t = totals(results);
      out(formatSummary(results, t, { dryRun: true }));
      return exitCodeFor(results);
    }

    // 1. decide whether this database is allowed, BEFORE any connection is attempted
    const url = loadDatabaseUrl({ env, envFile: o.envFile });
    const { config, display } = parseLocalDatabaseUrl(url);

    // 2. show the target and require confirmation
    out(`Target database: host=${display.host} port=${display.port} name=${display.database}`);
    out(`Files to import: ${files.length}. Conversation text will be stored in this LOCAL database only; nothing is sent anywhere.`);
    const answer = o.confirmDb !== null ? o.confirmDb : await askConfirm(`Type the database name (${display.database}) to confirm: `, deps);
    if (answer === null || String(answer).trim() !== display.database) {
      err(answer === null ? 'Not confirmed: no terminal available. Re-run with --confirm-db <name> or from a terminal.' : 'Not confirmed: the name did not match. Nothing was imported.');
      return 1;
    }

    // 3. connect (guard re-checks the real server), prepare local tables, import
    const pg = deps.pg || require('pg');
    client = new pg.Client(config);
    await client.connect();
    await verifyConnectedServer(client, display.database);
    await ensureSchema(client);
    const results = await runImport(client, files, opts);
    out(formatSummary(results, totals(results), { dryRun: false }));
    return exitCodeFor(results);
  } catch (e) {
    if (e instanceof GuardError || e instanceof InputError) err(e.message);
    else err(`Import stopped: ${e && e.code ? `error code ${e.code}` : (e && e.name) || 'unexpected error'}. No conversation text is shown in error messages.`);
    return 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c));

module.exports = { main, parseArgs, formatSummary };
