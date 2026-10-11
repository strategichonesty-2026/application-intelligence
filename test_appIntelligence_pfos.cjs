// test_appIntelligence_pfos.cjs
// Data-isolation tests for monitoring an application that holds sensitive
// financial data (PFOS). Proves the monitoring path stores and returns
// OPERATIONAL METADATA ONLY: outcome, timings, status code, fixed summary text.
// Offline: a fake "PFOS" server on 127.0.0.1 and a recording fake database.
// Run: node test_appIntelligence_pfos.cjs
const http = require('http');
const checker = require('./server/services/appIntelligence/checker.cjs');
const monitor = require('./server/services/appIntelligence/monitor.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };

// Canaries: if any of these reaches a stored value or an API payload, isolation is broken.
const CANARIES = ['4111111111111111', 'ACCT-99887766', 'Checking balance: $48,210.55', 'Salary deposit ACME PAYROLL', 'SSN 123-45-6789', 'sess_TOPSECRETSESSION', 'bearer-LEAKME', 'invoice_2026_tax_return.pdf', 'jane.doe@private-mail.test'];
const FINANCIAL_JSON = JSON.stringify({ status: 'ok', accounts: [{ number: CANARIES[1], card: CANARIES[0], balance: CANARIES[2] }], transactions: [{ memo: CANARIES[3] }], owner: CANARIES[8], doc: CANARIES[7], ssn: CANARIES[4] });
let lastRequestHeaders = null;

const pfos = http.createServer((req, res) => {
  lastRequestHeaders = req.headers;
  res.setHeader('set-cookie', `session=${CANARIES[5]}; HttpOnly`);
  res.setHeader('x-account', CANARIES[1]);
  if (req.url === '/health') { res.setHeader('content-type', 'application/json'); return res.end(FINANCIAL_JSON); }
  if (req.url === '/dashboard') { res.statusCode = 302; res.setHeader('location', `/login?next=%2Fdashboard&token=${CANARIES[6]}&acct=${CANARIES[1]}`); return res.end(); }
  if (req.url.startsWith('/login')) return res.end(`<html><body>Sign in. ${CANARIES.join(' ')}</body></html>`);
  if (req.url === '/broken') { res.statusCode = 500; return res.end(`Traceback: SELECT * FROM accounts WHERE number='${CANARIES[1]}' balance ${CANARIES[2]}`); }
  if (req.url === '/forbidden') { res.statusCode = 403; return res.end(FINANCIAL_JSON); }
  res.end(`<html>${CANARIES.join(' ')}</html>`);
});

// A fake database that records every value the monitoring code tries to persist.
function recordingPool(appRow) {
  const writes = [];
  const client = {
    async query(sql, params = []) {
      if (/^\s*(INSERT|UPDATE)/i.test(sql)) writes.push(JSON.stringify(params));
      if (/FROM ai_applications WHERE id/.test(sql)) return { rows: [appRow] };
      if (/INSERT INTO ai_incidents|UPDATE ai_incidents/.test(sql)) return { rows: [{ id: 1, application_id: appRow.id, application_name: appRow.name, status: 'open', severity: 'critical', reason: 'x', summary: params[3] || 's', first_detected_at: new Date(), last_failure_at: new Date(), failure_count: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return { writes, query: client.query, connect: async () => client };
}
const row = (over) => ({ id: 'app-pfos', name: 'PFOS', description: '', url: '', environment: 'production', check_type: 'homepage', check_path: '', expected_status: 200, interval_seconds: 300, timeout_ms: 2000, slow_threshold_ms: 5000, enabled: true, fail_streak: 2, ok_streak: 0, fail_streak_started_at: new Date(), ...over });

(async () => {
  await new Promise((r) => pfos.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${pfos.address().port}`;
  const scenarios = [
    ['homepage behind a login redirect', { check_type: 'homepage', url: `${base}/dashboard` }],
    ['homepage returning financial HTML', { check_type: 'homepage', url: `${base}/` }],
    ['health endpoint that returns financial JSON', { check_type: 'health_endpoint', check_path: '/health', url: base }],
    ['server error whose body contains SQL and account data', { check_type: 'homepage', url: `${base}/broken` }],
    ['403 whose body contains financial JSON', { check_type: 'health_endpoint', check_path: '/forbidden', url: base }],
  ];
  for (const [label, over] of scenarios) {
    const r = row(over);
    const app = { id: r.id, name: r.name, url: r.url, checkType: r.check_type, checkPath: r.check_path, expectedStatus: 200, timeoutMs: 2000, slowThresholdMs: 5000 };
    const pool = recordingPool(r);
    const result = await monitor.checkApplication(pool, app, { allowPrivate: true, alertsConfigured: true, check: (a, o) => checker.runHttpCheck(a, o) });
    const stored = pool.writes.join('\n');
    const returned = JSON.stringify(result);
    const hit = CANARIES.filter((c) => stored.includes(c) || returned.includes(c));
    assert(pool.writes.length >= 2, `pfos[${label}]: a result was persisted (${result.outcome}/${result.reason || 'ok'})`);
    assert(hit.length === 0, `pfos[${label}]: no financial/session canary in stored values or the check result${hit.length ? ' LEAKED: ' + hit.join(',') : ''}`);
    assert(!/(cookie|authorization)/i.test(JSON.stringify(lastRequestHeaders || {})), `pfos[${label}]: monitor sent no cookies or credentials`);
  }

  // The only columns written for a check are the whitelisted operational fields.
  const r = row({ check_type: 'homepage', url: `${base}/` });
  const pool = recordingPool(r);
  await monitor.checkApplication(pool, { id: r.id, name: 'PFOS', url: r.url, checkType: 'homepage', expectedStatus: 200, timeoutMs: 2000, slowThresholdMs: 5000 }, { allowPrivate: true, alertsConfigured: false, check: (a, o) => checker.runHttpCheck(a, o) });
  const checkInsert = pool.writes[0];
  assert(JSON.parse(checkInsert).length === 8, 'pfos: check row has exactly 8 operational values (app id, time, outcome, reason, summary, http status, ms, trigger)');

  // Result objects expose only metadata keys.
  const res = await checker.runHttpCheck({ url: `${base}/health`, checkType: 'health_endpoint', checkPath: '', expectedStatus: 200, timeoutMs: 2000 }, { allowPrivate: true });
  assert(JSON.stringify(Object.keys(res).sort()) === JSON.stringify(['checkedAt', 'httpStatus', 'outcome', 'reason', 'responseMs', 'summary']), 'pfos: check result contains only metadata keys (no body, headers, final URL)');
  assert(!CANARIES.some((c) => JSON.stringify(res).includes(c)), 'pfos: health JSON with balances/accounts is reduced to a status word and discarded');

  // The registration form refuses a URL that smuggles account data or tokens in the query string.
  const { parseUrl } = require('./server/services/appIntelligence/validation.cjs');
  assert(Boolean(parseUrl(`https://pfos.example.com/dashboard?account=${CANARIES[1]}`, { allowPrivate: false }).error), 'pfos: registering a URL with a query string (account ids, tokens) is refused');

  pfos.close();
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
