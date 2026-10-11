// server/scripts/measureLatency.cjs
//
// READ-ONLY repeated timing of ONE URL, to tell a persistently slow application from an
// intermittently slow one, and to show WHERE the time goes. It makes plain unauthenticated GET
// requests and reads only the response status and timings. Response bodies are never read, printed
// or stored; redirects are not followed (the first response is what is timed).
//
//   node server/scripts/measureLatency.cjs <url> [--count 5] [--interval 3000] [--json out.json]
//
// Per request it records phases from Node's socket events:
//   dns       time to resolve the name
//   connect   TCP connect
//   tls       TLS handshake (https only)
//   wait      from request sent until the first byte of the response (time the SERVER takes)
//   total     from start until response headers arrive
// A large `wait` with small dns/connect/tls points at the server; large dns/connect/tls points at the
// network path. It does NOT tell you why the server is slow (for example a cold start); that needs
// evidence from the platform's own logs/metrics. Every request opens a NEW connection (no keep-alive), so
// connect and tls are paid each time; dns can read 0-2 ms after the first sample because your operating
// system caches name lookups, which is normal.
// Limits: 2..20 requests, at least 1000 ms apart, 15 s timeout each.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const { hasEgress } = require('../services/appIntelligence/egress.cjs');

function timeOnce(urlString, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint();
    const ms = () => Number((process.hrtime.bigint() - t0) / 1000000n);
    const m = { dns: null, connect: null, tls: null, wait: null, total: null };
    let tConnected = null; let tSent = null;
    const req = lib.request(url, { method: 'GET', agent: false, headers: { 'user-agent': 'ApplicationIntelligence-Latency/1.0', accept: '*/*' } }, (res) => {
      m.total = ms(); m.wait = tSent !== null ? m.total - tSent : null;
      res.destroy();
      resolve({ at: new Date().toISOString(), status: res.statusCode, ...m });
    });
    req.on('socket', (sock) => {
      let tDns = null; let tTcp = null;
      sock.on('lookup', () => { tDns = ms(); m.dns = tDns; });
      sock.on('connect', () => { tTcp = ms(); m.connect = tTcp - (tDns ?? 0); tConnected = tTcp; if (url.protocol !== 'https:') tSent = ms(); });
      sock.on('secureConnect', () => { const t = ms(); m.tls = t - (tConnected ?? 0); tSent = t; });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT_CHECK' })), timeoutMs);
    req.on('error', (e) => { clearTimeout(timer); resolve({ at: new Date().toISOString(), status: null, error: e.code === 'ETIMEDOUT_CHECK' ? 'timeout' : (e.code || 'error'), ...m, total: ms() }); });
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function summarise(samples) {
  const ok = samples.filter((s) => s.total !== null && !s.error).map((s) => s.total).sort((a, b) => a - b);
  if (!ok.length) return { samples: samples.length, answered: 0 };
  const median = ok[Math.floor(ok.length / 2)];
  const answered = samples.filter((x) => x.total !== null && !x.error);
  const rest = answered.slice(1).map((x) => x.total).sort((a, b) => a - b);
  return {
    samples: samples.length, answered: ok.length, minMs: ok[0], medianMs: median, maxMs: ok[ok.length - 1], spreadMs: ok[ok.length - 1] - ok[0],
    // Descriptive only: how the first request compares with the others. It does not say WHY.
    firstMs: answered[0] ? answered[0].total : null, medianOfRestMs: rest.length ? rest[Math.floor(rest.length / 2)] : null,
  };
}

async function measure(urlString, { count = 5, intervalMs = 3000, timeoutMs, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const n = Math.min(Math.max(count, 2), 20); const gap = Math.max(intervalMs, 1000);
  const samples = [];
  for (let i = 0; i < n; i++) { if (i) await sleep(gap); samples.push(await timeOnce(urlString, { timeoutMs })); }
  return { url: `${new URL(urlString).origin}${new URL(urlString).pathname}`, startedAt: new Date().toISOString(), node: process.versions.node, samples, summary: summarise(samples) };
}

async function main() {
  require('./lib/preflight.cjs').preflight();
  const argv = process.argv; const val = (f, d) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : d; };
  const target = argv[2];
  if (!target || !/^https?:\/\//.test(target)) { console.error('usage: node server/scripts/measureLatency.cjs <https://url> [--count 5] [--interval 3000] [--json out.json]'); process.exit(1); }
  // Manual-only applications must not be requested repeatedly, and never at a page that does real work.
  const manual = require('./appIntelligenceTargets.cjs').filter((t) => t.mode === 'manual_only' && new URL(t.url).host === new URL(target).host);
  if (manual.length && !argv.includes('--allow-manual-only')) {
    console.error(`REFUSED: ${manual[0].name} is MANUAL-ONLY. Repeated timing requests are not made to it by default.`);
    console.error('If you really intend to run a deliberate, owner-run measurement, add --allow-manual-only (keep --count small and prefer its /health URL).');
    process.exit(1);
  }
  if (!(await hasEgress({ useCache: false }))) {
    console.error('INVALID RUN: this machine has no direct outbound internet access (control probe failed), so any timing would describe this machine, not the application.');
    process.exit(2);
  }
  const r = await measure(target, { count: Number(val('--count', 5)), intervalMs: Number(val('--interval', 3000)) });
  console.log(r.url);
  r.samples.forEach((s, i) => console.log(`  #${i + 1} ${s.at}  ${s.status ?? s.error}  total=${s.total}ms  dns=${s.dns ?? '-'} connect=${s.connect ?? '-'} tls=${s.tls ?? '-'} wait(server)=${s.wait ?? '-'}`));
  console.log(`  summary: ${JSON.stringify(r.summary)}`);
  if (val('--json')) fs.writeFileSync(val('--json'), JSON.stringify(r, null, 2));
}

module.exports = { measure, timeOnce, summarise };
if (require.main === module) main();
