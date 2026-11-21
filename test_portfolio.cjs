// test_portfolio.cjs
// Command Center step 5a: the Master Portfolio. Validation and honesty rules run offline; storage, search and import need
// AI_TEST_DATABASE_URL. Dummy values only. Run: node test_portfolio.cjs
const pf = require('./server/services/appIntelligence/portfolio.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = Date.UTC(2026, 10, 21);

(async () => {
  // ── validation ──
  const ok = pf.validateItem({ type: 'risk', title: 'Default key fallback', body: 'Details', repoName: 'alpha', level: 'high', evidence: 'code review', evidenceLevel: 'verified', evidenceCheckedAt: '2026-11-20' }, { now: NOW });
  assert(!ok.errors.length && ok.value.type === 'risk' && ok.value.level === 'high', 'validate: a complete risk is accepted');
  assert(pf.validateItem({ title: 'x' }).errors.length === 1 && pf.validateItem({ type: 'wish', title: 'x' }).errors.length === 1 && pf.validateItem({ type: 'idea' }).errors.length === 1, 'validate: type and title are required and the type must be known');
  assert(pf.validateItem({ type: 'idea', title: 'x', status: 'maybe' }).errors.length === 1 && pf.validateItem({ type: 'risk', title: 'x', level: 'extreme' }).errors.length === 1 && pf.validateItem({ type: 'risk', title: 'x', evidenceLevel: 'certain' }).errors.length === 1, 'validate: status, level and evidence level must be known values');
  assert(pf.validateItem({ type: 'risk', title: 'x', evidenceCheckedAt: '2026-12-31' }, { now: NOW }).errors.length === 1 && pf.validateItem({ type: 'risk', title: 'x', evidenceCheckedAt: 'yesterday' }, { now: NOW }).errors.length === 1, 'validate: the date checked cannot be in the future or malformed');
  const leak = pf.validateItem({ type: 'risk', title: 'Key', body: 'sk_' + 'a1b2c3d4e5f6a7b8c9d0e1f2' });
  assert(leak.errors.length === 1 && !JSON.stringify(leak).includes('a1b2c3d4e5f6'), 'validate: a secret-looking value is refused and never echoed');
  assert(pf.checkClaims({ evidenceLevel: 'verified', evidence: '', evidenceCheckedAt: null }).length === 1 && pf.checkClaims({ evidenceLevel: 'verified', evidence: 'read the file', evidenceCheckedAt: null }).length === 1 && pf.checkClaims({ evidenceLevel: 'verified', evidence: 'read the file', evidenceCheckedAt: '2026-11-20' }).length === 0 && pf.checkClaims({ evidenceLevel: 'inferred', evidence: '' }).length === 0, 'honesty: "verified" needs evidence AND a date; inferred and unverified do not claim more than they know');
  assert(pf.dedupeKey({ type: 'risk', title: '  Same  Title ', repoName: 'Alpha' }) === pf.dedupeKey({ type: 'risk', title: 'same title', repoName: 'alpha' }), 'dedupe: case and spacing do not make a duplicate');

  if (!process.env.AI_TEST_DATABASE_URL) { console.log('ℹ️  database tests skipped (set AI_TEST_DATABASE_URL to run them)'); console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0); }
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
  const store = require('./server/services/appIntelligence/store.cjs');
  await store.initSchema(pool); await store.initSchema(pool);
  await pool.query('DELETE FROM ai_portfolio_items');
  const mk = (v) => pf.createItem(pool, pf.validateItem(v, { now: NOW }).value);

  const a = await mk({ type: 'risk', title: 'Fallback credential in the extractor', body: 'A default value is used when none is configured.', repoName: 'extractor', level: 'high', evidenceLevel: 'verified', evidence: 'code review', evidenceCheckedAt: '2026-11-20' });
  const b = await mk({ type: 'decision', title: 'Use Postgres queue instead of Redis', body: 'Fewer services to run.', repoName: 'studio', status: 'decided' });
  const c = await mk({ type: 'idea', title: 'Searchable archive of AI conversations', body: 'Future initiative.', level: null });
  const e = await mk({ type: 'opportunity', title: 'Content platform for authors', repoName: 'studio', level: 'low' });
  await mk({ type: 'risk', title: 'Spending caps not confirmed', level: 'medium', repoName: 'all' });
  assert((await pf.getItem(pool, a.id)).evidenceCheckedAt === '2026-11-20' && a.level === 'high' && a.source === 'owner', 'database: an item round-trips, including the date checked');
  assert((await pf.listItems(pool, {})).map((x) => x.level).slice(0, 2).join() === 'high,medium', 'list: risks come out High first');
  assert((await pf.listItems(pool, { types: ['risk'] })).length === 2 && (await pf.listItems(pool, { types: ['opportunity', 'idea'] })).length === 2 && (await pf.listItems(pool, { status: 'decided' })).length === 1, 'filter: by type (one or several) and status');
  assert((await pf.listItems(pool, { repo: 'STUDIO' })).length === 2, 'filter: by repository name, case-insensitive');
  assert((await pf.listItems(pool, { q: 'redis' }))[0].id === b.id, 'search: finds a word in the title');
  assert((await pf.listItems(pool, { q: 'defaults' }))[0].id === a.id, 'search: full-text stemming finds "default" when you type "defaults"');
  assert((await pf.listItems(pool, { q: 'fallb' }))[0].id === a.id, 'search: a partial word still matches');
  assert((await pf.listItems(pool, { q: 'authors platform' }))[0].id === e.id, 'search: several words match across the record');
  assert((await pf.listItems(pool, { q: 'extractor' }))[0].id === a.id, 'search: matches the repository name');
  assert((await pf.listItems(pool, { q: 'zzzz-no-match' })).length === 0 && (await pf.listItems(pool, { q: '100%_' })).length === 0, 'search: no match gives nothing; % and _ are not wildcards');
  assert((await pf.listItems(pool, { q: "'; DROP TABLE ai_portfolio_items; --" })).length === 0 && (await pf.totalRows(pool)) === 5, 'search: hostile text is only ever data');
  const counts = await pf.countByType(pool);
  assert(counts.risk === 2 && counts.decision === 1 && counts.idea === 1 && counts.opportunity === 1 && counts.requirement === 0, 'counts: per type');
  const upd = await pf.updateItem(pool, c.id, { status: 'dropped', title: 'Changed title' });
  assert(upd.status === 'dropped' && upd.title === 'Changed title' && upd.type === 'idea' && (await pf.listItems(pool, { q: 'changed' }))[0].id === c.id, 'update: changes only the supplied fields, and search follows the edit');
  assert(await pf.deleteItem(pool, c.id) && !(await pf.deleteItem(pool, c.id)) && (await pf.updateItem(pool, 'pf-nope', { title: 'x' })) === null, 'delete and update: real, idempotent, and a missing id returns nothing');

  // ── import ──
  await pool.query('DELETE FROM ai_portfolio_items');
  const batch = [
    { type: 'decision', title: 'Imported decision', repoName: 'alpha', status: 'decided', evidence: 'doc', evidenceLevel: 'inferred' },
    { type: 'risk', title: 'Imported risk', level: 'high' },
    { type: 'risk', title: 'Bad claim', evidenceLevel: 'verified' },
    { type: 'nonsense', title: 'Bad type' },
    { type: 'idea', title: 'Has a secret', body: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0' },
    'not an object',
  ];
  const dry = await pf.importItems(pool, batch, { dryRun: true, now: NOW });
  assert(dry.added.length === 2 && dry.invalid.length === 4 && (await pf.totalRows(pool)) === 0, 'import: a preview reports what would happen and writes nothing');
  assert(dry.invalid.find((x) => x.index === 2).errors[0].includes('"Verified" needs evidence') && !JSON.stringify(dry).includes('A1b2C3d4E5f6'), 'import: invalid records say why, and a secret is never echoed');
  const real = await pf.importItems(pool, batch, { now: NOW });
  const rows = await pf.listItems(pool, {});
  assert(real.added.length === 2 && rows.length === 2 && rows.every((r) => r.source === 'import'), 'import: valid records are stored and marked as imported');
  const again = await pf.importItems(pool, batch, { now: NOW });
  assert(again.added.length === 0 && again.skipped.length === 2 && (await pf.totalRows(pool)) === 2, 'import: running it again skips duplicates and never overwrites');
  await mk({ type: 'idea', title: 'Typed by hand', repoName: '' });
  const dupManual = await pf.importItems(pool, [{ type: 'idea', title: '  typed BY hand ' }], { now: NOW });
  assert(dupManual.skipped.length === 1, 'import: a duplicate of a record you typed by hand is skipped too');
  assert((await pf.importItems(pool, [], { now: NOW })).error && (await pf.importItems(pool, Array.from({ length: 101 }, () => ({ type: 'idea', title: 'x' })), { now: NOW })).error, 'import: an empty list or more than 100 records is refused');

  await pool.query('DELETE FROM ai_portfolio_items'); await pool.end();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
