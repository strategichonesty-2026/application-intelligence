// test_appIntelligence_latency.cjs: the repeated-timing helper, local servers only.
const http = require('http');
const m = require('./server/scripts/measureLatency.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const CANARY = 'BODY-CANARY-4111';
(async () => {
  let n = 0; let seenHeaders = null;
  const s = http.createServer((q, r) => { seenHeaders = q.headers; n++; setTimeout(() => { r.setHeader('set-cookie', `sid=${CANARY}`); r.end(CANARY); }, n === 2 ? 400 : 60); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s.address().port}/path?secret=${CANARY}`;
  const waits = []; const r = await m.measure(url, { count: 4, intervalMs: 1000, sleep: async (ms) => waits.push(ms) });
  assert(r.samples.length === 4 && r.samples.every((x) => x.status === 200), 'measure: 4 samples, each recorded with its status');
  assert(r.samples[1].total > r.samples[0].total + 250, 'measure: an intermittent slow sample stands out from the others');
  assert(r.summary.maxMs - r.summary.minMs === r.summary.spreadMs && r.summary.medianMs >= r.summary.minMs, 'measure: summary reports min / median / max / spread');
  assert(typeof r.summary.firstMs === 'number' && typeof r.summary.medianOfRestMs === 'number' && r.startedAt && r.node, 'measure: summary compares the first sample with the median of the rest, and records start time and Node version (descriptive only)');
  assert(r.samples.every((x) => x.wait !== null && x.wait <= x.total), 'measure: server wait time is separated from connection time');
  assert(waits.length === 3 && waits.every((w) => w >= 1000), 'measure: requests are spaced at least 1 s apart');
  assert(!JSON.stringify(r).includes(CANARY), 'measure: no body, cookie or query string is recorded');
  assert(!seenHeaders.cookie && !seenHeaders.authorization, 'measure: sends no cookies or credentials');
  assert((await m.measure(url, { count: 1, intervalMs: 1, sleep: async () => {} })).samples.length === 2, 'measure: count is clamped to at least 2');
  const dead = http.createServer(); await new Promise((x) => dead.listen(0, '127.0.0.1', x)); const dp = dead.address().port; await new Promise((x) => dead.close(x));
  const d = await m.measure(`http://127.0.0.1:${dp}/`, { count: 2, intervalMs: 1, sleep: async () => {}, timeoutMs: 500 });
  assert(d.samples.every((x) => x.status === null && x.error === 'ECONNREFUSED') && d.summary.answered === 0, 'measure: unreachable target is reported as errors, with no fake timings');
  s.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
