// test_command_center_ui.cjs
// Command Center step 3b: the repository screens. The view helpers are tested directly, and the REAL components are
// rendered to HTML on the server (no browser, no network) to prove they show what the design promises.
// Dummy data only. Run: node test_command_center_ui.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };

const repo = (o = {}) => ({
  id: 'repo-1', name: 'media', fullName: 'acme/media', htmlUrl: 'https://github.com/acme/media', visibility: 'private',
  type: { value: 'application', confirmed: false, evidence: 'Frontend (index.html) and deploy config (railway.json).', suggested: 'application' },
  purpose: { value: 'Makes media', owner: false }, stack: ['React', 'Express'], language: 'JavaScript', liveUrl: '', priority: null, priorityNote: '',
  activity: { state: 'active', days: 3, pushedAt: '2026-11-18T00:00:00Z', openPrs: 2, defaultBranch: 'main', source: 'GitHub', readAt: '2026-11-21T11:40:00Z' },
  deployment: { state: 'configured', platform: 'Railway', evidence: 'Deploy config found: railway.json.', checkedAt: '2026-11-21T11:40:00Z', source: 'GitHub deployments and config files' },
  health: { state: 'not_checked', note: 'Confirm the type first.', lastCheckedAt: null, source: 'Health checker' },
  appId: null, scannedAt: '2026-11-21T11:40:00Z', updatedAt: '2026-11-21T11:40:00Z', ...o,
});

(async () => {
  // ── view helpers (pure) ──
  const src = fs.readFileSync('./src/intelligence/data/repoView.js', 'utf8');
  const v = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const list = [
    repo({ id: 'a', name: 'alpha' }),
    repo({ id: 'b', name: 'beta', type: { value: 'tool', confirmed: true }, priority: 'hold', activity: { state: 'dormant', days: 100, pushedAt: '2026-08-01T00:00:00Z' }, stack: ['Python'] }),
    repo({ id: 'c', name: 'gamma', type: { value: null, confirmed: false }, priority: 'invest', purpose: { value: 'Handles invoices', owner: true }, activity: { state: 'unknown', days: null, pushedAt: null } }),
  ];
  const ids = (l) => l.map((r) => r.id).join();
  assert(ids(v.filterRepos(list, { type: 'needs_type' })) === 'a,c', 'filter: "needs a type" lists suggested and unclassified repositories');
  assert(ids(v.filterRepos(list, { type: 'tool' })) === 'b' && ids(v.filterRepos(list, { type: 'application' })) === 'a', 'filter: by type');
  assert(ids(v.filterRepos(list, { priority: 'unset' })) === 'a' && ids(v.filterRepos(list, { priority: 'invest' })) === 'c', 'filter: by priority, including "not set"');
  assert(ids(v.filterRepos(list, { q: 'python' })) === 'b' && ids(v.filterRepos(list, { q: 'INVOICES' })) === 'c' && ids(v.filterRepos(list, { q: 'ALPHA' })) === 'a' && ids(v.filterRepos(list, { q: 'zzz' })) === '', 'search: name, purpose and stack, case-insensitive');
  assert(ids(v.sortRepos(list)) === 'a,b,c', 'sort: newest push first, unknown push last');
  assert(v.daysText(0) === 'today' && v.daysText(1) === '1 day ago' && v.daysText(9) === '9 days ago' && v.daysText(null) === '', 'text: day counts read naturally');
  assert(v.healthMeta('nonsense').label === 'Unable to verify' && v.healthMeta('not_applicable').label === 'Not applicable', 'health labels: unknown values fall back to "unable to verify"');
  assert(/only a suggestion/.test(v.readingOf(repo())) && /Not a running application/.test(v.readingOf(repo({ type: { value: 'tool', confirmed: true } }))), 'reading: an unconfirmed type is called a suggestion; tools are not health-checked');
  assert(/nothing proves the live app works/.test(v.readingOf(repo({ type: { value: 'application', confirmed: true } }))), 'reading: active code with no health check never claims the app works');
  assert(/failing its health check/.test(v.readingOf(repo({ type: { value: 'service', confirmed: true }, health: { state: 'unhealthy' } }))) && /verified healthy/.test(v.readingOf(repo({ type: { value: 'service', confirmed: true }, health: { state: 'healthy' } }))), 'reading: health words come only from the checker result');

  // ── render the real components on the server ──
  const esbuild = require('esbuild');
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-ui-')), 'bundle.cjs');
  const entry = `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { ToastProvider } from '${path.resolve('./src/intelligence/ui/Toast.jsx')}';
    import RepoTable from '${path.resolve('./src/intelligence/components/RepoTable.jsx')}';
    import SyncBar from '${path.resolve('./src/intelligence/components/SyncBar.jsx')}';
    import AttentionList, { linkFor } from '${path.resolve('./src/intelligence/components/AttentionList.jsx')}';
    import { PortfolioRow } from '${path.resolve('./src/intelligence/pages/Portfolio.jsx')}';
    import PortfolioImport from '${path.resolve('./src/intelligence/components/PortfolioImport.jsx')}';
    import PortfolioDialog from '${path.resolve('./src/intelligence/components/PortfolioDialog.jsx')}';
    import { RepoDetailView } from '${path.resolve('./src/intelligence/pages/RepoDetail.jsx')}';
    const wrap = (el) => renderToStaticMarkup(React.createElement(ToastProvider, null, el));
    export const table = (repos, needType) => wrap(React.createElement(RepoTable, { repos, needType }));
    export const sync = (s) => wrap(React.createElement(SyncBar, { sync: s, onDone() {} }));
    export const attn = (data) => wrap(React.createElement(AttentionList, { data }));
    export const link = linkFor;
    export const row = (item, repo) => wrap(React.createElement('ul', null, React.createElement(PortfolioRow, { item, repo, onEdit() {}, onDelete() {} })));
    export const importer = () => wrap(React.createElement(PortfolioImport, { open: true, onClose() {}, onDone() {} }));
    export const dialog = (item) => wrap(React.createElement(PortfolioDialog, { open: true, item, repoNames: ['alpha'], onClose() {}, onSaved() {} }));
    export const detail = (r, apps) => wrap(React.createElement(RepoDetailView, { repo: r, apps, onChanged() {} }));
  `;
  await esbuild.build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', external: ['react', 'react-dom'], define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_API_URL': 'undefined', 'import.meta.env': '{}' }, logLevel: 'silent', absWorkingDir: process.cwd(), nodePaths: [path.resolve('node_modules')] });
  global.window = { location: { hash: '' }, addEventListener() {}, removeEventListener() {} }; global.document = { addEventListener() {}, removeEventListener() {} };
  const ui = require(out);

  const html = ui.table(list, 2);
  assert(/2 repositories need a confirmed type/.test(html) && /only confirmed applications and services get health checks/.test(html), 'table: says how many repositories need a type and that only confirmed ones are health-checked');
  assert(/Application \(suggested\)/.test(html) && /Needs a type/.test(html) && /Tool<\/span>/.test(html), 'table: a suggested type is labelled as a suggestion; unclassified shows "Needs a type"');
  assert(/Repository activity<\/th><th>Deployment<\/th><th>Health/.test(html), 'table: activity, deployment and health are three separate columns');
  assert(/pushed 3 days ago/.test(html) && /Config found/.test(html) && /Not checked/.test(html) && /Dormant/.test(html), 'table: shows activity, deployment and health states with plain words');
  assert(/Not set/.test(html) && /Hold/.test(html) && /Invest/.test(html), 'table: shows priorities, and "Not set" when you have not chosen');
  assert(/href="#\/applications\/a"/.test(html), 'table: each repository links to its detail page');
  assert(/No repositories yet/.test(ui.table([], 0)) && /Sync now/.test(ui.table([], 0)), 'table: empty state tells you to run a sync');

  assert(/GitHub is not connected yet/.test(ui.sync({ configured: false, owner: 'acme', last: null })) && !/Sync now/.test(ui.sync({ configured: false, owner: 'acme', last: null })), 'sync bar: without a token it explains and offers no button');
  assert(/Never synced/.test(ui.sync({ configured: true, owner: 'acme', last: null })) && /Sync now/.test(ui.sync({ configured: true, owner: 'acme', last: null })), 'sync bar: before the first sync it says "Never synced" and offers the button');
  assert(/6 repositories found for acme/.test(ui.sync({ configured: true, owner: 'acme', last: { ok: true, found: 6, owner: 'acme', finishedAt: '2026-11-21T11:40:00Z', errors: [] } })), 'sync bar: shows what the last sync found');
  assert(/Earlier data is kept/.test(ui.sync({ configured: true, owner: 'acme', last: { ok: false, found: 0, owner: 'acme', finishedAt: '2026-11-21T11:40:00Z', errors: [{ code: 'unauthorized', message: 'GitHub rejected the token (expired or revoked).' }] } })) && /rejected the token/.test(ui.sync({ configured: true, owner: 'acme', last: { ok: false, owner: 'acme', finishedAt: '2026-11-21T11:40:00Z', errors: [{ message: 'GitHub rejected the token (expired or revoked).' }] } })), 'sync bar: a failed sync says why and that earlier data is kept');

  const d = ui.detail(repo(), []);
  assert(/1\. Repository activity/.test(d) && /2\. Deployment status/.test(d) && /3\. Application health/.test(d), 'detail: three separate signal panels');
  assert(/Source: GitHub ·/.test(d) && /Source: GitHub deployments and config files/.test(d) && /Source: Health checker/.test(d), 'detail: every signal names its source');
  assert(/Frontend \(index\.html\) and deploy config \(railway\.json\)/.test(d) && /Confirm Application/.test(d) && /only a suggestion/.test(d), 'detail: shows the evidence for the suggested type and a button to confirm it');
  assert(/Not set\. Click one/.test(d) && /Invest/.test(d) && /Maintain/.test(d) && /Hold/.test(d) && /Retire/.test(d), 'detail: the four priorities are offered');
  assert(/Never sent to GitHub/.test(d) && /Open on GitHub/.test(d), 'detail: your notes are saved only here, and the GitHub link is separate');
  const withApp = ui.detail(repo({ appId: 'app-1', health: { state: 'healthy', note: '', lastCheckedAt: '2026-11-21T10:00:00Z', source: 'Health checker' }, type: { value: 'application', confirmed: true } }), [{ id: 'app-1', name: 'Media (live)' }]);
  assert(/Healthy/.test(withApp) && /Media \(live\)/.test(withApp) && /verified healthy/.test(withApp) && !/Confirm Application/.test(withApp), 'detail: a linked, confirmed application shows the checker\'s real result');

  const item = { id: 'x', level: 'high', label: 'High', title: 'Provider key is recorded as exposed', evidence: 'Your Secrets & Subscriptions record (inferred, not verified)', checkedAt: '2026-11-21T10:00:00Z', action: 'Open Secrets & Subscriptions', href: '/secrets' };
  const numbers = { repositories: 20, confirmedApplications: 3, pushedLast14Days: 4, needType: 8 };
  const a1 = ui.attn({ items: [item, { ...item, id: 'y', level: 'low', label: 'Low', title: 'GitHub is not connected', href: '/applications?type=needs_type' }], total: 5, numbers });
  assert(/Needs your attention/.test(a1) && />High</.test(a1) && /Provider key is recorded as exposed/.test(a1) && /Evidence: Your Secrets &amp; Subscriptions record \(inferred, not verified\)/.test(a1) && /read /.test(a1) && /Open Secrets &amp; Subscriptions/.test(a1), 'attention: each item shows its level, title, evidence, when it was read and an action');
  assert(/3 more not shown/.test(a1) && /found on GitHub/.test(a1) && /not yet confirmed/.test(a1), 'attention: says how many items are hidden and shows the four at-a-glance numbers');
  const a0 = ui.attn({ items: [], total: 0, numbers });
  assert(/Nothing needs attention right now/.test(a0) && /not counted as fine/.test(a0), 'attention: an empty list says it is based on what was checked, never "all fine"');
  assert(ui.link('/secrets') === '#/secrets' && ui.link('/applications?type=needs_type') === '#/applications?type=needs_type' && ui.link('/') === '#', 'attention: server links become console links, with filters kept');

  // ── portfolio ──
  const pv = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync('./src/intelligence/data/portfolioView.js', 'utf8')).toString('base64')}`);
  assert(pv.TABS.map((t) => t.id).join() === 'all,decision,risk,opportunity,issue' && pv.tabById('risk').types.join() === 'risk' && pv.tabById('nope').id === 'all' && pv.tabById('opportunity').types.join() === 'opportunity,idea', 'portfolio tabs: five views, ideas grouped with opportunities, requirements with issues, unknown tab falls back to All');
  assert(pv.parseImport('').error && pv.parseImport('not json').error && pv.parseImport('{"a":1}').error && pv.parseImport('[]').error && pv.parseImport(JSON.stringify(Array.from({ length: 101 }, () => ({})))).error, 'import parsing: empty, invalid, wrongly shaped, empty-list and over-100 inputs each give a plain error');
  assert(pv.parseImport('[{"type":"idea","title":"x"}]').items.length === 1 && pv.parseImport(pv.IMPORT_EXAMPLE).items.length === 2, 'import parsing: a bare list and an {items} object both work, and the built-in example is valid');
  assert(pv.importSummary({ dryRun: true, added: [1, 2], skipped: [1], invalid: [] }) === '2 would be added, 1 already there' && pv.importSummary({ dryRun: false, added: [1], skipped: [], invalid: [1, 2] }) === '1 added, 2 with problems', 'import summary: reads naturally for previews and results');
  assert(pv.repoFor([{ id: 'r', name: 'Alpha', fullName: 'o/Alpha' }], ' alpha ').id === 'r' && pv.repoFor([], 'x') === null && pv.repoFor([{ id: 'r', name: 'a', fullName: 'o/a' }], '') === null, 'repository link: matches by name ignoring case and spaces; no name gives no link');
  const pitem = { id: 'pf-1', type: 'risk', title: 'Fallback credential', body: 'A default is used.', repoName: 'alpha', status: 'open', level: 'high', evidence: 'code review', evidenceLevel: 'verified', evidenceCheckedAt: '2026-11-20', source: 'import' };
  const prow = ui.row(pitem, { id: 'repo-9' });
  assert(/Risk/.test(prow) && />High</.test(prow) && /Fallback credential/.test(prow) && /A default is used\./.test(prow) && />Verified</.test(prow) && /Evidence: code review/.test(prow) && /checked <time[^>]*>2026-11-20/.test(prow) && /imported/.test(prow), 'portfolio row: shows kind, level, title, details, evidence level, evidence text, the date checked and where it came from');
  assert(/href="#\/applications\/repo-9"/.test(prow) && /Edit Fallback credential/.test(prow) && /Delete Fallback credential/.test(prow), 'portfolio row: links to the repository and offers edit and delete');
  const bare = ui.row({ ...pitem, evidence: '', evidenceLevel: 'unverified', evidenceCheckedAt: null, level: null, source: 'owner' }, null);
  assert(/No evidence recorded/.test(bare) && /never checked/.test(bare) && />Unverified</.test(bare) && !/href="#\/applications/.test(bare) && !/imported/.test(bare), 'portfolio row: with no evidence it says so plainly, shows no level badge and no link');
  const imp = ui.importer();
  assert(/Import portfolio records/.test(imp) && /stay in this console/.test(imp) && /Insert an example/.test(imp) && /Preview/.test(imp) && /<button[^>]*disabled=""[^>]*>[^<]*Add records/.test(imp), 'import dialog: explains where records stay, offers an example and a preview, and the add button is off until a preview exists');
  const dlg = ui.dialog(null);
  assert(/Add to the portfolio/.test(dlg) && /Never paste a key, token or password/.test(dlg) && /needs evidence and a date/.test(dlg) && /Verified/.test(dlg) && /alpha/.test(dlg), 'add dialog: warns against secrets, explains the "verified" rule and offers repository names');
  assert(/Edit portfolio item/.test(ui.dialog(pitem)) && /value="Fallback credential"/.test(ui.dialog(pitem)), 'edit dialog: opens filled in with the existing item');

  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
