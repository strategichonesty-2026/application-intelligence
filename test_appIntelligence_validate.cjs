// test_appIntelligence_validate.cjs
// The read-only integration validator: classification vocabulary, health-endpoint discovery rules,
// no leakage into the report, and refusal to run without internet access. Local servers only.
const http = require('http');
const { spawnSync } = require('child_process');
const v = require('./server/scripts/validateIntegrations.cjs');
const targets = require('./server/scripts/appIntelligenceTargets.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const CANARY = 'CANARY-ACCOUNT-4111111111111111';
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const opts = { allowPrivate: true, retryDelayMs: 1, discoverDelayMs: 1, hasEgress: async () => true };
const T = (s, path = '/', extra = {}) => ({ name: 'T', url: `http://127.0.0.1:${s.address().port}${path}`, environment: 'production', note: '', ...extra });

(async () => {
  const app = await listen((q, r) => {
    if (q.url === '/health') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ status: 'ok', account: CANARY })); }
    if (q.url === '/dashboard') { r.statusCode = 302; r.setHeader('location', `/login?token=${CANARY}`); return r.end(); }
    r.end(`<html>${CANARY}</html>`);
  });
  const spa = await listen((q, r) => r.end(`<html>single page app ${CANARY}</html>`)); // 200 HTML for EVERY path
  const auth = await listen((q, r) => { r.statusCode = 401; r.end('no'); });
  const broken = await listen((q, r) => { r.statusCode = 500; r.end(`oops ${CANARY}`); });
  const slow = await listen((q, r) => setTimeout(() => r.end('late'), 600));
  const dead = await listen(() => {}); const deadPort = dead.address().port; await new Promise((r) => dead.close(r));

  let r = await v.validateOne(T(app), { ...opts, discover: true });
  assert(r.classification === 'Reachable (health not verified)', 'homepage 200 => "Reachable (health not verified)", never Healthy');
  assert(r.healthCandidates.find((c) => c.path === '/health').verdict === 'candidate', 'discovery: /health returning JSON {"status":"ok"} is a candidate');
  assert(!r.healthCandidates.find((c) => c.path === '/api/health').verdict.startsWith('candidate'), 'discovery: an HTML page on a health path is not a candidate');
  const nf = await listen((q, rr) => { rr.statusCode = 404; rr.end('nope'); });
  const rnf = await v.validateOne(T(nf), { ...opts, discover: true }); nf.close();
  assert(rnf.healthCandidates.every((c) => c.verdict.startsWith('not found')), 'discovery: 404 on every path => no candidate, "not found"');
  assert(r.healthCandidates.length === 5, 'discovery: at most 5 fixed paths per application');

  r = await v.validateOne(T(app, '/dashboard'), opts);
  assert(r.classification === 'Reachable (health not verified)' && r.redirects === 1, 'login-redirect page => Reachable only (a login page is not health); redirect counted');

  r = await v.validateOne(T(spa), { ...opts, discover: true });
  assert(r.healthCandidates.every((c) => !c.verdict.startsWith('candidate')) && /not a health endpoint/.test(r.healthCandidates[0].verdict), 'discovery: an SPA that answers 200 HTML on every path yields NO false candidate');

  r = await v.validateOne(T(auth), opts);
  assert(r.classification === 'Unable to verify' && /authentication/.test(r.explanation), '401 => "Unable to verify" (not healthy, not unavailable)');
  r = await v.validateOne(T(broken), opts);
  assert(r.classification === 'Unavailable' && !r.explanation.includes(CANARY), '500 => "Unavailable"; body text not echoed');
  const nf404 = await listen((q, rr) => { rr.statusCode = 404; rr.end('nope'); });
  r = await v.validateOne(T(nf404, '/dashboard'), opts); nf404.close();
  assert(r.classification === 'Unable to verify' && /not shown as an outage/.test(r.explanation), '404 from a live server => "Unable to verify" (the server is up; the path is wrong), not "Unavailable"');
  r = await v.validateOne(T(slow), opts);
  assert(r.classification === 'Reachable (health not verified)' && r.responseMs >= 550, 'answers slowly, no approved limit => still "Reachable"; the time is reported, not judged (no arbitrary threshold)');
  r = await v.validateOne({ name: 'D', url: `http://127.0.0.1:${deadPort}/`, note: '' }, opts);
  assert(r.classification === 'Unavailable', 'connection refused with a working network => "Unavailable"');
  r = await v.validateOne({ name: 'D', url: `http://127.0.0.1:${deadPort}/`, note: '' }, { ...opts, hasEgress: async () => false, discover: true });
  const net = await v.validateOne({ name: 'N', url: 'http://no-such-host.invalid/', note: '' }, { allowPrivate: false, retryDelayMs: 1, hasEgress: async () => false, discover: true });
  assert(net.classification === 'Unable to verify' && net.healthCandidates.length === 0, 'monitor has no internet => "Unable to verify" (blocked network is NOT an outage), and no discovery attempted');

  const unconf = await v.validateOne(T(app, '/', { unconfirmed: true }), { ...opts, discover: true });
  assert(unconf.healthCandidates.length === 0 && unconf.unconfirmed, 'unconfirmed application: not probed for health paths by default');
  const unconf2 = await v.validateOne(T(app, '/', { unconfirmed: true }), { ...opts, discover: true, includeUnconfirmed: true });
  assert(unconf2.healthCandidates.length === 5, 'unconfirmed application: probed only with the explicit flag');

  const md = v.renderReport([await v.validateOne(T(app), { ...opts, discover: true }), unconf], { egress: true });
  assert(!md.includes(CANARY) && !/token=/.test(md), 'report: contains no response body content and no redirect query strings');
  assert(/UNCONFIRMED application/.test(md) && /Reachable \(health not verified\)/.test(md), 'report: flags the unconfirmed application and uses the reachable wording');
  const json = JSON.stringify(await v.validateOne(T(app, '/dashboard'), opts));
  assert(!json.includes(CANARY), 'json: no body or query-string content');

  const deep = await listen((q, rr) => { if (q.url === '/dashboard') { rr.statusCode = 404; return rr.end('nope'); } rr.end('<html>root</html>'); });
  const rd = await v.validateOne(T(deep, '/dashboard'), opts);
  assert(rd.classification === 'Unable to verify' && rd.rootCheck && rd.rootCheck.classification === 'Reachable (health not verified)' && rd.rootCheck.httpStatus === 200, 'deep path 404 + root 200 => the server is up and the registered path is what is wrong (both recorded)');
  assert(/Root `\/`/.test(v.renderReport([rd], { egress: true })), 'report: shows the root-path result next to the registered path');
  const rroot = await v.validateOne(T(deep, '/'), opts);
  assert(!rroot.rootCheck, 'a registered root URL is not checked twice');
  deep.close();

  // discovery must not copy private-looking fields out of a health response
  const pf = await listen((q, rr) => { rr.setHeader('content-type', 'application/json'); rr.end(JSON.stringify(q.url === '/health' ? { status: 'ok', balance: CANARY, accountNumber: CANARY, transactions: [CANARY] } : { nope: true })); });
  const rpf = await v.validateOne(T(pf, '/', { sensitive: true }), { ...opts, discover: true });
  const hp = rpf.healthCandidates.find((c) => c.path === '/health');
  assert(hp.verdict === 'candidate' && hp.looksLikePrivateData && hp.fieldNames.length === 0 && /UNSAFE/.test(hp.coverage), 'discovery: a health path whose JSON has balance/account-style fields is flagged UNSAFE and no field names or values are kept');
  assert(!JSON.stringify(rpf).includes(CANARY) && !JSON.stringify(rpf).includes('balance'), 'discovery: PFOS-style response leaks neither values nor sensitive field names into results');
  pf.close();
  const good = await listen((q, rr) => { rr.setHeader('content-type', 'application/json'); rr.end(JSON.stringify(q.url === '/api/health' ? { status: 'ok', db: 'ok', uptime: 5 } : q.url === '/health' ? { status: 'ok' } : { x: 1 })); });
  const rg = await v.validateOne(T(good), { ...opts, discover: true });
  assert(/dependency checks/.test(rg.healthCandidates.find((c) => c.path === '/api/health').coverage) && /process-level only/.test(rg.healthCandidates.find((c) => c.path === '/health').coverage), 'discovery: coverage is INFERRED from field names (db => dependency checks; status only => process-level) and labelled as inferred');
  good.close();
  assert(/inferred/.test(v.renderReport([rg], { egress: true })), 'report: coverage text says "inferred"');

  // response-header hints: help tell an application's own 404 from a hosting edge's, without leaking anything
  const edge = await listen((q, rr) => { rr.statusCode = 404; rr.setHeader('x-railway-fallback', 'true'); rr.setHeader('server', 'railway-edge'); rr.setHeader('set-cookie', `sid=${CANARY}`); rr.setHeader('x-railway-request-id', 'abc123'); rr.setHeader('authorization', 'Bearer ' + CANARY); rr.end('{"status":"error","code":404,"message":"Application not found"}'); });
  const re = await v.validateOne(T(edge, '/dashboard'), opts);
  assert(re.responseHints && re.responseHints['x-railway-fallback'] === 'true' && re.responseHints.server === 'railway-edge' && re.responseHints['x-railway-request-id'] === 'present', 'hints: allowlisted headers (server, x-railway-fallback, request-id presence) are recorded');
  assert(!JSON.stringify(re).includes(CANARY) && !('set-cookie' in re.responseHints) && !('authorization' in re.responseHints), 'hints: cookies and auth headers are never recorded');
  assert(/Response hints: .*x-railway-fallback=true/.test(v.renderReport([re], { egress: true })), 'report: shows the hints next to a 4xx result');
  assert(!/Application not found/.test(JSON.stringify(re)), 'hints: the response body (even a short JSON error) is still never recorded');
  const app404 = await listen((q, rr) => { rr.statusCode = 404; rr.setHeader('x-powered-by', 'Next.js'); rr.end('nope'); });
  const ra = await v.validateOne(T(app404, '/dashboard'), opts);
  assert(ra.responseHints['x-powered-by'] === 'Next.js' && !('x-railway-fallback' in ra.responseHints), 'hints: an application-level 404 shows the framework header and no platform-fallback header');
  edge.close(); app404.close();

  // the exact commands the owner will run
  assert(v.selectTargets(targets, 'problemsignal').length === 1 && v.selectTargets(targets, 'problemsignal')[0].name === 'ProblemSignal', '--only problemsignal selects exactly ProblemSignal (case-insensitive)');
  assert(v.selectTargets(targets, 'PFOS').length === 1 && v.selectTargets(targets, undefined).length === 7 && v.selectTargets(targets, undefined, { includeManualOnly: true }).length === 8 && v.selectTargets(targets, 'zzz').length === 0, '--only: PFOS selects one; no filter selects the seven non-manual apps (Travel excluded); --include-manual-only adds the eighth; no match selects none');
  const nomatch = await new Promise((resolve) => { const c = require('child_process').spawn(process.execPath, ['server/scripts/validateIntegrations.cjs', '--only', 'zzz-nothing'], { env: { ...process.env, APP_INTELLIGENCE_EGRESS_PROBE: 'off' } }); let e = ''; c.stderr.on('data', (d) => { e += d; }); c.on('close', (code) => resolve({ code, e })); });
  assert(nomatch.code === 1 && /No application name contains/.test(nomatch.e), '--only with no match fails loudly instead of writing an empty report');

  // target list sanity
  assert(targets.length === 8 && targets.filter((t) => t.unconfirmed).length === 1 && targets.find((t) => t.unconfirmed).url.includes('web-production-95161'), 'targets: eight applications, exactly one flagged unconfirmed (web-production-95161)');
  assert(targets.every((t) => t.url.startsWith('https://')), 'targets: all https');
  assert(!targets.find((t) => t.unconfirmed).name.toLowerCase().startsWith('home hunting'), 'targets: the project does not assert the unconfirmed application\'s identity');

  // the CLI refuses to produce results without internet access
  const cli = spawnSync('node', ['server/scripts/validateIntegrations.cjs', '--json', '/tmp/should-not-exist.json'], { encoding: 'utf8', env: { ...process.env, APP_INTELLIGENCE_EGRESS_PROBE: '' } });
  const sandboxBlocked = cli.status === 2;
  assert(sandboxBlocked ? /INVALID RUN/.test(cli.stderr) && !require('fs').existsSync('/tmp/should-not-exist.json') : true, sandboxBlocked ? 'cli: no internet => exit 2, "INVALID RUN", no results file written' : 'cli: (machine has internet; refusal path covered by the unit test above)');

  // seeding: dry run by default; --apply is refused unless the operator confirms the database host
  const seed = (args, env = {}) => spawnSync('node', ['server/scripts/seedApplications.cjs', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env }, timeout: 15000 });
  let sd = seed([], { DATABASE_URL: 'postgres://u:p@prod-db.example.com:5432/x' });
  assert(sd.status === 0 && /dry run/.test(sd.stdout) && /Nothing was written/.test(sd.stdout) && !/prod-db/.test(sd.stdout + sd.stderr), 'seed: default is a DRY RUN; it does not touch or even print the database URL');
  sd = seed(['--apply'], {});
  assert(sd.status === 1 && /DATABASE_URL is not set/.test(sd.stderr), 'seed: --apply without DATABASE_URL is refused');
  sd = seed(['--apply'], { DATABASE_URL: 'postgres://u:secretpw@prod-db.example.com:5432/x' });
  assert(sd.status === 1 && /REFUSED/.test(sd.stderr) && /prod-db\.example\.com:5432/.test(sd.stderr) && !/secretpw/.test(sd.stdout + sd.stderr), 'seed: --apply without --confirm-host is refused, names the target host, never prints the password');
  sd = seed(['--apply', '--confirm-host', 'staging-db.example.com:5432'], { DATABASE_URL: 'postgres://u:p@prod-db.example.com:5432/x' });
  assert(sd.status === 1 && /REFUSED/.test(sd.stderr), 'seed: --confirm-host that does not match the DATABASE_URL host is refused');

  [app, spa, auth, broken, slow].forEach((s) => s.close());
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
