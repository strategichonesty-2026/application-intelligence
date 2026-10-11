// test_appIntelligence_local_workflow.cjs
// The local, read-only commands must (1) refuse clearly outside the repository root, (2) run without
// `npm install`, (3) never accept or print a secret, (4) tell an old checkout exactly how to fix itself,
// and (5) warn, not block, on Node older than 20. Local servers only; no external network.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const pre = require('./server/scripts/lib/preflight.cjs');
const cli = require('./server/scripts/lib/cli.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const ROOT = __dirname;
const run = (args, { cwd = ROOT, env = {}, input } = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, args, { cwd, env: { PATH: process.env.PATH, ...env } });
  let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
  if (input) c.stdin.end(input); else c.stdin.end();
  c.on('close', (code) => resolve({ code, out }));
});
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const SCRIPTS = ['validateIntegrations', 'measureLatency', 'checkBundleKeyExposure', 'seedApplications', 'aiDoctor', 'hashOwnerPassword'];

(async () => {
  // ── 1. wrong directory ──
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-elsewhere-'));
  const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-other-')); fs.writeFileSync(path.join(otherProject, 'package.json'), JSON.stringify({ name: 'prisma-land-map' }));
  for (const name of SCRIPTS) {
    const script = path.join(ROOT, 'server/scripts', `${name}.cjs`);
    let r = await run([script, 'https://example.test/'], { cwd: elsewhere });
    assert(r.code === 3 && /WRONG DIRECTORY/.test(r.out) && r.out.includes(ROOT) && /cd "/.test(r.out), `${name}: run from an empty directory => exit 3, says WRONG DIRECTORY, names the repository root and the cd command`);
    r = await run([script, 'https://example.test/'], { cwd: otherProject });
    assert(r.code === 3 && /different project: "prisma-land-map"/.test(r.out), `${name}: run from ANOTHER project => exit 3 and names that project`);
  }
  assert(!fs.existsSync(path.join(elsewhere, 'out.json')) && fs.readdirSync(elsewhere).length === 0, 'wrong directory: no output file was written there');
  assert(pre.requireRepoRoot({ cwd: ROOT, exit: () => { throw new Error('should not exit'); } }) === true, 'preflight: the repository root passes');

  // ── 2. Node notice (warn, never block) ──
  const lines = []; const warned = pre.nodeNotice({ version: '18.20.8', log: (m) => lines.push(m) });
  assert(warned && /Node 18\.20\.8 detected/.test(lines[0]) && /requires Node 20/.test(lines[0]) && /continues/.test(lines[1]) && /Nothing on your machine is changed/.test(lines[2]), 'node notice: Node 18 gets a one-time explanation and the command CONTINUES');
  assert(!pre.nodeNotice({ version: '20.0.0', log: () => { throw new Error('no notice expected'); } }) && !pre.nodeNotice({ version: '22.22.0', log: () => { throw new Error('no notice expected'); } }), 'node notice: Node 20 and 22 get no notice');
  assert(pre.nodeMajor('18.20.8') === 18 && pre.nodeMajor('20.20.0') === 20, 'node notice: version parsing');

  // ── 3. runs WITHOUT npm install (no node_modules anywhere) ──
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-copy-'));
  fs.cpSync(path.join(ROOT, 'server'), path.join(copy, 'server'), { recursive: true, filter: (s) => !s.includes('node_modules') && !/\.(bak|backup)/.test(s) });
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: pre.PROJECT_NAME }));
  assert(!fs.existsSync(path.join(copy, 'node_modules')), 'setup: the copy has no node_modules');
  const KEY = 'sk_live_LOCALWORKFLOW_9f8e7d6c5b4a39281706';
  const site = await listen((q, r) => { if (q.url === '/') return r.end('<script src="/a.js"></script>'); if (q.url === '/a.js') return r.end(`var k="${KEY}"; fetch(u,{headers:{"x-api-key":k}})`); r.statusCode = 404; r.end(); });
  const url = `http://127.0.0.1:${site.address().port}/`;
  let r = await run(['server/scripts/measureLatency.cjs', url, '--count', '2', '--interval', '1000'], { cwd: copy, env: { APP_INTELLIGENCE_EGRESS_PROBE: 'off' } });
  assert(r.code === 0 && /summary:/.test(r.out) && /wait\(server\)=/.test(r.out), 'measureLatency: works from a checkout WITHOUT npm install');
  r = await run(['server/scripts/validateIntegrations.cjs', '--only', 'zzz'], { cwd: copy, env: { APP_INTELLIGENCE_EGRESS_PROBE: 'off' } });
  assert(r.code === 1 && /No application name contains/.test(r.out), 'validateIntegrations: starts without npm install (clear error for a bad --only)');
  r = await run(['server/scripts/seedApplications.cjs'], { cwd: copy });
  assert(r.code === 0 && /dry run/.test(r.out) && /Nothing was written/.test(r.out), 'seedApplications: the dry run needs no npm install');

  // ── 4. key handling: never on the command line, never printed ──
  r = await run(['server/scripts/checkBundleKeyExposure.cjs', '--key', KEY, url]);
  assert(r.code === 2 && /REFUSED/.test(r.out) && !r.out.includes(KEY) && !r.out.includes(KEY.slice(0, 10)), 'checkBundleKeyExposure: --key <value> is refused and the value is not echoed');
  r = await run(['server/scripts/checkBundleKeyExposure.cjs', `--api-key=${KEY}`, url]);
  assert(r.code === 2 && !r.out.includes(KEY), 'checkBundleKeyExposure: --api-key=<value> is refused too');
  assert(cli.secretOnCommandLine(['--password', 'x']) && !cli.secretOnCommandLine(['--prompt', 'https://x.test/']), 'cli: secret-flag detection');
  r = await run(['server/scripts/checkBundleKeyExposure.cjs', '--prompt', url]);
  assert(r.code === 1 && /interactive terminal/.test(r.out), '--prompt without a terminal fails clearly instead of hanging');
  r = await run(['server/scripts/checkBundleKeyExposure.cjs', url], { env: { API_SECRET_KEY: KEY } });
  assert(r.code === 0 && /contains key: YES/.test(r.out) && /from the API_SECRET_KEY environment variable/.test(r.out) && !r.out.includes(KEY) && !r.out.includes(KEY.slice(0, 10)) && !r.out.includes(KEY.slice(-10)), 'checkBundleKeyExposure: via environment variable it reports YES and prints no part of the key');
  assert(/does not show the key was used/.test(r.out), 'checkBundleKeyExposure: the output states what a YES does not establish');
  r = await run(['server/scripts/checkBundleKeyExposure.cjs', url]);
  assert(r.code === 0 && /No key was provided/.test(r.out) && /--prompt/.test(r.out), 'checkBundleKeyExposure: with no key it says so and points to --prompt');
  r = await run(['server/scripts/checkBundleKeyExposure.cjs']);
  assert(r.code === 1 && /usage:/.test(r.out), 'checkBundleKeyExposure: no URL => usage message');

  // ── 5. doctor ──
  const { REQUIRED_FILES } = require('./server/scripts/aiDoctor.cjs');
  assert(REQUIRED_FILES.every((f) => fs.existsSync(path.join(ROOT, f))), `doctor: all ${REQUIRED_FILES.length} files it requires exist on this branch`);
  fs.rmSync(path.join(copy, 'server/scripts/measureLatency.cjs'));
  r = await run(['server/scripts/aiDoctor.cjs'], { cwd: copy, env: { APP_INTELLIGENCE_EGRESS_PROBE: 'off' } });
  assert(r.code === 1 && /MISSING files: server\/scripts\/measureLatency\.cjs/.test(r.out) && /git pull origin main/.test(r.out), 'doctor: an old checkout missing a script is told exactly: git pull origin main');

  site.close();
  [elsewhere, otherProject, copy].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
