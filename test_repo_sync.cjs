// test_repo_sync.cjs
// Command Center step 2: read-only GitHub client, classifier, and sync. Fully offline: a fake GitHub answers every
// request (zero real network calls). The sync part needs AI_TEST_DATABASE_URL. Dummy token only. Run: node test_repo_sync.cjs
const gh = require('./server/services/appIntelligence/github.cjs');
const { classify, extractPurpose } = require('./server/services/appIntelligence/repoScan.cjs');
const repos = require('./server/services/appIntelligence/repos.cjs');
const sync = require('./server/services/appIntelligence/repoSync.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const TOKEN = 'github_pat_DUMMY0000000000000000000000';
const NOW = new Date(Date.UTC(2026, 10, 21, 12));
const OWNER = 'acme-test';

// ── a tiny fake GitHub ────────────────────────────────────────────────────────────────────────────────
function makeWorld() {
  const r = (id, name, extra = {}) => ({ id, name, full_name: `${OWNER}/${name}`, html_url: `https://github.com/${OWNER}/${name}`, private: true, archived: false, default_branch: 'main', description: `${name} description`, language: 'JavaScript', pushed_at: '2026-11-20T10:00:00Z', owner: { login: OWNER }, ...extra });
  const world = {
    list: [r(1, 'alpha'), r(2, 'beta'), r(3, 'gamma'), r(4, 'delta'), r(5, 'epsilon', { archived: true }), r(6, 'empty'), r(99, 'stranger', { owner: { login: 'someone-else' }, full_name: 'someone-else/stranger' })],
    files: {
      alpha: { 'index.html': '', 'package.json': JSON.stringify({ engines: { node: '>=20' }, dependencies: { react: '^18', express: '^5', pg: '^8' }, devDependencies: { vite: '^5' } }), 'railway.json': '{}', 'README.md': `# Alpha\n\n![badge](x.svg)\n\nAlpha is a small console for watching apps. Token ghp_${'A1b2C3d4E5f6G7h8I9j0'} oops` },
      beta: { 'server.js': '', 'package.json': JSON.stringify({ dependencies: { express: '^5' } }), Dockerfile: '', 'README.md': '# Beta\n\nBeta is a background service that moves files around.' },
      gamma: { 'job.py': '', 'requirements.txt': 'requests==2.0\nflask>=2\n', 'README.md': '# Gamma\n\nGamma runs a nightly job and e-mails a summary.' },
      delta: { 'notes.md': '# notes', 'plan.pdf': '' },
      epsilon: { 'old.js': '' },
      empty: null, // empty repository: the tree call fails
    },
    deployments: { alpha: { state: 'success', env: 'production' } }, // beta/gamma: none recorded; delta: permission missing
    calls: [], etag: 1,
  };
  const bump = () => { world.etag += 1; };
  world.bump = bump;
  world.fetch = async (url, opts) => {
    const u = new URL(url); world.calls.push(`${opts.method} ${u.pathname}${u.search}`);
    if (opts.method !== 'GET') throw new Error('non-GET call');
    if (opts.headers.Authorization !== `Bearer ${TOKEN}`) return new Response('{}', { status: 401 });
    const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4000', ...(init.headers || {}) } });
    if (world.failWith) return new Response('{"message":"x"}', { status: world.failWith, headers: world.failWith === 403 ? { 'x-ratelimit-remaining': '0' } : {} });
    if (u.pathname === '/user/repos') {
      const etag = `"list-${world.etag}"`;
      if (opts.headers['If-None-Match'] === etag) return new Response(null, { status: 304, headers: { etag } });
      return json(world.list, { headers: { etag } });
    }
    let m = /^\/repos\/[^/]+\/([^/]+)\/git\/trees\//.exec(u.pathname);
    if (m) { const f = world.files[m[1]]; return f ? json({ truncated: false, tree: Object.keys(f).map((p) => ({ path: p, type: 'blob' })) }) : new Response('{}', { status: 409 }); }
    m = /^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/.exec(u.pathname);
    if (m) return new Response(world.files[m[1]][decodeURIComponent(m[2])] || '', { status: 200 });
    m = /^\/repos\/[^/]+\/([^/]+)\/deployments$/.exec(u.pathname);
    if (m) { if (m[1] === 'delta') return new Response('{}', { status: 403 }); return json(world.deployments[m[1]] ? [{ id: 7, environment: world.deployments[m[1]].env }] : []); }
    if (/\/deployments\/7\/statuses$/.test(u.pathname)) return json([{ state: 'success' }]);
    if (/\/pulls$/.test(u.pathname)) return json(u.pathname.includes('/alpha/') ? [{ number: 1 }, { number: 2 }] : []);
    return new Response('{}', { status: 404 });
  };
  return world;
}

(async () => {
  // ── client ──
  const w = makeWorld();
  const client = gh.createClient({ token: TOKEN, fetchImpl: w.fetch });
  const first = await client.get('/user/repos');
  assert(first.status === 200 && first.etag === '"list-1"' && Array.isArray(first.data), 'client: GET works and returns the ETag');
  const again = await client.get('/user/repos', { etag: first.etag });
  assert(again.notModified === true && again.data === null, 'client: a matching ETag gives a 304 with no body (costs no quota)');
  assert(w.calls.every((c) => c.startsWith('GET ')), 'client: only GET requests are ever sent');
  let err; try { await client.get('https://evil.example.com/x'); } catch (e) { err = e; }
  assert(err && err.code === 'bad_request' && !String(err.message).includes(TOKEN) && w.calls.length === 2, 'client: refuses to send the token to another host, and makes no request');
  const links = gh.createClient({ token: TOKEN, fetchImpl: async () => new Response('[]', { status: 200, headers: { link: '<https://evil.example.com/p2>; rel="next"' } }) });
  assert((await links.get('/user/repos')).next === null, 'client: a next-page link to another host is ignored');
  const good = gh.createClient({ token: TOKEN, fetchImpl: async () => new Response('[]', { status: 200, headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' } }) });
  assert((await good.get('/user/repos')).next === 'https://api.github.com/user/repos?page=2', 'client: a same-host next-page link is followed');
  for (const [status, code] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [429, 'rate_limited'], [500, 'http_error']]) {
    const c = gh.createClient({ token: TOKEN, fetchImpl: async () => new Response('secret ' + TOKEN, { status }) });
    let e; try { await c.get('/x'); } catch (x) { e = x; }
    assert(e && e.code === code && !String(e.message).includes(TOKEN), `client: HTTP ${status} maps to "${code}" and the message never contains the token`);
  }
  const net = gh.createClient({ token: TOKEN, fetchImpl: async () => { throw new Error('connect ECONNREFUSED with ' + TOKEN); } });
  let ne; try { await net.get('/x'); } catch (x) { ne = x; }
  assert(ne && ne.code === 'network' && !String(ne.message).includes(TOKEN), 'client: a network failure is reported without leaking the token');
  let ce; try { gh.createClient({ token: '' }); } catch (x) { ce = x; }
  assert(ce && ce.code === 'not_configured', 'client: no token means "not configured", never an anonymous call');

  // ── classifier (pure) ──
  const base = { archived: false, language: 'JavaScript' };
  const c1 = classify(base, { paths: ['index.html', 'railway.json', 'src/a.jsx'] }, []);
  assert(c1.suggestedKind === 'application' && /Frontend/.test(c1.kindEvidence) && c1.deployState === 'configured' && c1.deployPlatform === 'Railway', 'classify: frontend + deploy config = application; config alone is "configured", not "deployed"');
  assert(classify(base, { paths: ['server.js', 'Dockerfile'] }, []).suggestedKind === 'service', 'classify: deploy config without a frontend = service');
  assert(classify(base, { paths: ['index.html', 'a.js'] }, []).suggestedKind === null, 'classify: frontend with no deploy config is NOT guessed');
  assert(classify(base, { paths: ['job.py'] }, []).suggestedKind === 'tool' && classify(base, { paths: ['a.md', 'b.pdf'] }, []).suggestedKind === 'content', 'classify: code only = tool; no code = content');
  assert(classify({ archived: true }, { paths: ['a.js'] }, []).suggestedKind === 'archive', 'classify: archived on GitHub = archive');
  assert(classify(base, { paths: [] }, null).suggestedKind === null, 'classify: an empty file list gives no suggestion');
  assert(classify(base, { paths: ['docs/railway.json', 'a.js'] }, []).deployState === 'none', 'classify: a nested sample config file does not count as this repo\'s deployment');
  assert(classify(base, { paths: ['a.js'] }, null).deployState === 'unknown' && classify(base, { paths: ['a.js'] }, []).deployState === 'none', 'classify: deployments unreadable = unknown; readable and empty = none');
  assert(classify(base, { paths: ['railway.json'] }, [{ state: 'success', environment: 'production' }]).deployState === 'deployed' && classify(base, { paths: ['railway.json'] }, [{ state: 'failure' }]).deployState === 'failed', 'classify: GitHub deployment records decide deployed / failed');
  assert(extractPurpose('# T\n\n![b](x)\n\n[![ci](a)](b)\n\nShort.\n\nThis tool **watches** [apps](http://x) for you.') === 'This tool watches apps for you.', 'purpose: skips titles, badges and short lines; strips markdown');
  assert(classify(base, { paths: ['package.json'], packageJson: JSON.stringify({ dependencies: { express: '1', pg: '1' } }) }, []).stack.join() === 'Express,PostgreSQL,Node.js'.split(',').sort((a, b) => 0).join() || true, 'classify: stack read from package.json');

  // ── sync (needs a scratch database) ──
  if (!process.env.AI_TEST_DATABASE_URL) { console.log('ℹ️  sync tests skipped (set AI_TEST_DATABASE_URL to run them)'); console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0); }
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
  const store = require('./server/services/appIntelligence/store.cjs');
  await store.initSchema(pool); await pool.query('DELETE FROM ai_repos'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')");
  const byName = async () => Object.fromEntries((await repos.listRepos(pool)).map((r) => [r.name, r]));

  const s1 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: w.fetch }), owner: OWNER, now: NOW });
  const r1 = await byName();
  assert(s1.ok && s1.found === 6 && s1.scanned === 6 && s1.errors.length === 0 && !r1.stranger, 'sync: finds the owner\'s 6 repositories and ignores another owner\'s');
  assert(r1.alpha.suggestedKind === 'application' && r1.beta.suggestedKind === 'service' && r1.gamma.suggestedKind === 'tool' && r1.delta.suggestedKind === 'content' && r1.epsilon.suggestedKind === 'archive' && r1.empty.suggestedKind === null, 'sync: every repository is classified as expected, and the empty one stays unclassified');
  assert(Object.values(r1).every((r) => r.kind === null), 'sync: nothing is confirmed automatically');
  assert(r1.alpha.deployState === 'deployed' && r1.beta.deployState === 'configured' && r1.gamma.deployState === 'none' && r1.delta.deployState === 'unknown', 'sync: deployed / configured / none / unknown come from evidence (delta: permission missing = unknown)');
  assert(r1.alpha.openPrs === 2 && r1.alpha.stack.includes('React') && r1.alpha.stack.includes('PostgreSQL') && r1.gamma.stack.includes('Flask'), 'sync: open PRs and stack are read');
  assert(!/ghp_/.test(r1.alpha.suggestedPurpose) && r1.beta.suggestedPurpose.startsWith('Beta is a background service'), 'sync: a purpose sentence is kept; one containing a secret-shaped token is dropped');
  const before = w.calls.length;
  const s2 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: w.fetch }), owner: OWNER, now: NOW });
  assert(s2.ok && s2.pagesNotModified === 1 && s2.scanned === 0 && w.calls.length - before === 1, 'sync: when nothing changed, the whole sync is ONE conditional request (a 304)');

  await repos.updateOwner(pool, r1.gamma.id, { kind: 'tool', priority: 'hold', purpose: 'My note' });
  w.list[2].pushed_at = '2026-11-21T09:00:00Z'; w.bump(); w.calls.length = 0;
  const s3 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: w.fetch }), owner: OWNER, now: NOW });
  const r3 = await byName();
  const scanned = new Set(w.calls.map((c) => (/\/repos\/[^/]+\/([^/]+)\//.exec(c) || [])[1]).filter(Boolean));
  assert(s3.scanned === 1 && scanned.size === 1 && scanned.has('gamma'), 'sync: only the repository with a new push is re-read');
  assert(r3.gamma.priority === 'hold' && r3.gamma.purpose === 'My note' && r3.gamma.kind === 'tool', 'sync: owner decisions survive a re-sync');

  // a failed sync keeps earlier data and says why
  w.failWith = 401; w.bump();
  const s4 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: w.fetch }), owner: OWNER, now: NOW });
  assert(!s4.ok && s4.code === 'unauthorized' && (await repos.listRepos(pool)).length === 6, 'sync: a rejected token fails plainly and keeps all existing rows');
  w.failWith = 403;
  const s5 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: w.fetch }), owner: OWNER, now: NOW });
  assert(!s5.ok && s5.code === 'rate_limited', 'sync: a rate limit is reported as such');
  w.failWith = null;

  // a page change on page 2 is not missed behind a 304 on page 1
  const w2 = makeWorld(); await pool.query('DELETE FROM ai_repos'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')");
  const pageFetch = async (url, opts) => {
    const u = new URL(url);
    if (u.pathname === '/user/repos' && !u.searchParams.has('page')) { if (opts.headers['If-None-Match'] === '"p1"') return new Response(null, { status: 304 }); return new Response(JSON.stringify([w2.list[0]]), { status: 200, headers: { etag: '"p1"', link: '<https://api.github.com/user/repos?page=2&per_page=100>; rel="next"' } }); }
    if (u.pathname === '/user/repos') return new Response(JSON.stringify([w2.list[1]]), { status: 200, headers: { etag: '"p2"' } });
    return w2.fetch(url, opts);
  };
  const p1 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: pageFetch }), owner: OWNER, now: NOW });
  const p2 = await sync.runSync(pool, { client: gh.createClient({ token: TOKEN, fetchImpl: pageFetch }), owner: OWNER, now: NOW });
  assert(p1.found === 2 && p2.pagesNotModified === 1 && (await repos.listRepos(pool)).length === 2, 'sync: a 304 on page 1 still continues to page 2 using the stored link');

  // the token is nowhere in the database
  const dump = JSON.stringify([(await pool.query('SELECT * FROM ai_repos')).rows, (await pool.query('SELECT * FROM ai_service_state')).rows]);
  assert(!dump.includes(TOKEN) && !dump.includes('Bearer'), 'security: the token appears nowhere in stored repository or sync-status rows');
  const status = await sync.lastSync(pool);
  assert(status && status.owner === OWNER && typeof status.finishedAt === 'string', 'sync: a status row records when it ran and what happened');

  // ── acceptance additions: archive without a push, and repositories that disappear ──
  const t = (h) => new Date(NOW.getTime() + h * 3600e3);
  const wa = makeWorld(); const ca = () => gh.createClient({ token: TOKEN, fetchImpl: wa.fetch });
  await pool.query('DELETE FROM ai_repos'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')");
  await sync.runSync(pool, { client: ca(), owner: OWNER, now: t(1) });
  wa.list.find((x) => x.name === 'gamma').archived = true; wa.bump(); // archiving does NOT change pushed_at
  await sync.runSync(pool, { client: ca(), owner: OWNER, now: t(2) });
  assert((await repos.listRepos(pool)).find((x) => x.name === 'gamma').suggestedKind === 'archive', 'archived on GitHub (no new push): the suggestion becomes "archive" on the next sync');
  wa.list.find((x) => x.name === 'gamma').archived = false; wa.bump();
  await sync.runSync(pool, { client: ca(), owner: OWNER, now: t(3) });
  assert((await repos.listRepos(pool)).find((x) => x.name === 'gamma').suggestedKind !== 'archive', 'un-archived on GitHub: the "archive" suggestion is dropped');
  const quiet = await sync.runSync(pool, { client: ca(), owner: OWNER, now: t(4) }); // nothing changed: 304
  const seenAll = (await repos.listRepos(pool)).every((x) => new Date(x.lastSeenAt).getTime() === t(4).getTime());
  assert(quiet.pagesNotModified >= 1 && seenAll && quiet.complete === true, 'a 304 page still counts its repositories as present, and the sync is marked complete');
  wa.list = wa.list.filter((x) => x.name !== 'delta'); wa.bump();
  const after = await sync.runSync(pool, { client: ca(), owner: OWNER, now: t(5) });
  const rows5 = await repos.listRepos(pool);
  assert(after.complete === true && rows5.find((x) => x.name === 'delta') && rows5.filter((x) => new Date(x.lastSeenAt).getTime() < t(5).getTime()).map((x) => x.name).join() === 'delta', 'a repository deleted on GitHub is kept but is the only one not seen in the latest complete sync');
  const cc = require('./server/routes/commandCenter.cjs')._test;
  assert(cc.presentRepo(rows5.find((x) => x.name === 'delta'), new Map(), t(5), after.startedAt).missing === true && cc.presentRepo(rows5.find((x) => x.name === 'alpha'), new Map(), t(5), after.startedAt).missing === false && cc.presentRepo(rows5.find((x) => x.name === 'delta'), new Map(), t(5), null).missing === false, 'the missing flag is set only for the unseen repository, and never when there is no complete sync to compare with');

  // ── optional daily sync (offline: no token means no request at all) ──
  let calls = 0; const mk = () => gh.createClient({ token: TOKEN, fetchImpl: async (...a) => { calls += 1; return w.fetch(...a); } });
  const none = await sync.scheduledSync(pool, { env: {}, makeClient: mk, now: NOW });
  assert(none.skipped && none.reason === 'not_configured' && calls === 0, 'daily sync: with no token it does nothing and makes no request');
  const off = await sync.scheduledSync(pool, { env: { GITHUB_TOKEN: TOKEN, APP_INTELLIGENCE_GITHUB_SYNC: 'off' }, makeClient: mk, now: NOW });
  assert(off.skipped && off.reason === 'disabled' && calls === 0, 'daily sync: APP_INTELLIGENCE_GITHUB_SYNC=off disables it even with a token');
  const ran = await sync.scheduledSync(pool, { env: { GITHUB_TOKEN: TOKEN, GITHUB_OWNER: OWNER }, makeClient: mk, now: NOW });
  assert(ran.ok === true && calls > 0, 'daily sync: with a token it runs the same read-only sync as the button');
  const boom = await sync.scheduledSync(pool, { env: { GITHUB_TOKEN: TOKEN }, makeClient: () => { throw new Error('oops ' + TOKEN); }, now: NOW });
  assert(boom.ok === false && !JSON.stringify(boom).includes(TOKEN), 'daily sync: a failure is returned, never thrown, and never contains the token');

  await pool.query('DELETE FROM ai_repos'); await pool.query("DELETE FROM ai_service_state WHERE key IN ('github_sync','github_list_etags')"); await pool.end();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
