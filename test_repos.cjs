// test_repos.cjs
// Command Center step 1: repository store. Offline checks (validation, activity, classification rules) plus a
// Postgres round trip when AI_TEST_DATABASE_URL is set. Dummy values only. Run: node test_repos.cjs
const repos = require('./server/services/appIntelligence/repos.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = Date.UTC(2026, 10, 21, 12, 0, 0); // 2026-11-21
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

(async () => {
  // ── activity is about pushes only ──
  assert(repos.repoActivity({ pushedAt: daysAgo(3) }, NOW).state === 'active', 'activity: push 3 days ago is active');
  assert(repos.repoActivity({ pushedAt: daysAgo(30) }, NOW).state === 'recent', 'activity: push 30 days ago is recent');
  assert(repos.repoActivity({ pushedAt: daysAgo(90) }, NOW).state === 'dormant', 'activity: push 90 days ago is dormant');
  assert(repos.repoActivity({ pushedAt: daysAgo(1), archived: true }, NOW).state === 'archived', 'activity: archived wins over a recent push');
  assert(repos.repoActivity({ pushedAt: null }, NOW).state === 'unknown', 'activity: no push date stays unknown, not dormant');

  // ── suggestion is never treated as confirmed ──
  assert(JSON.stringify(repos.effectiveKind({ kind: null, suggestedKind: 'application' })) === '{"kind":"application","confirmed":false}', 'type: a suggestion is flagged unconfirmed');
  assert(repos.effectiveKind({ kind: 'tool', suggestedKind: 'application' }).confirmed === true && repos.effectiveKind({ kind: 'tool', suggestedKind: 'application' }).kind === 'tool', 'type: the owner choice wins over the suggestion');
  assert(repos.effectiveKind({ kind: null, suggestedKind: null }).kind === null, 'type: nothing known stays null');
  assert(!repos.isHealthCheckable({ kind: null, suggestedKind: 'application' }), 'health: a suggested application is NOT health-checked');
  assert(repos.isHealthCheckable({ kind: 'application' }) && repos.isHealthCheckable({ kind: 'service' }) && !repos.isHealthCheckable({ kind: 'tool' }), 'health: only confirmed applications and services');

  // ── owner patch validation ──
  const ok = repos.validateRepoPatch({ kind: 'application', priority: 'invest', purpose: 'Media tool', liveUrl: 'https://app.example.com/', appId: 'app-1' });
  assert(!ok.errors.length && ok.value.kind === 'application' && ok.value.priority === 'invest' && ok.value.appId === 'app-1', 'patch: valid owner fields accepted');
  assert(repos.validateRepoPatch({ kind: 'bogus' }).errors.length === 1, 'patch: unknown type rejected');
  assert(repos.validateRepoPatch({ priority: 'maybe' }).errors.length === 1, 'patch: unknown priority rejected');
  assert(repos.validateRepoPatch({ priority: null }).value.priority === null && repos.validateRepoPatch({ kind: '' }).value.kind === null, 'patch: priority and type can be cleared');
  assert(repos.validateRepoPatch({ liveUrl: 'http://x.example.com' }).errors.length === 1, 'patch: live URL must be https');
  assert(repos.validateRepoPatch({ liveUrl: 'https://u:pw@x.example.com' }).errors.length === 1 && repos.validateRepoPatch({ liveUrl: 'https://x.example.com/?token=abc' }).errors.length === 1, 'patch: live URL rejects credentials and query strings');
  assert(repos.validateRepoPatch({ purpose: 'key sk_' + 'a1b2c3d4e5f6a7b8c9d0' }).errors.length === 1, 'patch: secret-shaped text rejected');
  const sneaky = repos.validateRepoPatch({ pushedAt: '2020-01-01', suggestedKind: 'tool', fullName: 'x/y', priority: 'hold' });
  assert(!sneaky.errors.length && Object.keys(sneaky.value).join() === 'priority', 'patch: sync-owned fields are ignored, never writable by the owner');
  assert(repos.validateRepoPatch({}).errors.length === 1 && repos.validateRepoPatch(null).errors.length === 1, 'patch: empty or non-object body rejected');

  // ── Postgres round trip ──
  if (process.env.AI_TEST_DATABASE_URL) {
    const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
    const store = require('./server/services/appIntelligence/store.cjs');
    await store.initSchema(pool); await store.initSchema(pool);
    assert(true, 'database: schema setup is idempotent (run twice)');
    await pool.query('DELETE FROM ai_repos');
    const gh = { githubId: 111, fullName: 'org/alpha', name: 'alpha', htmlUrl: 'https://github.com/org/alpha', visibility: 'private', archived: false, defaultBranch: 'main', description: 'Alpha app', language: 'JavaScript', pushedAt: daysAgo(2), openPrs: 1 };
    const a = await repos.upsertSynced(pool, gh, { suggestedKind: 'application', kindEvidence: 'frontend + railway.json', suggestedPurpose: 'Alpha app', stack: ['React', 'Express'], deployPlatform: 'Railway', deployState: 'configured', deployEvidence: 'railway.json' }, new Date(NOW));
    assert(a.suggestedKind === 'application' && a.kind === null && a.stack.join() === 'React,Express' && a.deployState === 'configured' && a.scanPushedAt === a.pushedAt, 'database: scan saved as a suggestion; confirmed type stays empty; scanned push remembered');
    await repos.updateOwner(pool, a.id, { kind: 'service', priority: 'invest', purpose: 'Mine', liveUrl: 'https://alpha.example.com/', priorityNote: 'core' });
    const again = await repos.upsertSynced(pool, { ...gh, fullName: 'org/alpha-renamed', name: 'alpha-renamed', pushedAt: daysAgo(1), description: 'New text' }, { suggestedKind: 'tool', stack: [] }, new Date(NOW));
    assert(again.id === a.id && (await repos.listRepos(pool)).length === 1, 'database: a rename updates the same row (matched on the GitHub id)');
    assert(again.kind === 'service' && again.priority === 'invest' && again.purpose === 'Mine' && again.liveUrl === 'https://alpha.example.com/' && again.priorityNote === 'core', 'database: a re-sync never overwrites owner decisions');
    assert(again.fullName === 'org/alpha-renamed' && again.suggestedKind === 'tool' && again.ghDescription === 'New text', 'database: a re-sync refreshes sync-owned fields');
    const noScan = await repos.upsertSynced(pool, { ...gh, openPrs: undefined }, null, new Date(NOW));
    assert(noScan.suggestedKind === 'tool' && noScan.openPrs === 1, 'database: sync without a scan keeps the earlier suggestion and PR count');
    const leaky = await repos.upsertSynced(pool, { ...gh, githubId: 222, fullName: 'org/beta', name: 'beta', description: 'token ghp_' + 'A1b2C3d4E5f6G7h8I9j0' }, null, new Date(NOW));
    assert(leaky.ghDescription === '', 'database: GitHub text that looks like a secret is dropped, not stored');
    const bad = await repos.saveScan(pool, a.id, { suggestedKind: 'wizard', deployState: 'magic', stack: ['x'] }, new Date(NOW));
    assert(bad.suggestedKind === null && bad.deployState === 'unknown', 'database: unknown scan values fall back to null / unknown');
    // link to a monitored application, then delete it: the repo survives with the link cleared
    const app = await store.createApplication(pool, { name: 'Link test', url: 'https://link-test.example.com', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, mode: 'manual', description: '' });
    await repos.updateOwner(pool, a.id, { appId: app.id });
    assert((await repos.getRepo(pool, a.id)).appId === app.id, 'database: repo can be linked to a monitored application');
    await store.deleteApplication(pool, app.id);
    assert((await repos.getRepo(pool, a.id)).appId === null, 'database: deleting the application clears the link, keeps the repo');
    assert((await repos.updateOwner(pool, 'repo-nope', { purpose: 'x' })) === null, 'database: updating a missing repo returns null');
    await pool.query('DELETE FROM ai_repos'); await pool.end();
  } else console.log('ℹ️  database round trip skipped (set AI_TEST_DATABASE_URL to run it)');

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
