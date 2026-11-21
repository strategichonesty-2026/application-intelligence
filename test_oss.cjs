// test_oss.cjs
// Command Center step 6: the Open-source Library. Validation and honesty rules run offline; storage needs
// AI_TEST_DATABASE_URL. Dummy values only. Run: node test_oss.cjs
const oss = require('./server/services/appIntelligence/oss.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = Date.UTC(2026, 10, 21);

(async () => {
  const ok = oss.validateProject({ name: 'Example Queue', url: 'https://example.com/queue', gap: 'Background jobs', repoName: 'alpha', license: 'MIT', licenseClass: 'permissive', maintenance: 'active', lastRelease: '2026-10-01', effort: 'low' }, { now: NOW });
  assert(!ok.errors.length && ok.value.name === 'Example Queue' && ok.value.licenseClass === 'permissive', 'validate: a complete entry is accepted');
  assert(oss.validateProject({}).errors.length === 1 && oss.validateProject({ name: '  ' }).errors.length === 1, 'validate: a name is required');
  assert(oss.validateProject({ name: 'x', url: 'javascript:alert(1)' }).errors.length === 1 && oss.validateProject({ name: 'x', url: 'not a url' }).errors.length === 1 && oss.validateProject({ name: 'x', url: 'https://ok.example' }).errors.length === 0, 'validate: only http(s) links are accepted, so a stored link cannot run code');
  assert(oss.validateProject({ name: 'x', licenseClass: 'free' }).errors.length === 1 && oss.validateProject({ name: 'x', maintenance: 'dead' }).errors.length === 1 && oss.validateProject({ name: 'x', effort: 'huge' }).errors.length === 1 && oss.validateProject({ name: 'x', decision: 'maybe' }).errors.length === 1, 'validate: licence class, maintenance, effort and decision must be known values');
  assert(oss.validateProject({ name: 'x', lastRelease: '2027-01-01' }, { now: NOW }).errors.length === 1 && oss.validateProject({ name: 'x', verifiedAt: 'soon' }, { now: NOW }).errors.length === 1, 'validate: dates cannot be in the future or malformed');
  const leak = oss.validateProject({ name: 'Key', securityNote: 'sk_' + 'a1b2c3d4e5f6a7b8c9d0e1f2' });
  assert(leak.errors.length === 1 && !JSON.stringify(leak).includes('a1b2c3d4e5f6'), 'validate: a secret-looking value is refused and never echoed');
  assert(oss.checkClaims({ verifiedSource: 'https://example.com', verifiedAt: null }).length === 1 && oss.checkClaims({ verifiedSource: '', verifiedAt: '2026-11-20' }).length === 1 && oss.checkClaims({ verifiedSource: 'repo page', verifiedAt: '2026-11-20' }).length === 0 && oss.checkClaims({ decision: 'to_evaluate' }).length === 0, 'honesty: source and date come as a pair, or neither');
  assert(oss.checkClaims({ decision: 'adopt', licenseClass: 'permissive' }).length === 1 && oss.checkClaims({ decision: 'adopt', licenseClass: 'permissive', verifiedSource: 'repo page', verifiedAt: '2026-11-20' }).length === 0, 'honesty: "adopt" needs checked facts');
  assert(oss.checkClaims({ decision: 'adopt', licenseClass: 'unknown', verifiedSource: 's', verifiedAt: '2026-11-20' }).length === 1 && oss.checkClaims({ decision: 'adopt', licenseClass: 'strong_copyleft', verifiedSource: 's', verifiedAt: '2026-11-20' }).length === 1, 'honesty: "adopt" is refused while the licence is unknown or strong copyleft');

  if (!process.env.AI_TEST_DATABASE_URL) { console.log('ℹ️  database tests skipped (set AI_TEST_DATABASE_URL to run them)'); console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0); }
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
  const store = require('./server/services/appIntelligence/store.cjs');
  await store.initSchema(pool); await store.initSchema(pool);
  await pool.query('DELETE FROM ai_oss_projects');
  const mk = (v) => oss.createProject(pool, oss.validateProject(v, { now: NOW }).value);

  const a = await mk({ name: 'Example Queue', gap: 'Background jobs for the scheduler', repoName: 'alpha', license: 'MIT', licenseClass: 'permissive', verifiedSource: 'repo page', verifiedAt: '2026-11-20' });
  const b = await mk({ name: 'Example Auth', gap: 'Sign-in', repoName: 'beta' });
  assert(a.verified === true && b.verified === false && b.licenseClass === 'unknown' && b.maintenance === 'unknown' && b.decision === 'to_evaluate' && b.lastRelease === null, 'database: new entries start as "unknown / to evaluate / not verified"; verified only with source and date');
  assert((await mk({ name: 'example queue', repoName: 'ALPHA' })) === null && (await oss.totalRows(pool)) === 2, 'duplicates: the same name for the same repository is not added twice');
  assert((await mk({ name: 'Example Queue', repoName: 'beta' })) !== null, 'duplicates: the same project may be listed for a different repository');
  assert((await oss.listProjects(pool, {})).map((x) => x.name).join() === 'Example Auth,Example Queue,Example Queue', 'list: sorted by name');
  assert((await oss.listProjects(pool, { q: 'scheduler' }))[0].id === a.id && (await oss.listProjects(pool, { q: 'mit' }))[0].id === a.id, 'search: finds words in the gap and the licence');
  assert((await oss.listProjects(pool, { repo: 'BETA' })).length === 2 && (await oss.listProjects(pool, { decision: 'adopt' })).length === 0, 'filter: by repository (case-insensitive) and decision');
  assert((await oss.listProjects(pool, { q: '100%_' })).length === 0 && (await oss.listProjects(pool, { q: "'; DROP TABLE ai_oss_projects; --" })).length === 0 && (await oss.totalRows(pool)) === 3, 'search: % and _ are not wildcards and hostile text is only data');
  const u = await oss.updateProject(pool, b.id, { maintenance: 'active', decision: 'watch' });
  assert(u.maintenance === 'active' && u.decision === 'watch' && u.name === 'Example Auth', 'update: changes only the supplied fields');
  assert((await oss.updateProject(pool, b.id, { name: 'Example Queue', repoName: 'alpha' })) === 'duplicate', 'update: renaming onto an existing entry is reported as a duplicate, not an error');
  assert((await oss.updateProject(pool, 'oss-nope', { name: 'x' })) === null && await oss.deleteProject(pool, a.id) && !(await oss.deleteProject(pool, a.id)), 'update and delete: a missing id returns nothing; delete is real and idempotent');
  await pool.query('DELETE FROM ai_oss_projects'); await pool.end();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.log(`❌ FAIL: unexpected error ${e.message}`); process.exit(1); });
