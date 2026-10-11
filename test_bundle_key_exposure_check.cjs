// test_bundle_key_exposure_check.cjs: the read-only checker the owner runs against a live site. Local servers only.
// It must report whether the key is in public JS, detect a Cloudflare Access redirect, and NEVER print the key.
const http = require('http');
const { spawn } = require('child_process');
const runCli = (args, env) => new Promise((resolve) => { const c = spawn(process.execPath, args, { env: { ...process.env, ...env } }); let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; }); c.on('close', (status) => resolve({ status, stdout: out, stderr: '' })); }); // async: a sync spawn would block this process's own test server
const { checkSite } = require('./server/scripts/checkBundleKeyExposure.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const KEY = 'sk_live_DUMMYKEY_9f8e7d6c5b4a39281706';
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });

(async () => {
  const leaky = await listen((q, r) => {
    if (q.url === '/') return r.end('<html><script type="module" src="/assets/index-abc.js"></script></html>');
    if (q.url === '/assets/index-abc.js') return r.end(`const h={"x-api-key":"${KEY}"};import("./console-xyz.js");`);
    if (q.url === '/assets/console-xyz.js') return r.end('export default function(){return "no secret here"}');
    r.statusCode = 404; r.end();
  });
  const url = `http://127.0.0.1:${leaky.address().port}/`;
  let res = await checkSite(url, { key: KEY });
  const main = res.files.find((f) => f.file.includes('index-abc')); const chunk = res.files.find((f) => f.file.includes('console-xyz'));
  assert(res.files.length === 2 && main.containsKey && !chunk.containsKey && main.mentionsKeyHeaderName, 'checker: finds the key in the main file, follows the lazy chunk, and sees the chunk is clean');
  assert(/IS present/.test(res.summary) && !res.access.protected && /no Cloudflare Access redirect/.test(res.access.evidence), 'checker: summary says the key is public; reports Access NOT detected');
  assert(!JSON.stringify(res).includes(KEY), 'checker: the result object never contains the key');

  const cli = await runCli(['server/scripts/checkBundleKeyExposure.cjs', url], { API_SECRET_KEY: KEY });
  const out = cli.stdout + cli.stderr;
  assert(cli.status === 0 && /contains key: YES/.test(out) && /Cloudflare Access: NOT detected/.test(out), 'cli: prints yes/no per file and the Access finding');
  assert(!out.includes(KEY) && !out.includes(KEY.slice(0, 8)) && !out.includes(KEY.slice(-8)), 'cli: output contains no part of the key (not whole, not first 8, not last 8 characters)');

  const clean = await listen((q, r) => { if (q.url === '/') return r.end('<script src="/a.js"></script>'); if (q.url === '/a.js') return r.end('console.log("hi")'); r.statusCode = 404; r.end(); });
  res = await checkSite(`http://127.0.0.1:${clean.address().port}/`, { key: KEY });
  assert(res.files.length === 1 && !res.files[0].containsKey && /NOT found/.test(res.summary), 'checker: a clean bundle is reported as not containing the key');
  res = await checkSite(`http://127.0.0.1:${clean.address().port}/`, { key: undefined });
  assert(/No key was supplied/.test(res.summary), 'checker: without a key it says only the header name could be checked');

  const gated = await listen((q, r) => { r.statusCode = 302; r.setHeader('location', 'https://example-team.cloudflareaccess.com/cdn-cgi/access/login/x'); r.end(); });
  res = await checkSite(`http://127.0.0.1:${gated.address().port}/`, { key: KEY });
  assert(res.access.protected && res.files.length === 0 && /cloudflareaccess\.com/.test(res.access.evidence), 'checker: an anonymous redirect to cloudflareaccess.com is reported as protected (and no JS is fetched)');

  const sneakyHost = await listen((q, r) => { r.statusCode = 302; r.setHeader('location', 'https://evil-cloudflareaccess.com.attacker.test/x'); r.end(); });
  res = await checkSite(`http://127.0.0.1:${sneakyHost.address().port}/`, { key: KEY });
  assert(!res.access.protected, 'checker: a lookalike host (evil-cloudflareaccess.com.attacker.test) is NOT treated as Cloudflare Access');

  const cross = await listen((q, r) => r.end('<script src="https://other.example.test/x.js"></script>'));
  res = await checkSite(`http://127.0.0.1:${cross.address().port}/`, { key: KEY, fetchImpl: async (u, o) => { if (!u.startsWith('http://127.0.0.1')) throw new Error('must not fetch third-party origins'); return fetch(u, o); } });
  assert(res.files.length === 0, 'checker: only same-origin JavaScript is downloaded');
  [leaky, clean, gated, sneakyHost, cross].forEach((s) => s.close());
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
