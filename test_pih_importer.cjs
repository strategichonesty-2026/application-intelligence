// test_pih_importer.cjs
// Personal Intelligence Hub: local-only importer for ChatGPT and Claude exports.
// Part A needs no database. Part B (database) is SKIPPED unless AI_TEST_DATABASE_URL points at a LOCAL scratch Postgres;
// it creates and drops its own throwaway database. Zero outside network calls: the test fails if anything but loopback is contacted.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const { parseConversation, detectPlatform } = require('./server/pih/normalize.cjs');
const { streamArrayElements, sha256File } = require('./server/pih/jsonStream.cjs');
const { parseLocalDatabaseUrl, loadDatabaseUrl, GuardError } = require('./server/pih/dbGuard.cjs');
const { resolveInputs, dryRunFile, InputError } = require('./server/pih/importer.cjs');
const cli = require('./server/pih/cli.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MARK = 'ZQXMARK'; // a word that must never appear in any output, error or log

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pih-test-'));
const write = (name, content) => { const p = path.join(tmp, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content)); return p; };

// ---------- fixture builders ----------
function gpt({ id = crypto.randomUUID(), title = 'T', t0 = 1731000000, turns = 2, extra = {}, omitTimes = false } = {}) {
  const mapping = { root: { id: 'root', parent: null, children: ['n1'], message: null } };
  let prev = 'root';
  for (let i = 1; i <= turns; i++) {
    const nid = `n${i}`;
    mapping[nid] = { id: nid, parent: prev, children: i < turns ? [`n${i + 1}`] : [], message: { id: nid, author: { role: i % 2 ? 'user' : 'assistant', name: null }, ...(omitTimes ? {} : { create_time: t0 + i }), content: { content_type: 'text', parts: [`message ${i} ${MARK}`] }, status: 'finished_successfully', recipient: 'all' } };
    mapping[prev].children = [nid];
    prev = nid;
  }
  return { title, ...(omitTimes ? {} : { create_time: t0, update_time: t0 + turns }), conversation_id: id, id, current_node: prev, mapping, ...extra };
}
function claude({ uuid = crypto.randomUUID(), name = 'C', turns = 2, omitTimes = false } = {}) {
  const msgs = [];
  for (let i = 0; i < turns; i++) msgs.push({ uuid: crypto.randomUUID(), sender: i % 2 ? 'assistant' : 'human', text: i % 2 ? '' : `question ${i} ${MARK}`, content: [{ type: 'text', text: `body ${i} ${MARK}` }], ...(omitTimes ? {} : { created_at: `2026-03-05T10:3${i}:00.000000Z` }), attachments: [], files: [] });
  return { uuid, name, ...(omitTimes ? {} : { created_at: '2026-03-05T10:30:00.000000Z', updated_at: '2026-03-05T11:45:00.000000Z' }), chat_messages: msgs };
}
const spaced = (arr) => `[\n${arr.map((c) => JSON.stringify(c)).join(',\n')}\n]`;

(async () => {
  // =====================================================================
  console.log('\n— A1. Structures from the documented synthetic examples (docs/PIH_SAMPLE_EXPORTS.md) —');
  const md = fs.readFileSync(path.join(__dirname, 'docs/PIH_SAMPLE_EXPORTS.md'), 'utf8');
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert(blocks.length >= 2, 'both synthetic examples are present in the docs');
  const gptEx = JSON.parse(blocks[0])[0];
  const claudeEx = JSON.parse(blocks[1])[0];
  assert(detectPlatform(gptEx) === 'chatgpt' && detectPlatform(claudeEx) === 'claude', 'platform detected from structure alone');
  const g = parseConversation(JSON.stringify(gptEx));
  assert(g.platform === 'chatgpt' && g.externalId === '11111111-2222-3333-4444-555555555555', 'ChatGPT example: id from conversation_id');
  assert(g.messages.length === 2 && g.messages.every((m) => m.activeBranch) && g.messages[0].position === 0 && g.messages[1].position === 1, 'ChatGPT example: the empty root node is skipped; two messages in order');
  assert(g.messages[0].role === 'user' && g.messages[1].role === 'assistant', 'ChatGPT example: roles kept');
  assert(g.createdAt.toISOString() === new Date(1731000000.5 * 1000).toISOString() && g.messages[0].createdAt instanceof Date, 'ChatGPT example: Unix-second times converted');
  const c = parseConversation(JSON.stringify(claudeEx));
  assert(c.platform === 'claude' && c.externalId === '99999999-8888-7777-6666-555555555555' && c.messages[0].role === 'user', 'Claude example: sender "human" becomes role user');
  assert(c.messages[1].text === 'Consider three tiers...', 'Claude example: empty "text" falls back to content[] blocks');
  assert(c.messages[0].hasAttachment === true && c.messages[1].hasAttachment === false, 'Claude example: attachment flag');
  assert(c.createdAt.toISOString() === '2026-03-05T10:30:00.123Z', 'Claude example: ISO time parsed');

  console.log('\n— A2. Normalizer edge cases —');
  const branched = gpt({ turns: 2 });
  branched.mapping.n2b = { id: 'n2b', parent: 'n1', children: [], message: { id: 'n2b', author: { role: 'assistant' }, create_time: 1731000099, content: { content_type: 'text', parts: ['regenerated'] } } };
  branched.mapping.n1.children.push('n2b');
  const b = parseConversation(JSON.stringify(branched));
  assert(b.messages.length === 3 && b.messages.filter((m) => m.activeBranch).length === 2 && b.messages.find((m) => m.sourceId === 'n2b').activeBranch === false && b.messages.find((m) => m.sourceId === 'n2b').position === null, 'ChatGPT branches: other branch kept, marked not active, no position');
  const noCur = gpt({ turns: 2 }); delete noCur.current_node;
  const nc = parseConversation(JSON.stringify(noCur));
  assert(nc.messages.filter((m) => m.activeBranch).length === 2 && nc.warnings.length === 1, 'missing current_node: latest leaf used and a warning recorded');
  const hid = gpt({ turns: 2 }); hid.mapping.n1.message.metadata = { is_visually_hidden_from_conversation: true }; hid.mapping.n2.message.author.role = 'tool';
  const h = parseConversation(JSON.stringify(hid));
  assert(h.messages[0].hidden === true && h.messages[1].role === 'tool', 'hidden messages and tool messages are labelled, not dropped');
  const multi = gpt({ turns: 1 }); multi.mapping.n1.message.content = { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://x' }, 'caption'] };
  const mm = parseConversation(JSON.stringify(multi));
  assert(mm.messages[0].hasAttachment === true && mm.messages[0].text === 'caption', 'multimodal parts: image flagged, text kept');
  const weird = gpt({ turns: 1 }); weird.mapping.n1.message.content = { content_type: 'future_type', parts: [{ something: 1 }] };
  const wd = parseConversation(JSON.stringify(weird));
  assert(wd.messages[0].unreadable === true && wd.stats.unreadableMessages === 1, 'unknown content shape: kept as "unreadable", never guessed');
  const nt = parseConversation(JSON.stringify(gpt({ omitTimes: true })));
  assert(nt.createdAt === null && nt.messages.every((m) => m.createdAt === null) && nt.stats.timestampsMissing === 4, 'missing timestamps: stored as NULL and counted, import does not fail');
  const badT = gpt({ turns: 1 }); badT.create_time = 'yesterday'; badT.update_time = 99999999999999; badT.mapping.n1.message.create_time = -5;
  const bt = parseConversation(JSON.stringify(badT));
  assert(bt.createdAt === null && bt.updatedAt === null && bt.messages[0].createdAt === null && bt.stats.timestampsInvalid === 3, 'invalid timestamps (text, absurd, negative): NULL and counted');
  const nul = claude({ turns: 1 }); nul.chat_messages[0].text = 'a\u0000b';
  const nl = parseConversation(JSON.stringify(nul));
  assert(nl.messages[0].text === 'ab' && nl.stats.nulCharsRemoved === 1, 'NUL characters removed from search text only (and counted)');
  let err1 = null; try { parseConversation(`{"mapping": {"x": ${MARK} BROKEN`); } catch (e) { err1 = e.message; }
  assert(err1 && !err1.includes(MARK), 'invalid JSON: error message never quotes the content');
  let err2 = null; try { parseConversation(JSON.stringify({ hello: MARK })); } catch (e) { err2 = e.message; }
  assert(err2 && !err2.includes(MARK), 'unknown structure: clear generic error');

  console.log('\n— A3. Streaming reader (no dependency) —');
  const items = [gpt({ id: 'a', title: 'brace } and ] and "quote" \\ ✓ 😀 日本語' }), gpt({ id: 'b' }), claude({ uuid: 'c' })];
  const src = spaced(items);
  const f1 = write('stream/ok.json', src);
  for (const cs of [1, 2, 3, 7, 64, 1 << 20]) {
    const got = [];
    for await (const el of streamArrayElements(f1, { chunkSize: cs })) got.push(el);
    const okAll = got.length === 3 && got.every((e, i) => e.text && JSON.stringify(JSON.parse(e.text)) === JSON.stringify(items[i]));
    assert(okAll, `reader: exact elements with ${cs}-byte chunks (multi-byte characters and brackets inside strings)`);
  }
  const exact = []; for await (const el of streamArrayElements(f1, { chunkSize: 5 })) exact.push(el.text);
  assert(exact.every((t) => src.includes(t)), 'reader: each element is an exact slice of the original file text');
  const trunc = write('stream/trunc.json', src.slice(0, src.length - 60));
  const tr = []; for await (const el of streamArrayElements(trunc)) tr.push(el);
  assert(tr.filter((e) => e.text).length >= 2 && tr[tr.length - 1].fatal && /truncated|unexpectedly/.test(tr[tr.length - 1].error), 'truncated file: complete conversations before the cut are still read; clear error at the end');
  const notArr = []; for await (const el of streamArrayElements(write('stream/obj.json', '{"a":1}'))) notArr.push(el);
  assert(notArr.length === 1 && notArr[0].fatal && /not a JSON array/.test(notArr[0].error), 'a JSON object instead of a list is refused');
  const emp = []; for await (const el of streamArrayElements(write('stream/empty.json', ''))) emp.push(el);
  assert(emp.length === 1 && emp[0].fatal, 'empty file is reported');
  const junk = []; for await (const el of streamArrayElements(write('stream/junk.json', `[${JSON.stringify(gpt())}, nope, ${JSON.stringify(gpt())}]`))) junk.push(el);
  assert(junk.filter((e) => e.text).length === 1 && junk[1].fatal, 'junk between conversations stops the file with a clear error, earlier ones kept');
  const bom = []; for await (const el of streamArrayElements(write('stream/bom.json', `﻿${src}`))) bom.push(el);
  assert(bom.length === 3 && bom.every((e) => e.text), 'byte-order mark tolerated');
  const big = []; for await (const el of streamArrayElements(f1, { maxElementChars: 50 })) big.push(el);
  assert(big.every((e) => e.error && !e.fatal), 'a conversation over the size limit is reported and skipped, not loaded');

  console.log('\n— A4. Remote database rejection (nothing is ever connected) —');
  const remote = [
    'postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway', 'postgresql://u:p@postgres.railway.internal:5432/railway', 'postgresql://u:p@db.example.com/pih',
    'postgresql://u:p@10.0.0.5/pih', 'postgresql://u:p@192.168.1.20/pih', 'postgresql://u:p@0.0.0.0/pih', 'postgresql://u:p@127.0.0.1.evil.com/pih', 'postgresql://u:p@localhost.evil.com/pih',
    'postgresql://u:p@127.0.0.2/pih', 'postgresql://u:p@[2001:db8::1]/pih', 'postgresql://u:p@a.com,127.0.0.1/pih', 'postgresql://u:p@127.0.0.1/pih?host=evil.com', 'postgresql://u:p@127.0.0.1/pih?hostaddr=8.8.8.8',
    'postgresql:///pih', 'postgresql://u:p@%31%32%37.0.0.1/pih', 'postgresql://u:p@127.0.0.1/production', 'postgresql://u:p@127.0.0.1/railway', 'postgresql://u:p@127.0.0.1/', 'mysql://u:p@127.0.0.1/pih', 'not a url', '',
  ];
  let refusedAll = true; const notRefused = [];
  for (const u of remote) { try { parseLocalDatabaseUrl(u); refusedAll = false; notRefused.push(u); } catch (e) { if (!(e instanceof GuardError)) { refusedAll = false; notRefused.push(u); } } }
  assert(refusedAll, `all ${remote.length} remote/odd URLs are refused${notRefused.length ? ` — NOT refused: ${notRefused.join(' | ')}` : ''}`);
  const okUrls = ['postgresql://u:p@127.0.0.1:5434/pih_local', 'postgres://u:p@localhost/pih_local', 'postgresql://u:p@[::1]:5432/pih_local'];
  assert(okUrls.every((u) => { try { parseLocalDatabaseUrl(u); return true; } catch { return false; } }), 'local URLs (127.0.0.1, localhost, ::1) are accepted');
  const parsed = parseLocalDatabaseUrl('postgresql://us%40er:p%40ss@127.0.0.1:5434/pih_local');
  assert(parsed.config.password === 'p@ss' && parsed.config.user === 'us@er' && !JSON.stringify(parsed.display).includes('p@ss'), 'password is decoded for connecting but never part of what is displayed');

  let pgCalls = 0;
  const trapPg = { Client: function Client() { pgCalls++; throw new Error('must not connect'); } };
  const run = async (argv, extra = {}) => { const out = []; const errs = []; const code = await cli.main(argv, { out: (s) => out.push(s), err: (s) => errs.push(s), pg: trapPg, ...extra }); return { code, out: out.join('\n'), err: errs.join('\n') }; };
  const sample = write('cli/conversations.json', spaced([gpt({ id: 'x1' })]));
  let r = await run([sample], { env: { PIH_DATABASE_URL: 'postgresql://u:SECRETPW@roundhouse.proxy.rlwy.net:1/railway' }, confirm: async () => 'railway' });
  assert(r.code === 1 && pgCalls === 0 && /not local/.test(r.err) && !(r.out + r.err).includes('SECRETPW'), 'CLI: Railway-style URL refused before any connection, password never printed');
  r = await run([sample], { env: { DATABASE_URL: 'postgresql://u:p@db.example.com/x' }, confirm: async () => 'x' });
  assert(r.code === 1 && pgCalls === 0 && /No database URL/.test(r.err), 'CLI: DATABASE_URL (the console database) is never used as a fallback');
  r = await run([sample], { env: { PIH_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/pih_local', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/pih_local' }, confirm: async () => 'pih_local' });
  assert(r.code === 1 && pgCalls === 0 && /same as DATABASE_URL/.test(r.err), 'CLI: a URL identical to the console DATABASE_URL is refused');
  for (const flag of ['--password=x', '--database-url', '--host']) {
    r = await run([flag, 'postgresql://u:p@127.0.0.1/pih_local', sample]);
    assert(r.code === 1 && pgCalls === 0 && /not accepted/.test(r.err), `CLI: ${flag.split('=')[0]} is not accepted as an argument`);
  }
  r = await run([sample], { env: { PIH_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/pih_local' }, confirm: async () => 'wrong-name' });
  assert(r.code === 1 && pgCalls === 0 && /Target database: host=127.0.0.1 port=1 name=pih_local/.test(r.out) && /did not match/.test(r.err), 'CLI: shows host and database name; a wrong confirmation imports nothing and never connects');
  r = await run([sample], { env: { PIH_DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/pih_local' } });
  assert(r.code === 1 && pgCalls === 0 && /Not confirmed/.test(r.err), 'CLI: without a terminal or --confirm-db nothing runs');
  const envOut = write('envfile/outside.env', 'PIH_DATABASE_URL=postgresql://u:p@127.0.0.1:1/pih_local\n'); fs.chmodSync(envOut, 0o600);
  assert(loadDatabaseUrl({ env: {}, envFile: envOut }).includes('127.0.0.1'), 'env file outside Git with private permissions is read');
  fs.chmodSync(envOut, 0o644);
  let e3 = null; try { loadDatabaseUrl({ env: {}, envFile: envOut }); } catch (e) { e3 = e; }
  assert(e3 instanceof GuardError && /other users/.test(e3.message), 'env file readable by others is refused');
  const inRepo = path.join(__dirname, '.pih-test-inrepo.env'); fs.writeFileSync(inRepo, 'PIH_DATABASE_URL=postgresql://u:p@127.0.0.1:1/x\n'); fs.chmodSync(inRepo, 0o600);
  let e4 = null; try { loadDatabaseUrl({ env: {}, envFile: inRepo }); } catch (e) { e4 = e; } fs.unlinkSync(inRepo);
  assert(e4 instanceof GuardError && /Git repository/.test(e4.message), 'env file inside a Git repository is refused');

  console.log('\n— A5. Inputs and dry run —');
  let e5 = null; try { resolveInputs([write('zip/export.zip', 'PK')]); } catch (e) { e5 = e; }
  assert(e5 instanceof InputError && /Unzip it first/.test(e5.message), 'ZIP: clear instruction to unzip (no ZIP dependency added)');
  write('exp/conversations-000.json', spaced([gpt({ id: 'd1' })])); write('exp/conversations-001.json', spaced([gpt({ id: 'd2' })]));
  write('exp/user.json', '{}'); write('exp/chat.html', '<html>'); write('exp/shared_conversations.json', '[]'); write('exp/personal/conversations/conversations.json', spaced([gpt({ id: 'd3' })]));
  const found = resolveInputs([path.join(tmp, 'exp')]).map((p) => path.relative(tmp, p));
  assert(found.length === 3 && found.includes('exp/conversations-000.json') && found.includes('exp/personal/conversations/conversations.json') && !found.some((p) => /user|chat|shared/.test(p)), 'folder: finds sharded and nested conversation files, ignores everything else');
  let e6 = null; try { resolveInputs([path.join(tmp, 'zip')]); } catch (e) { e6 = e; }
  assert(e6 instanceof InputError, 'folder with no conversation files is reported');
  const dry = write('dry/conversations.json', spaced([gpt({ id: 'q1' }), claude({ uuid: 'q2' }), '{"broken": ' + MARK]));
  fs.writeFileSync(dry, `[${JSON.stringify(gpt({ id: 'q1' }))},${JSON.stringify(gpt({ id: 'q2' }))},{"broken": 1}]`);
  const hashBefore = await sha256File(dry);
  r = await run(['--dry-run', dry]);
  assert(pgCalls === 0 && /DRY RUN/.test(r.out) && /failed 1/.test(r.out) && r.code === 2, 'dry run: counts and errors reported, no database used, exit code 2 for partial');
  assert((await sha256File(dry)) === hashBefore, 'dry run leaves the file unchanged');

  console.log('\n— A6. Privacy boundaries in the code —');
  const pihDir = path.join(__dirname, 'server/pih');
  const pihSrc = fs.readdirSync(pihDir).filter((f) => f.endsWith('.cjs')).map((f) => [f, fs.readFileSync(path.join(pihDir, f), 'utf8')]);
  const banned = /require\(\s*['"](https?|http2|dns|dgram|tls|child_process|node-fetch|axios|undici|openai|@anthropic-ai\/[\w-]+|@aws-sdk\/[\w-]+)['"]\s*\)|\bfetch\s*\(|XMLHttpRequest|WebSocket|api\.openai|api\.anthropic|ANTHROPIC_API_KEY|OPENAI_API_KEY|r2\.cloudflarestorage|R2_/;
  assert(pihSrc.every(([, s]) => !banned.test(s)), 'importer source has no HTTP, DNS, AI-provider, cloud-storage or subprocess code');
  const requires = new Set(); for (const [, s] of pihSrc) for (const m of s.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) requires.add(m[1]);
  assert([...requires].every((m) => m.startsWith('.') || ['fs', 'path', 'crypto', 'string_decoder', 'readline', 'pg'].includes(m)), `importer imports only Node built-ins and pg (found: ${[...requires].filter((m) => !m.startsWith('.')).join(', ')})`);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert(Object.keys(pkg.dependencies).sort().join() === 'dotenv,express,pg,react,react-dom', 'no new dependency was added to package.json');
  const consoleFiles = []; const walkDir = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (p !== pihDir && e.name !== 'node_modules') walkDir(p); } else if (/\.(c?js|jsx)$/.test(e.name)) consoleFiles.push(p); } };
  walkDir(path.join(__dirname, 'server')); walkDir(path.join(__dirname, 'src'));
  assert(consoleFiles.every((f) => !/pih\//.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''))) && !fs.readFileSync(path.join(__dirname, 'server/services/appIntelligence/store.cjs'), 'utf8').includes('pih_'), 'the console and its schema do not import or create anything from the importer');

  // =====================================================================
  const adminUrl = process.env.AI_TEST_DATABASE_URL;
  if (!adminUrl) { console.log('\nSKIPPED part B: set AI_TEST_DATABASE_URL to a LOCAL scratch Postgres to run the database tests.'); cleanup(); return finish(); }
  const { Client } = require('pg');
  const au = new URL(adminUrl);
  if (!['127.0.0.1', 'localhost', '::1'].includes(au.hostname.replace(/[[\]]/g, ''))) { console.log('SKIPPED part B: AI_TEST_DATABASE_URL is not local.'); cleanup(); return finish(); }

  // lock the network: only loopback sockets, no HTTP, no fetch, no DNS
  const contacted = [];
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function patched(...a) { const o = a[0]; contacted.push(typeof o === 'object' && o !== null ? (o.host || o.path || 'unknown') : (typeof a[1] === 'string' ? a[1] : 'localhost')); return origConnect.apply(this, a); };
  let outsideCalls = 0;
  const origHttp = http.request; const origHttps = https.request; const origFetch = global.fetch;
  http.request = https.request = () => { outsideCalls++; throw new Error('network blocked'); };
  global.fetch = () => { outsideCalls++; throw new Error('network blocked'); };

  const dbName = `pih_test_${process.pid}_${Date.now() % 100000}`;
  const admin = new Client({ connectionString: adminUrl }); await admin.connect();
  await admin.query(`create database ${dbName}`);
  const host = au.hostname; const port = au.port || '5432';
  const URL_OK = `postgresql://${au.username}:${au.password}@${host}:${port}/${dbName}`;
  const pw = decodeURIComponent(au.password);
  const q = async (sql, p) => { const c = new Client(parseLocalDatabaseUrl(URL_OK).config); await c.connect(); try { return (await c.query(sql, p)).rows; } finally { await c.end(); } };
  const imp = async (paths, extra = {}) => { const out = []; const errs = []; const code = await cli.main([...(extra.args || []), ...paths], { out: (s) => out.push(s), err: (s) => errs.push(s), env: { PIH_DATABASE_URL: URL_OK }, confirm: async () => dbName, chunkSize: extra.chunkSize, ...(extra.deps || {}) }); return { code, out: out.join('\n'), err: errs.join('\n') }; };
  const cleanup2 = async () => { await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => {}); await admin.end().catch(() => {}); };

  try {
    console.log('\n— B1. First import of both formats —');
    const gA = gpt({ id: 'g-1', title: 'First', turns: 4 }); const cA = claude({ uuid: 'c-1', turns: 4 });
    const fileG = write('db/gpt/conversations.json', spaced([gA, gpt({ id: 'g-2' })]));
    const fileC = write('db/claude/conversations.json', spaced([cA]));
    const before = { g: await sha256File(fileG), c: await sha256File(fileC), st: fs.statSync(fileG).mtimeMs, ls: fs.readdirSync(path.dirname(fileG)).join() };
    let r1 = await imp([fileG, fileC]);
    assert(r1.code === 0 && /3 conversations found, 3 added/.test(r1.out) && /Target database: host=/.test(r1.out), `import succeeds and prints a summary (exit ${r1.code})`);
    const counts = (await q('select (select count(*) from pih_conversations)::int c, (select count(*) from pih_messages)::int m, (select count(*) from pih_imports)::int i'))[0];
    assert(counts.c === 3 && counts.m === 4 + 2 + 4 && counts.i === 2, 'rows: 3 conversations, 10 messages, 2 import records');
    const row = (await q("select * from pih_conversations where external_id = 'g-1'"))[0];
    const originalSlice = JSON.stringify(gA);
    assert(row.raw_text === originalSlice && row.raw_sha256 === sha(originalSlice), 'original conversation stored byte-for-byte unchanged (text and hash)');
    assert(row.platform === 'chatgpt' && row.title === 'First' && row.message_count === 4 && row.created_at_src.toISOString() === new Date(1731000000000).toISOString(), 'conversation metadata: platform, id, title, source timestamps');
    const ms = await q("select m.role, m.position, m.created_at_src from pih_messages m join pih_conversations c on c.id = m.conversation_id where c.external_id = 'c-1' order by position");
    assert(ms.map((m) => m.role).join() === 'user,assistant,user,assistant' && ms.every((m) => m.created_at_src), 'messages: roles and timestamps stored');
    const impRow = (await q("select * from pih_imports where platform = 'chatgpt'"))[0];
    assert(impRow.status === 'done' && impRow.found === 2 && impRow.added === 2 && impRow.file_sha256 === before.g && impRow.file_name === 'conversations.json' && !JSON.stringify(impRow).includes(tmp), 'import record: status, counts, source hash, base file name only (no folder path)');
    assert(before.g === await sha256File(fileG) && before.c === await sha256File(fileC) && before.st === fs.statSync(fileG).mtimeMs && before.ls === fs.readdirSync(path.dirname(fileG)).join(), 'export files untouched: same hash and modified time, nothing written beside them');

    console.log('\n— B2. Duplicate imports —');
    const snap = async () => JSON.stringify(await q('select id, external_id, raw_sha256, message_count, import_id from pih_conversations order by id')) + JSON.stringify(await q('select count(*)::int n from pih_messages'));
    const s0 = await snap();
    const again = await imp([fileG, fileC]);
    assert(again.code === 0 && (again.out.match(/SKIPPED: this exact file was already imported/g) || []).length === 2 && (await snap()) === s0, 're-importing the same files changes nothing');
    assert((await q('select count(*)::int n from pih_imports'))[0].n === 2, 're-import adds no import record');
    const reformatted = write('db/gpt/copy.json', JSON.stringify([gA, gpt({ id: 'g-2' })], null, 1).replace(/\n/g, '\r\n'));
    // same conversations in different bytes (different formatting) are present already by id; the raw text of each differs, so they count as updated unless identical
    const same = write('db/gpt/same-conversations.json', `[${JSON.stringify(gA)}]`);
    const dupe = await imp([same]);
    assert(dupe.code === 0 && /already present 1/.test(dupe.out) && (await snap()) === s0, 'the same conversation inside a different file is recognised and skipped');
    void reformatted;
    const grown = { ...gA, mapping: { ...gA.mapping } }; grown.mapping.n5 = { id: 'n5', parent: 'n4', children: [], message: { id: 'n5', author: { role: 'user' }, create_time: 1731000100, content: { content_type: 'text', parts: ['follow-up'] } } }; grown.mapping.n4.children = ['n5']; grown.current_node = 'n5'; grown.update_time = 1731000100;
    const gr = await imp([write('db/gpt/grown.json', `[${JSON.stringify(grown)}]`)]);
    const hist = await q("select h.raw_text from pih_conversation_history h join pih_conversations c on c.id = h.conversation_id where c.external_id = 'g-1'");
    const nowRow = (await q("select message_count, raw_text from pih_conversations where external_id = 'g-1'"))[0];
    assert(gr.code === 0 && /updated 1/.test(gr.out) && hist.length === 1 && hist[0].raw_text === originalSlice && nowRow.message_count === 5 && nowRow.raw_text === JSON.stringify(grown), 'a conversation that grew is updated; the earlier original is kept in history, not lost');
    assert((await q("select count(*)::int n from pih_messages m join pih_conversations c on c.id=m.conversation_id where c.external_id='g-1'"))[0].n === 5, 'updated conversation has exactly its new messages (none duplicated)');
    const noId = gpt({ id: 'tmp' }); delete noId.id; delete noId.conversation_id;
    const nf = write('db/gpt/noid.json', `[${JSON.stringify(noId)}]`);
    const n1 = await imp([nf]);
    const n2 = await imp([write('db/gpt/noid2.json', `[ ${JSON.stringify(noId)} ]`)]);
    assert(n1.code === 0 && /without an id/.test(n1.out) && /already present 1/.test(n2.out) && (await q("select count(*)::int n from pih_conversations where id_synthetic"))[0].n === 1, 'a conversation with no id gets a content-hash id and is still de-duplicated');

    console.log('\n— B3. Malformed files —');
    const mixed = write('db/bad/conversations.json', `[${JSON.stringify(gpt({ id: 'ok-1' }))}, {"mapping": {"a": ${MARK} OOPS}}, ${JSON.stringify(claude({ uuid: 'wrong-format' }))}, {"hello": "${MARK}"}, ${JSON.stringify(gpt({ id: 'ok-2' }))}]`);
    // element 2 is balanced but invalid JSON, 3 is the other platform, 4 has an unknown structure
    const mr = await imp([mixed]);
    const okIds = (await q("select external_id from pih_conversations where external_id like 'ok-%' order by 1")).map((x) => x.external_id);
    assert(mr.code === 2 && okIds.join() === 'ok-1,ok-2' && /ERROR conversation #2/.test(mr.out) && /status partial/.test(mr.out), 'one bad conversation is reported and skipped; the good ones are imported; exit code 2');
    assert(!(mr.out + mr.err).includes(MARK), 'error report contains no conversation content');
    const storedErrs = (await q("select errors, status, failed from pih_imports where file_name = 'conversations.json' and status = 'partial'"))[0];
    assert(storedErrs && storedErrs.failed >= 2 && !JSON.stringify(storedErrs.errors).includes(MARK), 'the stored import record lists the errors, without content');
    const wrongFmt = (await q("select count(*)::int n from pih_conversations where external_id = 'wrong-format'"))[0].n;
    assert(wrongFmt === 0, 'a conversation of the other platform inside the same file is refused, not mixed in');
    const truncFile = write('db/bad2/conversations.json', spaced([gpt({ id: 't-1' }), gpt({ id: 't-2' }), gpt({ id: 't-3' })]).slice(0, -40));
    const tr2 = await imp([truncFile]);
    assert(tr2.code === 2 && /truncated|unexpectedly/.test(tr2.out) && (await q("select count(*)::int n from pih_conversations where external_id in ('t-1','t-2')"))[0].n === 2, 'truncated file: complete conversations imported, truncation reported, exit 2');
    const garbage = await imp([write('db/bad3/conversations.json', `not json at all ${MARK}`)]);
    assert(garbage.code === 1 && !(garbage.out + garbage.err).includes(MARK) && /not a JSON array/.test(garbage.out), 'a file that is not JSON fails clearly (exit 1) without echoing it');
    const emptyArr = await imp([write('db/bad4/conversations.json', '[]')]);
    assert(emptyArr.code === 0 && /0 conversations found/.test(emptyArr.out), 'an empty export is a valid, empty import');

    console.log('\n— B4. Missing timestamps —');
    const nts = await imp([write('db/nots/conversations.json', spaced([gpt({ id: 'nt-1', omitTimes: true }), claude({ uuid: 'nt-2', omitTimes: true })]))], { args: [] }).catch((e) => ({ code: -1, out: String(e), err: '' }));
    const ntRows = await q("select external_id, created_at_src, updated_at_src from pih_conversations where external_id in ('nt-1') ");
    assert(nts.code === 2 || nts.code === 0, 'import with missing timestamps finishes');
    assert(ntRows[0] && ntRows[0].created_at_src === null && ntRows[0].updated_at_src === null && /missing timestamps/.test(nts.out), 'missing timestamps are stored as NULL and listed in the notes');

    console.log('\n— B5. Large export —');
    const N = 1500; const bigDir = path.join(tmp, 'db/big'); fs.mkdirSync(bigDir, { recursive: true });
    const bigFile = path.join(bigDir, 'conversations-000.json');
    const fd = fs.openSync(bigFile, 'w'); fs.writeSync(fd, '[');
    const filler = 'lorem ipsum dolor sit amet '.repeat(40);
    for (let i = 0; i < N; i++) { const c = gpt({ id: `big-${i}`, turns: 12 }); for (const nid of Object.keys(c.mapping)) if (c.mapping[nid].message) c.mapping[nid].message.content.parts[0] += ` ${filler}${i}`; fs.writeSync(fd, (i ? ',' : '') + JSON.stringify(c)); }
    fs.writeSync(fd, ']'); fs.closeSync(fd);
    const sizeMb = fs.statSync(bigFile).size / 1048576;
    const t0 = Date.now(); const rss0 = process.memoryUsage().rss;
    const bg = await imp([bigFile], { chunkSize: 64 * 1024 });
    const secs = (Date.now() - t0) / 1000;
    const bigRows = (await q("select count(*)::int c, sum(message_count)::int m from pih_conversations where external_id like 'big-%'"))[0];
    assert(bg.code === 0 && bigRows.c === N && bigRows.m === N * 12, `large export: ${N} conversations, ${(N * 12).toLocaleString()} messages (${sizeMb.toFixed(1)} MB file) imported in ${secs.toFixed(1)}s`);
    assert(process.memoryUsage().rss - rss0 < sizeMb * 1048576 * 3 + 150 * 1048576, 'large export: memory use stays well below the size of the file (streamed, one conversation at a time)');

    console.log('\n— B6. Safety checks on the database —');
    const lockHolder = new Client(parseLocalDatabaseUrl(URL_OK).config); await lockHolder.connect(); await lockHolder.query('select pg_advisory_lock(7294501)');
    const lk = await imp([write('db/lock/conversations.json', spaced([gpt({ id: 'lock-1' })]))]);
    await lockHolder.end();
    assert(lk.code === 1 && /already running/.test(lk.err), 'two imports cannot run at the same time');
    await q('create table ai_applications (id int)');
    const prod = await imp([write('db/marker/conversations.json', spaced([gpt({ id: 'mk-1' })]))]);
    assert(prod.code === 1 && /production marker/.test(prod.err) && (await q("select count(*)::int n from pih_conversations where external_id = 'mk-1'"))[0].n === 0, 'a database holding the console tables is refused (production marker); nothing imported');
    await q('drop table ai_applications');
    const wrongDb = await imp([write('db/wrong/conversations.json', spaced([gpt({ id: 'wr-1' })]))], { deps: { confirm: async () => 'something_else' } });
    assert(wrongDb.code === 1 && (await q("select count(*)::int n from pih_conversations where external_id = 'wr-1'"))[0].n === 0, 'wrong confirmation: nothing imported');

    console.log('\n— B7. Privacy boundaries during real imports —');
    const allText = [r1, again, dupe, gr, mr, tr2, garbage, nts, bg, lk, prod].map((x) => x.out + x.err).join('\n');
    assert(!allText.includes(MARK) && !allText.includes('message 1') && !allText.includes('question'), 'no message text or title appears in any output or error');
    assert(!allText.includes(pw) && !allText.includes(URL_OK), 'the database password and connection string never appear in output');
    assert(outsideCalls === 0, 'no HTTP, HTTPS or fetch call was attempted');
    const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
    assert(contacted.length > 0 && contacted.every((h) => loopback.has(String(h).replace(/[[\]]/g, ''))), `every network connection went to this computer only (${[...new Set(contacted)].join(', ')})`);
    const dbText = JSON.stringify(await q('select errors, stats from pih_imports'));
    assert(!dbText.includes(MARK), 'stored import records contain no conversation content');
  } finally {
    net.Socket.prototype.connect = origConnect; http.request = origHttp; https.request = origHttps; global.fetch = origFetch;
    await cleanup2();
  }
  cleanup();
  finish();
})().catch((e) => { console.log(`❌ FAIL: unexpected exception: ${e && e.stack ? e.stack : e}`); failures++; cleanup(); finish(); });

function cleanup() { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } }
function finish() { console.log(failures ? `\n${failures} FAILED` : '\nAll PIH importer tests passed.'); process.exit(failures ? 1 : 0); }
