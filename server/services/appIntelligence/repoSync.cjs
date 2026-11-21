// server/services/appIntelligence/repoSync.cjs
//
// Command Center: one repository sync (manual button or the optional daily timer).
//
//   1. List the owner's repositories (paged, conditional: a page GitHub reports unchanged costs no quota).
//   2. Upsert each one. Only SYNC columns are written; owner decisions are untouched.
//   3. Scan a repository's contents ONLY when its last push differs from the push that was last scanned, so a quiet
//      repository is never re-read. A failed scan is retried on the next sync.
//   4. Record one small status row (no history). A failed sync keeps every earlier row exactly as it was.
//
// Read-only toward GitHub, sequential (no parallel requests), and it never touches monitored applications.
'use strict';

const store = require('./store.cjs');
const repos = require('./repos.cjs');
const { classify } = require('./repoScan.cjs');
const { GithubError } = require('./github.cjs');

const STATE_KEY = 'github_sync';
const ETAG_KEY = 'github_list_etags';
const MAX_PAGES = 5; // 500 repositories: far above the 200 the store accepts
const MAX_TEXT = 100000;
let running = false;

const readme = (paths) => paths.find((p) => /^readme(\.(md|markdown|txt))?$/i.test(p));

async function readJsonState(pool, key) {
  try { const row = await store.getServiceState(pool, key); return row && row.value ? JSON.parse(row.value) : null; } catch { return null; }
}

async function scanRepo(client, gh) {
  const branch = encodeURIComponent(gh.defaultBranch || 'HEAD');
  let paths = []; let truncated = false;
  try {
    const tree = await client.get(`/repos/${gh.fullName}/git/trees/${branch}?recursive=1`);
    paths = (tree.data.tree || []).filter((t) => t.type === 'blob').map((t) => String(t.path)).slice(0, 5000);
    truncated = Boolean(tree.data.truncated);
  } catch (err) { if (!(err instanceof GithubError) || !['not_found', 'http_error'].includes(err.code)) throw err; } // empty repository: no tree
  const text = async (p) => (p ? (await client.get(`/repos/${gh.fullName}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, { raw: true })).data.slice(0, MAX_TEXT) : undefined);
  const files = { paths, truncated };
  files.packageJson = await text(paths.find((p) => p === 'package.json'));
  files.requirements = await text(paths.find((p) => p === 'requirements.txt'));
  files.readme = await text(readme(paths));
  // Deployments are optional: a token without that permission leaves deployment "unknown", it does not fail the scan.
  let deployments = null;
  try {
    const list = await client.get(`/repos/${gh.fullName}/deployments?per_page=1`);
    deployments = [];
    if (list.data[0]) {
      let state = null;
      try { const s = await client.get(`/repos/${gh.fullName}/deployments/${list.data[0].id}/statuses?per_page=1`); state = s.data[0] ? s.data[0].state : null; } catch (e) { if (!(e instanceof GithubError) || !['forbidden', 'not_found'].includes(e.code)) throw e; }
      deployments = [{ state, environment: list.data[0].environment || '' }];
    }
  } catch (err) { if (!(err instanceof GithubError) || !['forbidden', 'not_found'].includes(err.code)) throw err; }
  let openPrs = null;
  try { openPrs = (await client.get(`/repos/${gh.fullName}/pulls?state=open&per_page=100`)).data.length; } catch (err) { if (!(err instanceof GithubError) || !['forbidden', 'not_found'].includes(err.code)) throw err; }
  return { scan: classify({ archived: gh.archived, language: gh.language, description: gh.description }, files, deployments), openPrs };
}

/** Never throws: returns the status that was stored. */
async function runSync(pool, { client, owner, now = new Date() }) {
  if (running) return { ok: false, code: 'already_running', error: 'A sync is already running.' };
  running = true;
  const status = { startedAt: now.toISOString(), finishedAt: null, ok: false, owner, found: 0, scanned: 0, unchanged: 0, pagesNotModified: 0, errors: [], code: null };
  try {
    const etags = (await readJsonState(pool, ETAG_KEY)) || {};
    const nextEtags = {};
    let url = '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member';
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const known = etags[url];
      const res = await client.get(url, { etag: known && known.etag });
      if (res.notModified) { // nothing on this page changed: keep its stored ETag and carry on to the page after it
        status.pagesNotModified += 1; nextEtags[url] = known; url = known.next || null; continue;
      }
      if (res.etag) nextEtags[url] = { etag: res.etag, next: res.next };
      const mine = res.data.filter((r) => r && r.owner && String(r.owner.login).toLowerCase() === owner.toLowerCase());
      for (const r of mine) {
        if (status.found >= repos.MAX_REPOS) break;
        status.found += 1;
        const gh = { githubId: r.id, fullName: r.full_name, name: r.name, htmlUrl: r.html_url, visibility: r.private ? 'private' : 'public', archived: r.archived, defaultBranch: r.default_branch, description: r.description, language: r.language, pushedAt: r.pushed_at };
        let row = await repos.upsertSynced(pool, gh, null, now);
        if (row.scanPushedAt && row.scanPushedAt === row.pushedAt) { status.unchanged += 1; continue; }
        try {
          const { scan, openPrs } = await scanRepo(client, gh);
          row = await repos.saveScan(pool, row.id, scan, now);
          if (openPrs !== null) await pool.query('UPDATE ai_repos SET open_prs = $2 WHERE id = $1', [row.id, openPrs]);
          status.scanned += 1;
        } catch (err) {
          if (err instanceof GithubError && ['unauthorized', 'rate_limited'].includes(err.code)) throw err; // stop: later calls would fail too
          status.errors.push({ repo: gh.fullName, code: err instanceof GithubError ? err.code : 'scan_failed' });
        }
      }
      url = res.next;
    }
    // Keep ETags for pages we saw; a page that moved simply gets a fresh one next time.
    await store.setServiceState(pool, ETAG_KEY, JSON.stringify(nextEtags));
    status.ok = true;
  } catch (err) {
    status.code = err instanceof GithubError ? err.code : 'sync_failed';
    status.errors.push({ repo: null, code: status.code, message: err instanceof GithubError ? err.message : 'The sync stopped unexpectedly.' });
  } finally {
    status.finishedAt = new Date().toISOString();
    try { await store.setServiceState(pool, STATE_KEY, JSON.stringify(status)); } catch { /* the status is best effort */ }
    running = false;
  }
  return status;
}

async function lastSync(pool) { return readJsonState(pool, STATE_KEY); }

/**
 * The optional daily GitHub sync, called from the daily pass. Does nothing (and makes no request) unless a token is
 * configured and APP_INTELLIGENCE_GITHUB_SYNC is not "off". Never throws: a failure is recorded in the sync status and
 * must not stop the health pass from completing.
 */
async function scheduledSync(pool, { env = process.env, makeClient, now = new Date() } = {}) {
  if (!env.GITHUB_TOKEN) return { skipped: true, reason: 'not_configured' };
  if (String(env.APP_INTELLIGENCE_GITHUB_SYNC || 'on').trim().toLowerCase() === 'off') return { skipped: true, reason: 'disabled' };
  try {
    const github = require('./github.cjs');
    const client = makeClient ? makeClient() : github.createClient({ token: env.GITHUB_TOKEN });
    return await runSync(pool, { client, owner: String(env.GITHUB_OWNER || 'strategichonesty-2026'), now });
  } catch (err) { return { ok: false, code: 'error', error: 'The scheduled GitHub sync failed.' }; }
}

module.exports = { runSync, scheduledSync, lastSync, scanRepo, STATE_KEY };
