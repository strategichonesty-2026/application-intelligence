// test_command_center_api.cjs
// Command Center step 3a: repository API. Real routes and a scratch Postgres (AI_TEST_DATABASE_URL); GitHub is a fake,
// so there are zero real network calls. Dummy values only. Run: node test_command_center_api.cjs
if (!process.env.AI_TEST_DATABASE_URL) { console.log('SKIPPED: set AI_TEST_DATABASE_URL to a scratch database to run the Command Center API tests.'); process.exit(0); }
const express = require('express');
const { Pool } = require('pg');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const store = require('./server/services/appIntelligence/store.cjs');
const repos = require('./server/services/appIntelligence/repos.cjs');
const gh = require('./server/services/appIntelligence/github.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const TOKEN = 'github_pat_DUMMY1111111111111111111111';
const NOW = new Date(Date.UTC(2026, 10, 21, 12));

(async () => {
  const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
  await store.initSchema(pool);
  await pool.query('DELETE FROM ai_repos'); await pool.query('DELETE FROM ai_applications'); await pool.query('DELETE FROM ai_portfolio_items'); await pool.query('DELETE FROM ai_oss_projects'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')");

  const env = { ...process.env };
  env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuth.hashPassword('dummy command center passphrase');
  env.APP_INTELLIGENCE_SESSION_SECRET = 'command-center-secret-'.padEnd(48, 'c');
  env.API_SECRET_KEY = 'dummy_server_key_for_command_center_0123456789';
  const other = ownerAuth.createOwnerAuth({ audience: 'some-other-app', typ: 'OTH', passwordHashVar: 'OTHER_HASH', secretVar: 'OTHER_SECRET', versionVar: 'OTHER_VERSION' });
  env.OTHER_SECRET = 'other-app-secret-'.padEnd(48, 'o');
  const owner = ownerAuth.issueToken(env).token; const studio = other.issueToken(env).token;

  // fake GitHub: one repository, nothing else needed
  let mode = 'ok';
  const fake = async (url) => {
    const u = new URL(url);
    if (mode === 'bad_token') return new Response('{}', { status: 401 });
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { etag: '"x1"' } });
    if (u.pathname === '/user/repos') return json([{ id: 501, name: 'synced', full_name: 'acme-test/synced', html_url: 'https://github.com/acme-test/synced', private: true, archived: false, default_branch: 'main', description: 'd', language: 'JavaScript', pushed_at: '2026-11-20T00:00:00Z', owner: { login: 'acme-test' } }]);
    if (/git\/trees/.test(u.pathname)) return json({ tree: [{ path: 'job.py', type: 'blob' }] });
    if (/\/contents\//.test(u.pathname)) return new Response('', { status: 200 });
    return json([]);
  };
  const noTokenEnv = { ...env }; delete noTokenEnv.GITHUB_TOKEN;
  const build = (e) => { const web = express(); web.use(express.json()); web.use('/ai', require('./server/routes/appIntelligence.cjs')(pool, { env: e, failDelayMs: 0, githubClientFactory: () => gh.createClient({ token: TOKEN, fetchImpl: fake }) })); return web; };
  const listen = (web) => new Promise((r) => { const s = web.listen(0, '127.0.0.1', () => r(s)); });
  const srv = await listen(build({ ...env, GITHUB_TOKEN: TOKEN, GITHUB_OWNER: 'acme-test' }));
  const srvNoToken = await listen(build(noTokenEnv));
  const url = (s) => `http://127.0.0.1:${s.address().port}/ai`;
  const call = (s, m, p, body, headers = { authorization: `Bearer ${owner}` }) => fetch(url(s) + p, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

  // ── authorization ──
  const endpoints = [['GET', '/repos'], ['GET', '/repos/repo-1'], ['PATCH', '/repos/repo-1', { priority: 'hold' }], ['POST', '/sync'], ['GET', '/sync/status'], ['GET', '/attention'], ['GET', '/portfolio'], ['POST', '/portfolio', { type: 'idea', title: 'x' }], ['PATCH', '/portfolio/pf-1', { title: 'y' }], ['DELETE', '/portfolio/pf-1'], ['GET', '/oss'], ['POST', '/oss', { name: 'x' }], ['PATCH', '/oss/oss-1', { name: 'y' }], ['DELETE', '/oss/oss-1'], ['POST', '/portfolio/import', { items: [{ type: 'idea', title: 'x' }], dryRun: false }]];
  let leaked = 0;
  for (const h of [{}, { 'x-api-key': env.API_SECRET_KEY }, { authorization: `Bearer ${studio}` }, { authorization: 'Bearer ' + 'a'.repeat(40) }]) for (const [m, p, b] of endpoints) { if ((await call(srv, m, p, b, h)).status !== 401) leaked++; }
  assert(leaked === 0 && (await repos.listRepos(pool)).length === 0, `authorization: all ${endpoints.length} endpoints answer 401 to anonymous callers, the shared API key and another application's session; nothing was written`);

  assert((await pool.query('SELECT count(*)::int n FROM ai_portfolio_items')).rows[0].n === 0, 'authorization: nothing was written to the portfolio either');

  // ── list: three signals kept apart ──
  const mk = async (id, name, extra = {}, scan = null) => repos.upsertSynced(pool, { githubId: id, fullName: `acme-test/${name}`, name, htmlUrl: `https://github.com/acme-test/${name}`, visibility: 'private', archived: false, defaultBranch: 'main', description: '', language: 'JavaScript', pushedAt: new Date(NOW - 3 * 86400000).toISOString(), openPrs: 0, ...extra }, scan, NOW);
  const app1 = await mk(1, 'media', {}, { suggestedKind: 'application', kindEvidence: 'frontend + railway.json', suggestedPurpose: 'Makes media', stack: ['React'], deployPlatform: 'Railway', deployState: 'configured', deployEvidence: 'railway.json' });
  const tool1 = await mk(2, 'script', { pushedAt: new Date(NOW - 90 * 86400000).toISOString() }, { suggestedKind: 'tool', kindEvidence: 'code only', stack: [], deployState: 'none' });
  let r = await call(srv, 'GET', '/repos');
  const a = r.body.repositories.find((x) => x.name === 'media'); const t = r.body.repositories.find((x) => x.name === 'script');
  assert(r.status === 200 && r.body.repositories.length === 2 && r.body.counts.needType === 2, 'list: returns repositories and counts the ones that still need a confirmed type');
  assert(a.type.value === 'application' && a.type.confirmed === false && a.type.evidence && a.activity.state === 'active' && a.deployment.state === 'configured' && a.health.state === 'not_checked', 'list: activity, deployment and health are three separate answers; a suggested type is flagged unconfirmed and is not health-checked');
  assert(a.activity.source === 'GitHub' && a.deployment.source && a.health.source === 'Health checker' && a.activity.readAt, 'list: every signal names its source, and activity shows when it was read');
  assert(t.activity.state === 'dormant', 'list: a 90-day-old push is dormant (activity only)');

  // ── owner decisions ──
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { kind: 'application', priority: 'invest', priorityNote: 'core product', purpose: 'My words', liveUrl: 'https://media.example.com/' });
  assert(r.status === 200 && r.body.repository.type.confirmed === true && r.body.repository.priority === 'invest' && r.body.repository.purpose.owner === true && r.body.repository.purpose.value === 'My words', 'patch: owner confirms the type, sets priority, purpose and live URL');
  r = await call(srv, 'PATCH', `/repos/${tool1.id}`, { kind: 'tool' });
  assert(r.body.repository.health.state === 'not_applicable', 'patch: a confirmed tool is "not applicable" for health, not "unhealthy"');
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { priority: 'maybe' }); assert(r.status === 400 && (await repos.getRepo(pool, app1.id)).priority === 'invest', 'patch: an invalid priority is refused and changes nothing');
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { pushedAt: '2000-01-01', suggestedKind: 'content', fullName: 'x/y' }); assert(r.status === 400 && (await repos.getRepo(pool, app1.id)).fullName === 'acme-test/media', 'patch: sync-owned fields cannot be written by the owner');
  const secret = 'sk_' + 'a1b2c3d4e5f6a7b8c9d0e1f2';
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { purpose: `key ${secret}` }); assert(r.status === 400 && !JSON.stringify(r.body).includes(secret), 'patch: a secret-looking value is refused and never echoed');
  r = await call(srv, 'PATCH', '/repos/repo-nope', { priority: 'hold' }); assert(r.status === 404, 'patch: an unknown repository answers 404');
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { appId: 'app-does-not-exist' }); assert(r.status === 400, 'patch: linking to a monitored application that does not exist is refused');
  const monitored = await store.createApplication(pool, { name: 'Media (live)', url: 'https://media.example.com', environment: 'production', checkType: 'homepage', checkPath: '', expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, mode: 'manual', description: '' });
  r = await call(srv, 'PATCH', `/repos/${app1.id}`, { appId: monitored.id });
  assert(r.status === 200 && r.body.repository.health.state !== 'not_checked' && r.body.repository.health.note !== undefined && r.body.repository.appId === monitored.id, 'patch: linking a monitored application brings in its REAL health status from the existing checker');
  r = await call(srv, 'GET', `/repos/${app1.id}`); assert(r.status === 200 && r.body.repository.name === 'media', 'detail: one repository by id');
  r = await call(srv, 'GET', '/repos/repo-nope'); assert(r.status === 404, 'detail: unknown id answers 404');

  // ── sync ──
  r = await call(srvNoToken, 'POST', '/sync'); assert(r.status === 503 && r.body.code === 'github_not_configured', 'sync: without a server token it says so plainly and calls nothing');
  r = await call(srvNoToken, 'GET', '/sync/status'); assert(r.status === 200 && r.body.configured === false, 'status: reports "not configured" without a token');
  r = await call(srv, 'POST', '/sync');
  assert(r.status === 200 && r.body.success && r.body.sync.found === 1 && r.body.sync.scanned === 1, 'sync: the manual button pulls from GitHub and reports what it found');
  const synced = (await repos.listRepos(pool)).find((x) => x.name === 'synced');
  assert(synced && synced.suggestedKind === 'tool' && synced.kind === null, 'sync: new repositories arrive as suggestions, never confirmed');
  assert((await repos.getRepo(pool, app1.id)).priority === 'invest', 'sync: existing owner decisions are untouched');
  mode = 'bad_token'; await pool.query("DELETE FROM ai_service_state WHERE key = 'github_list_etags'");
  r = await call(srv, 'POST', '/sync'); assert(r.status === 502 && r.body.sync.code === 'unauthorized' && (await repos.listRepos(pool)).length === 3, 'sync: a rejected token answers 502 with a plain reason and keeps every earlier row');
  mode = 'ok';
  r = await call(srv, 'GET', '/sync/status'); assert(r.status === 200 && r.body.configured === true && r.body.owner === 'acme-test' && r.body.last && r.body.last.code === 'unauthorized', 'status: shows the last sync result, including a failure');

  // ── portfolio ──
  r = await call(srv, 'POST', '/portfolio', { type: 'risk', title: 'Fallback credential', body: 'Details here', repoName: 'media', level: 'high', evidenceLevel: 'verified', evidence: 'code review', evidenceCheckedAt: '2026-11-20' });
  const pid = r.body.item && r.body.item.id;
  assert(r.status === 201 && pid && r.body.item.level === 'high', 'portfolio: create a risk with its evidence and date');
  r = await call(srv, 'POST', '/portfolio', { type: 'risk', title: 'Bad claim', evidenceLevel: 'verified' }); assert(r.status === 400 && /needs evidence/.test(r.body.error), 'portfolio: "verified" without evidence and a date is refused');
  const leakVal = 'sk_' + 'a1b2c3d4e5f6a7b8c9d0e1f2';
  r = await call(srv, 'POST', '/portfolio', { type: 'idea', title: 'x', body: leakVal }); assert(r.status === 400 && !JSON.stringify(r.body).includes(leakVal), 'portfolio: a secret-looking value is refused and not echoed');
  await call(srv, 'POST', '/portfolio', { type: 'decision', title: 'Use a Postgres queue', status: 'decided', repoName: 'media' });
  r = await call(srv, 'GET', '/portfolio?q=queue'); assert(r.status === 200 && r.body.items.length === 1 && r.body.items[0].title === 'Use a Postgres queue' && r.body.counts.risk === 1 && r.body.counts.decision === 1, 'portfolio: search finds the decision; counts per type are returned');
  r = await call(srv, 'GET', '/portfolio?type=risk,decision&status=decided'); assert(r.body.items.length === 1, 'portfolio: filters by type list and status');
  r = await call(srv, 'GET', '/portfolio?type=bogus'); assert(r.status === 200 && r.body.items.length === 2, 'portfolio: an unknown type filter is ignored, not an error');
  r = await call(srv, 'PATCH', `/portfolio/${pid}`, { evidenceCheckedAt: null }); assert(r.status === 400 && /needs evidence/.test(r.body.error), 'portfolio: removing the date from a verified item is refused');
  r = await call(srv, 'PATCH', `/portfolio/${pid}`, { evidenceLevel: 'inferred', status: 'done' }); assert(r.status === 200 && r.body.item.status === 'done' && r.body.item.title === 'Fallback credential', 'portfolio: a partial edit changes only what was sent');
  r = await call(srv, 'PATCH', '/portfolio/pf-nope', { title: 'x' }); assert(r.status === 404, 'portfolio: editing an unknown item answers 404');
  r = await call(srv, 'POST', '/portfolio/import', { items: [{ type: 'idea', title: 'Imported idea' }, { type: 'bogus', title: 'bad' }] });
  assert(r.status === 200 && r.body.dryRun === true && r.body.added.length === 1 && r.body.invalid.length === 1 && (await call(srv, 'GET', '/portfolio')).body.items.length === 2, 'portfolio: import is a PREVIEW by default and writes nothing');
  r = await call(srv, 'POST', '/portfolio/import', { items: [{ type: 'idea', title: 'Imported idea' }], dryRun: false }); assert(r.status === 200 && r.body.dryRun === false && r.body.added.length === 1 && (await call(srv, 'GET', '/portfolio')).body.items.length === 3, 'portfolio: import stores the valid records only when dryRun is explicitly false');
  r = await call(srv, 'POST', '/portfolio/import', { items: [] }); assert(r.status === 400, 'portfolio: an empty import is refused');
  // ── open-source library ──
  r = await call(srv, 'POST', '/oss', { name: 'Example Queue', url: 'https://example.com/q', gap: 'Jobs', repoName: 'media' }); const oid = r.body.project && r.body.project.id;
  assert(r.status === 201 && oid && r.body.project.verified === false && r.body.project.licenseClass === 'unknown', 'oss: a new entry starts unverified with an unknown licence');
  r = await call(srv, 'POST', '/oss', { name: 'example queue', repoName: 'MEDIA' }); assert(r.status === 409, 'oss: the same project for the same repository answers 409');
  r = await call(srv, 'POST', '/oss', { name: 'Bad', url: 'javascript:alert(1)' }); assert(r.status === 400, 'oss: a non-web link is refused');
  r = await call(srv, 'POST', '/oss', { name: 'Half', verifiedSource: 'page' }); assert(r.status === 400 && /both/.test(r.body.error), 'oss: a source without a date is refused');
  r = await call(srv, 'PATCH', `/oss/${oid}`, { decision: 'adopt' }); assert(r.status === 400 && /adopt/.test(r.body.error), 'oss: "adopt" is refused until the facts are checked');
  r = await call(srv, 'PATCH', `/oss/${oid}`, { decision: 'adopt', licenseClass: 'permissive', license: 'MIT', verifiedSource: 'repo page', verifiedAt: '2026-11-20' }); assert(r.status === 200 && r.body.project.verified === true && r.body.project.decision === 'adopt', 'oss: with licence, source and date the entry can be adopted');
  r = await call(srv, 'GET', '/oss?q=jobs'); assert(r.status === 200 && r.body.projects.length === 1 && r.body.options.decisions.includes('watch'), 'oss: search works and the allowed options are returned');
  r = await call(srv, 'PATCH', '/oss/oss-nope', { name: 'x' }); assert(r.status === 404, 'oss: editing an unknown entry answers 404');
  r = await call(srv, 'DELETE', `/oss/${oid}`); assert(r.status === 200 && (await call(srv, 'DELETE', `/oss/${oid}`)).status === 404, 'oss: delete is real and a second delete answers 404');
  r = await call(srv, 'DELETE', `/portfolio/${pid}`); assert(r.status === 200 && (await call(srv, 'DELETE', `/portfolio/${pid}`)).status === 404, 'portfolio: delete is real and a second delete answers 404');

  // ── attention ──
  r = await call(srv, 'GET', '/attention');
  const needs = r.body.items.find((i) => i.id === 'repos:need-type');
  assert(r.status === 200 && r.body.success && Array.isArray(r.body.items) && r.body.numbers.repositories === 3, 'attention: returns items and the at-a-glance numbers');
  assert(needs && /1 repository needs a confirmed type/.test(needs.title) && needs.evidence && needs.href, 'attention: the repository that still needs a type is listed, with evidence and a link');
  assert(r.body.items.every((i) => i.level && i.label && i.title && i.evidence && i.action && i.href), 'attention: every item carries a level, evidence and an action');
  await pool.query("INSERT INTO ai_credentials (id, name, status, verification) VALUES ('cred-att', 'Dummy provider key', 'exposed', 'inferred') ON CONFLICT (id) DO NOTHING");
  r = await call(srv, 'GET', '/attention');
  const cred = r.body.items.find((i) => i.id === 'cred:cred-att');
  assert(cred && cred.level === 'high' && /inferred, not verified/.test(cred.evidence) && r.body.items[0].level === 'high', 'attention: an exposed credential from the register is High, honest about being unverified, and listed first');
  await pool.query("DELETE FROM ai_credentials WHERE id = 'cred-att'");

  // ── nothing ever leaks the token ──
  const bodies = JSON.stringify([(await call(srv, 'GET', '/repos')).body, (await call(srv, 'GET', '/sync/status')).body, (await call(srv, 'GET', '/attention')).body, (await call(srv, 'POST', '/sync')).body]);
  assert(!bodies.includes(TOKEN) && !bodies.includes('github_pat_'), 'security: the GitHub token never appears in any response');

  await pool.query('DELETE FROM ai_repos'); await pool.query('DELETE FROM ai_applications'); await pool.query('DELETE FROM ai_portfolio_items'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')");
  srv.close(); srvNoToken.close(); await pool.end();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
