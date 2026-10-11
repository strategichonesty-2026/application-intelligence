// test_appIntelligence.cjs
// Offline tests for the Application Intelligence monitoring rules, checker and API.
// No database and no external network: the checker talks only to throwaway
// servers on 127.0.0.1, and the routes run against an in-memory fake pool.
// Run: node test_appIntelligence.cjs
const http = require('http');
const express = require('express');
const status = require('./server/services/appIntelligence/status.cjs');
const { validateApplicationInput } = require('./server/services/appIntelligence/validation.cjs');
const checker = require('./server/services/appIntelligence/checker.cjs');
const store = require('./server/services/appIntelligence/store.cjs');
const monitor = require('./server/services/appIntelligence/monitor.cjs');

const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`✅ ${label}`);
  else { console.log(`❌ FAIL: ${label}`); failures++; }
}

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

(async () => {
  // ── applyOutcome: incident lifecycle ──
  let st = { failStreak: 0, okStreak: 0, failStreakStartedAt: null };
  const t = (n) => new Date(Date.UTC(2026, 0, 1, 0, n));
  const fail = (n) => ({ outcome: 'failed', reason: 'timeout', checkedAt: t(n) });
  let r = status.applyOutcome(st, fail(1), null); st = r.state;
  assert(r.incident.action === 'open' && r.incident.severity === 'critical' && r.incident.firstDetectedAt.getTime() === t(1).getTime(), 'incident: ONE confirmed failure opens it (checks are manual/daily; the retry already confirmed it)');
  const open = { id: 1 };
  r = status.applyOutcome(st, fail(2), open); st = r.state;
  assert(r.incident.action === 'update', 'incident: a further failure updates the open incident, no second incident');
  r = status.applyOutcome(st, { outcome: 'degraded', reason: 'slow_response', checkedAt: t(3) }, open); st = r.state;
  assert(r.incident.action === 'none' && st.okStreak === 0, 'incident: a degraded result neither resolves nor escalates an open incident');
  r = status.applyOutcome(st, { outcome: 'ok', checkedAt: t(4) }, open); st = r.state;
  assert(r.incident.action === 'resolve' && r.incident.resolvedAt.getTime() === t(4).getTime(), 'incident: ONE good check resolves it');
  r = status.applyOutcome({ failStreak: 2, okStreak: 0, failStreakStartedAt: t(1) }, { outcome: 'monitor_error', checkedAt: t(8) }, null);
  assert(r.state.failStreak === 2 && r.incident.action === 'none', 'incident: monitoring-service errors neither extend nor reset a failure streak');
  r = status.applyOutcome({ failStreak: 0, okStreak: 0, failStreakStartedAt: null }, { outcome: 'inconclusive', checkedAt: t(8) }, null);
  assert(r.incident.action === 'none', 'incident: inconclusive checks are ignored');
  r = status.applyOutcome({ failStreak: 0, okStreak: 0, failStreakStartedAt: null }, { outcome: 'degraded', reason: 'slow_response', checkedAt: t(9) }, null);
  assert(r.incident.action === 'none', 'incident: a degraded result NEVER opens an incident');

  // ── deriveStatus ──
  const now = new Date('2026-01-01T12:00:00Z');
  const base = { enabled: true, checkType: 'health_endpoint', intervalSeconds: 300, lastCheckedAt: '2026-01-01T11:58:00Z', lastOutcome: 'ok', failStreak: 0 };
  assert(status.deriveStatus(base, now).status === 'healthy', 'status: health endpoint ok => healthy');
  assert(status.deriveStatus({ ...base, checkType: 'homepage' }, now).status === 'reachable', 'status: homepage 200 is NEVER healthy, only reachable');
  assert(status.deriveStatus({ ...base, enabled: false }, now).status === 'paused', 'status: disabled => paused');
  assert(status.deriveStatus({ ...base, lastCheckedAt: null }, now).status === 'pending', 'status: never checked => pending, not healthy');
  assert(status.deriveStatus({ ...base, lastCheckedAt: '2026-01-01T10:00:00Z' }, now).status === 'stale', 'status: old data => stale, not the old green');
  const first = status.deriveStatus({ ...base, lastOutcome: 'failed', failStreak: 1, lastSummary: 'No response within 8 seconds.' }, now);
  assert(first.status === 'unhealthy' && !first.suspect, 'status: one confirmed failed check => Unavailable (the check already retried)');
  assert(status.needsAttention('unknown', false, true) && !status.needsAttention('unknown', false, false), 'status: a suspect flag counts as needing attention; plain unable-to-verify does not');
  assert(status.deriveStatus({ ...base, lastOutcome: 'inconclusive', lastReason: 'not_found', lastHttpStatus: 404, failStreak: 0 }, now).status === 'unknown', 'status: 404 from a responding server => Unable to verify');
  assert(status.deriveStatus({ ...base, lastOutcome: 'failed', failStreak: 3 }, now).status === 'unhealthy', 'status: repeated failures => unhealthy');
  const dm = { ...base, mode: 'daily', lastCheckedAt: '2025-12-31T20:00:00Z' };
  assert(status.deriveStatus(dm, now).status === 'healthy', 'status: a daily app checked 16 h ago is NOT stale');
  assert(status.deriveStatus({ ...dm, lastCheckedAt: '2025-12-30T20:00:00Z' }, now).status === 'stale', 'status: a daily app unchecked for >36 h is stale (a run was missed)');
  assert(status.deriveStatus({ ...base, mode: 'manual', lastCheckedAt: '2025-06-01T00:00:00Z' }, now).status === 'healthy', 'status: a manual app is never marked stale; last-checked time is shown instead');
  assert(status.deriveStatus({ ...base, mode: 'manual_only', lastCheckedAt: '2025-06-01T00:00:00Z' }, now).status === 'healthy', 'status: a manual-only app is never marked stale');
  const mon = status.deriveStatus({ ...base, lastOutcome: 'monitor_error' }, now);
  assert(mon.status === 'unknown' && mon.monitoringFault, 'status: monitoring-service error => unknown + monitoringFault (not unhealthy)');
  assert(status.deriveStatus({ ...base, lastOutcome: 'inconclusive', lastReason: 'auth_required', lastHttpStatus: 401 }, now).status === 'unknown', 'status: auth-required => unknown');
  assert(status.needsAttention('unhealthy') && status.needsAttention('stale') && !status.needsAttention('healthy') && !status.needsAttention('reachable'), 'status: needsAttention set');
  assert(status.incidentHeadline(3) === 'Health check failed three times in a row', 'copy: plain-language incident headline');

  // ── validation ──
  assert(validateApplicationInput({ name: 'A', url: 'https://x.test' }).errors.length === 0, 'validate: minimal homepage app is valid');
  assert(validateApplicationInput({ name: 'A', url: 'ftp://x.test' }).errors.length === 1, 'validate: non-http URL rejected');
  assert(validateApplicationInput({ name: 'A', url: 'https://u:p@x.test' }).errors[0].includes('password'), 'validate: credentials in URL rejected');
  assert(validateApplicationInput({ name: 'A', url: 'https://x.test', checkType: 'health_endpoint' }).errors.length === 1, 'validate: health endpoint needs a path');
  assert(validateApplicationInput({ name: 'A', url: 'https://x.test', intervalSeconds: 5 }).errors.length === 1, 'validate: interval floor enforced');
  assert(validateApplicationInput({ intervalSeconds: 600 }, { partial: true }).value.intervalSeconds === 600, 'validate: partial update keeps only given fields');
  assert(Object.keys(validateApplicationInput({ enabled: false }, { partial: true }).value).join() === 'enabled', 'validate: partial update has no injected defaults');

  // ── address guard ──
  assert(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.16.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(checker.isPrivateAddress), 'guard: private/metadata addresses blocked');
  assert(!checker.isPrivateAddress('93.184.216.34') && !checker.isPrivateAddress('2606:4700::1111'), 'guard: public addresses allowed');

  // ── health body interpretation ──
  assert(checker.interpretHealthBody('{"status":"ok"}') === 'ok', 'body: status ok');
  assert(checker.interpretHealthBody('{"ok":true}') === 'ok', 'body: ok:true');
  assert(checker.interpretHealthBody('{"status":"degraded"}') === 'health_reports_degraded', 'body: degraded');
  assert(checker.interpretHealthBody('{"status":"down"}') === 'health_reports_unhealthy', 'body: down');
  assert(checker.interpretHealthBody('<html>OK</html>') === 'invalid_health_response', 'body: HTML on a health endpoint is not "healthy"');

  // ── checker against local servers ──
  const mode = { current: 'ok' };
  const target = await listen((req, res) => {
    if (req.url === '/health') {
      if (mode.current === 'ok') { res.setHeader('content-type', 'application/json'); return res.end('{"status":"ok","db":"secret-detail"}'); }
      if (mode.current === '500') { res.statusCode = 500; return res.end('Traceback (most recent call last): secret'); }
      if (mode.current === 'auth') { res.statusCode = 401; return res.end('no'); }
      if (mode.current === 'slow') return setTimeout(() => res.end('{"status":"ok"}'), 150);
      if (mode.current === 'hang') return; // never answers
    }
    if (req.url === '/loop') { res.statusCode = 302; res.setHeader('location', '/loop'); return res.end(); }
    res.end('<html>home</html>');
  });
  const app = { url: target.url, checkType: 'health_endpoint', checkPath: '/health', expectedStatus: 200, timeoutMs: 1000, slowThresholdMs: 100 };
  const opts = { allowPrivate: true };
  mode.current = 'ok'; let c = await checker.runHttpCheck({ ...app, slowThresholdMs: 5000 }, opts);
  assert(c.outcome === 'ok' && c.httpStatus === 200 && typeof c.responseMs === 'number', 'checker: healthy endpoint => ok with measured response time');
  assert(!JSON.stringify(c).includes('secret-detail'), 'checker: response body content is never returned');
  mode.current = '500'; c = await checker.runHttpCheck(app, opts);
  assert(c.outcome === 'failed' && c.reason === 'http_5xx' && !c.summary.includes('secret'), 'checker: 500 => failed, summary is sanitized');
  mode.current = 'auth'; c = await checker.runHttpCheck(app, opts);
  assert(c.outcome === 'inconclusive' && c.reason === 'auth_required', 'checker: 401 => inconclusive/auth_required');
  mode.current = 'slow'; c = await checker.runHttpCheck(app, opts);
  assert(c.outcome === 'degraded' && c.reason === 'slow_response', 'checker: slow answer => degraded');
  mode.current = 'hang'; c = await checker.runHttpCheck({ ...app, timeoutMs: 300 }, opts);
  assert(c.outcome === 'failed' && c.reason === 'timeout', 'checker: no answer => failed/timeout');
  c = await checker.runHttpCheck({ ...app, checkType: 'homepage', url: target.url + '/' }, opts);
  assert(c.outcome === 'ok', 'checker: homepage 200 => ok (status layer then caps it at "reachable")');
  c = await checker.runHttpCheck({ ...app, checkType: 'homepage', url: target.url + '/loop' }, opts);
  assert(c.outcome === 'failed' && c.reason === 'redirect_loop', 'checker: redirect loop detected');
  c = await checker.runHttpCheck({ ...app, url: target.url }, { allowPrivate: false });
  assert(c.outcome === 'inconclusive' && c.reason === 'blocked_target', 'checker: private target blocked by default; reported as could-not-verify, not as an app failure');
  const closed = await listen(() => {}); const deadUrl = closed.url; await new Promise((res) => closed.server.close(res));
  c = await checker.runHttpCheck({ ...app, url: deadUrl }, opts);
  assert(c.outcome === 'failed' && c.reason === 'connection_refused', 'checker: refused connection => failed');
  c = await checker.runHttpCheck(app, { allowPrivate: true, request: async () => { throw new Error('boom internal'); } });
  assert(c.outcome === 'monitor_error' && c.reason === 'monitor_internal' && !c.summary.includes('boom'), 'checker: unknown exception => monitor_error, message not leaked');
  target.server.close();

  // ── HTTP 200 without verified health, 404, slow answers, unusable health endpoints ──
  const plain = await listen((q, r) => {
    if (q.url === '/missing') { r.statusCode = 404; return r.end('not here'); }
    if (q.url === '/gone') { r.statusCode = 410; return r.end('gone'); }
    if (q.url === '/teapot') { r.statusCode = 418; return r.end('x'); }
    if (q.url === '/html-health') return r.end('<html><body>OK</body></html>');
    if (q.url === '/empty-health') return r.end('{}');
    if (q.url === '/slow-health') return setTimeout(() => { r.setHeader('content-type', 'application/json'); r.end('{"status":"ok"}'); }, 250);
    if (q.url === '/self-degraded') { r.setHeader('content-type', 'application/json'); return r.end('{"status":"degraded"}'); }
    if (q.url === '/self-down') { r.setHeader('content-type', 'application/json'); return r.end('{"status":"down"}'); }
    r.end('<html>home</html>');
  });
  const P = (over) => ({ url: plain.url, checkType: 'homepage', expectedStatus: 200, timeoutMs: 1000, slowThresholdMs: null, ...over });
  const popts = { allowPrivate: true };
  c = await checker.runHttpCheck(P({}), popts);
  assert(c.outcome === 'ok', 'homepage 200 => check passes ...');
  assert(status.deriveStatus({ enabled: true, checkType: 'homepage', intervalSeconds: 300, lastCheckedAt: new Date().toISOString(), lastOutcome: c.outcome, failStreak: 0 }).status === 'reachable', '... but the STATUS is only "reachable", never healthy');
  c = await checker.runHttpCheck(P({ url: plain.url + '/missing' }), popts);
  assert(c.outcome === 'inconclusive' && c.reason === 'not_found' && /not shown as an outage/.test(c.summary), '404 from a responding server => inconclusive/not_found, "not shown as an outage"');
  c = await checker.runHttpCheck(P({ url: plain.url + '/gone' }), popts);
  assert(c.outcome === 'inconclusive' && c.reason === 'not_found', '410 is also "not found", not a failure');
  c = await checker.runHttpCheck(P({ url: plain.url + '/teapot' }), popts);
  assert(c.outcome === 'inconclusive' && c.reason === 'client_error', 'other 4xx => inconclusive/client_error');
  let st2 = { failStreak: 0, okStreak: 0, failStreakStartedAt: null }; let opened = false;
  for (let i = 0; i < 6; i++) { const rr = status.applyOutcome(st2, { outcome: 'inconclusive', reason: 'not_found', checkedAt: new Date() }, null); st2 = rr.state; if (rr.incident.action === 'open') opened = true; }
  assert(!opened && st2.failStreak === 0, 'six 404s in a row never open an incident (the server is up)');
  const H = (path, over) => P({ checkType: 'health_endpoint', checkPath: path, ...over });
  c = await checker.runHttpCheck(H('/html-health'), popts);
  assert(c.outcome === 'inconclusive' && c.reason === 'invalid_health_response', 'health endpoint that answers 200 HTML => unable to verify (not healthy, not failed)');
  c = await checker.runHttpCheck(H('/empty-health'), popts);
  assert(c.outcome === 'inconclusive' && c.reason === 'invalid_health_response', 'health endpoint with no status field => unable to verify');
  c = await checker.runHttpCheck(H('/self-down'), popts);
  assert(c.outcome === 'failed' && c.reason === 'health_reports_unhealthy', 'health endpoint that reports "down" => failed (verified by the application itself)');
  c = await checker.runHttpCheck(H('/self-degraded'), popts);
  assert(c.outcome === 'degraded' && c.reason === 'health_reports_degraded', 'health endpoint that reports "degraded" => degraded (verified)');
  c = await checker.runHttpCheck(H('/slow-health'), popts);
  assert(c.outcome === 'ok' && c.responseMs >= 240, 'a slow answer is NOT degraded when no limit has been approved/set (no default threshold)');
  c = await checker.runHttpCheck(H('/slow-health', { slowThresholdMs: 100 }), popts);
  assert(c.outcome === 'degraded' && c.reason === 'slow_response', 'a slow answer IS degraded when the owner has set a limit');
  const slowSeq = []; st2 = { failStreak: 0, okStreak: 0, failStreakStartedAt: null };
  for (let i = 0; i < 3; i++) { const cc = await checker.runHttpCheck(H('/slow-health', { slowThresholdMs: 100 }), popts); const rr = status.applyOutcome(st2, cc, null); st2 = rr.state; slowSeq.push(rr.incident.action); }
  assert(slowSeq.join() === 'none,none,none', 'repeated slow answers never open an incident (degraded is visible, not an outage)');
  const oneSlow = status.applyOutcome({ failStreak: 0, okStreak: 0 }, { outcome: 'degraded', reason: 'slow_response', checkedAt: new Date() }, null);
  assert(oneSlow.incident.action === 'none', 'a single slow answer (like one 5.4 s sample) never opens an incident');
  const shapeRes = await checker.runHttpCheck(H('/self-degraded'), { ...popts, captureShape: true });
  assert(!('healthShape' in shapeRes), 'health shape is only captured for passing checks and only when requested');
  const sk = await listen((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ status: 'ok', db: 'secret-value-1', redis: 'x' })); });
  const sres = await checker.runHttpCheck({ url: sk.url, checkType: 'health_endpoint', checkPath: '/', expectedStatus: 200, timeoutMs: 1000 }, { ...popts, captureShape: true });
  assert(JSON.stringify(sres.healthShape.keys) === '["status","db","redis"]' && !JSON.stringify(sres).includes('secret-value-1'), 'health shape: field NAMES only, values never captured');
  sk.server.close();
  const sk2 = await listen((q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ status: 'ok', balance: 12, accountNumber: 'x' })); });
  const sres2 = await checker.runHttpCheck({ url: sk2.url, checkType: 'health_endpoint', checkPath: '/', expectedStatus: 200, timeoutMs: 1000 }, { ...popts, captureShape: true });
  assert(sres2.healthShape.sensitiveLooking && sres2.healthShape.keys.length === 0, 'health shape: a response with private-looking field names is flagged and its names are not even kept');
  sk2.server.close(); plain.server.close();

  // ── monitoring infrastructure failure must not look like every application failing ──
  const fiveApps = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}` }));
  const results = await Promise.all(fiveApps.map((a) => checker.runCheckWithRetry(a, { run: async () => ({ outcome: 'failed', reason: 'dns_failure', summary: 'x', httpStatus: null, responseMs: null, checkedAt: new Date() }), retryDelayMs: 1, hasEgress: async () => false })));
  assert(results.every((x) => x.outcome === 'monitor_error') && results.filter((x) => x.outcome === 'failed').length === 0, 'monitor offline: 5 applications all failing DNS => 0 application failures, 5 monitoring faults');
  const streaks = results.map((x) => status.applyOutcome({ failStreak: 2, okStreak: 0, failStreakStartedAt: new Date() }, x, null));
  assert(streaks.every((x) => x.incident.action === 'none' && x.state.failStreak === 2), 'monitor offline: no application streak advances and no incident opens');
  assert(status.deriveStatus({ enabled: true, checkType: 'health_endpoint', intervalSeconds: 300, lastCheckedAt: new Date().toISOString(), lastOutcome: 'monitor_error', failStreak: 2 }).monitoringFault === true, 'monitor offline: the dashboard labels it a monitoring issue');

  // ── retry + control probe (the monitor must not blame applications for its own dead network) ──
  const mkRun = (seq) => { let i = 0; const f = async () => seq[Math.min(i++, seq.length - 1)]; f.calls = () => i; return f; };
  const R = (outcome, reason) => ({ outcome, reason, summary: 'x', httpStatus: null, responseMs: null, checkedAt: new Date() });
  let run = mkRun([R('failed', 'timeout'), R('ok', null)]);
  c = await checker.runCheckWithRetry({}, { run, retryDelayMs: 1, hasEgress: async () => true });
  assert(c.outcome === 'ok' && run.calls() === 2, 'retry: a transient timeout is retried once and the success counts');
  run = mkRun([R('failed', 'http_5xx')]);
  c = await checker.runCheckWithRetry({}, { run, retryDelayMs: 1, hasEgress: async () => true });
  assert(c.outcome === 'failed' && run.calls() === 1, 'retry: an HTTP 500 answer is NOT retried');
  run = mkRun([R('failed', 'dns_failure')]);
  c = await checker.runCheckWithRetry({}, { run, retryDelayMs: 1, hasEgress: async () => true });
  assert(c.outcome === 'failed' && c.reason === 'dns_failure' && run.calls() === 2, 'retry: persistent DNS failure with a working monitor network => real application failure');
  run = mkRun([R('failed', 'dns_failure')]);
  c = await checker.runCheckWithRetry({}, { run, retryDelayMs: 1, hasEgress: async () => false });
  assert(c.outcome === 'monitor_error' && c.reason === 'monitor_no_egress' && c.summary.includes('says nothing about the application'), 'probe: DNS failure while the MONITOR has no internet => monitoring fault, not an application failure');
  run = mkRun([R('failed', 'http_5xx')]);
  c = await checker.runCheckWithRetry({}, { run, retryDelayMs: 1, hasEgress: async () => false });
  assert(c.outcome === 'failed', 'probe: an actual HTTP error response proves connectivity and stays a failure');
  const egress = require('./server/services/appIntelligence/egress.cjs');
  assert(await egress.hasEgress({ useCache: false, resolver: (h, cb) => cb(null, '1.1.1.1') }) === true, 'egress: resolvable control host => has egress');
  assert(await egress.hasEgress({ useCache: false, resolver: (h, cb) => cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) }) === false, 'egress: nothing resolvable => no egress');

  // ── monitoring-service health (derived from stored cycle time, independent of which process runs it) ──
  const T = new Date('2026-01-01T12:00:00Z'); const ago = (sec) => new Date(T.getTime() - sec * 1000).toISOString();
  const en = (createdSecAgo) => [{ enabled: true, createdAt: ago(createdSecAgo) }];
  assert(status.monitoringHealth(null, [], T).state === 'no_applications', 'health: no applications => nothing to monitor (not an alarm)');
  assert(status.monitoringHealth(ago(30), en(9999), T).state === 'ok', 'health: cycle 30s ago => ok');
  assert(status.monitoringHealth(ago(200), en(9999), T).state === 'ok', 'health: daily schedule, last pass 200 s ago => ok');
  assert(status.monitoringHealth(ago(37 * 3600), en(9999), T).state === 'stalled', 'health: daily schedule, no pass for >36 h => stalled');
  assert(status.monitoringHealth(null, en(9999), T, { schedule: 'off' }).state === 'manual', 'health: schedule off => manual, never stalled / never_ran');
  assert(status.monitoringHealth(null, en(60), T).state === 'ok', 'health: brand-new deployment, no cycle yet => not an alarm');
  assert(status.monitoringHealth(null, en(900), T).state === 'never_ran', 'health: apps registered 15 min ago and no cycle EVER => never_ran');
  assert(status.monitoringHealth(ago(30), [{ enabled: false, createdAt: ago(9999) }], T).state === 'no_applications', 'health: only paused apps => nothing to monitor');

  // ── schedule: OFF by default, creates no timer ──
  const lockedPool = { query: async () => ({ rows: [] }), connect: async () => ({ query: async (sql) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ got: false }] } : { rows: [] }), release() {} }) };
  assert(monitor.scheduleConfig({}).mode === 'off' && monitor.scheduleConfig({ APP_INTELLIGENCE_SCHEDULE: 'on' }).mode === 'off' && monitor.scheduleConfig({ APP_INTELLIGENCE_SCHEDULE: 'every-minute' }).mode === 'off', 'schedule: anything but exactly "daily" is OFF');
  assert(monitor.scheduleConfig({ APP_INTELLIGENCE_SCHEDULE: 'daily' }).hourUtc === 6 && monitor.scheduleConfig({ APP_INTELLIGENCE_SCHEDULE: 'daily', APP_INTELLIGENCE_DAILY_UTC_HOUR: '25' }).hourUtc === 6 && monitor.scheduleConfig({ APP_INTELLIGENCE_SCHEDULE: 'daily', APP_INTELLIGENCE_DAILY_UTC_HOUR: '3' }).hourUtc === 3, 'schedule: daily hour defaults to 06:00 UTC, invalid values fall back');
  const T0 = Date.UTC(2026, 0, 1, 5, 0, 0);
  assert(monitor.nextRunAt(T0, 6) === Date.UTC(2026, 0, 1, 6, 0, 0) && monitor.nextRunAt(Date.UTC(2026, 0, 1, 6, 0, 0), 6) === Date.UTC(2026, 0, 2, 6, 0, 0), 'schedule: next run is the next 06:00 UTC strictly in the future');
  const realSetTimeout = global.setTimeout; const realSetInterval = global.setInterval; let timers = 0;
  global.setTimeout = (...a) => { timers++; return realSetTimeout(...a); }; global.setInterval = (...a) => { timers++; return realSetInterval(...a); };
  const started = monitor.start(lockedPool, { env: {} });
  global.setTimeout = realSetTimeout; global.setInterval = realSetInterval;
  assert(started === false && timers === 0 && monitor.status({}).running === false && monitor.status({}).nextAutomaticRunAt === null, 'schedule OFF: start() creates no timer, no interval, nothing runs automatically');
  const DAILY = { APP_INTELLIGENCE_SCHEDULE: 'daily' };
  assert(monitor.start(lockedPool, { env: DAILY }) === true && monitor.status(DAILY).nextAutomaticRunAt, 'schedule DAILY: exactly one pending run is armed, and its time is reported');
  await monitor.stopAndDrain(500);
  assert(monitor.status(DAILY).running === false && monitor.status(DAILY).nextAutomaticRunAt === null, 'shutdown: stopAndDrain stops the scheduler and clears the pending run');

  // ── which applications each trigger may touch ──
  assert(monitor.isDaily({ enabled: true, mode: 'daily' }) && !monitor.isDaily({ enabled: true, mode: 'manual' }) && !monitor.isDaily({ enabled: true, mode: 'manual_only' }) && !monitor.isDaily({ enabled: false, mode: 'daily' }), 'daily pass: only enabled applications in mode daily');
  assert(monitor.isEligibleForCheckAll({ enabled: true, mode: 'manual' }) && monitor.isEligibleForCheckAll({ enabled: true, mode: 'daily' }) && !monitor.isEligibleForCheckAll({ enabled: true, mode: 'manual_only' }) && !monitor.isEligibleForCheckAll({ enabled: false, mode: 'manual' }), 'Check all: every enabled application EXCEPT manual-only ones');

  // ── routes against a fake store ──
  const origs = {};
  const apps = [{
    id: 'app-1', name: 'Shop', description: '', url: 'https://shop.test', environment: 'production', checkType: 'homepage', checkPath: '',
    expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, slowThresholdMs: 2000, enabled: true, lastCheckedAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(), lastOutcome: 'ok', lastReason: null, lastSummary: null, lastHttpStatus: 200, lastResponseMs: 120,
    failStreak: 0, okStreak: 4, failStreakStartedAt: null, createdAt: new Date().toISOString(),
  }, {
    id: 'app-2', name: 'API', description: '', url: 'https://api.test', environment: 'staging', checkType: 'health_endpoint', checkPath: '/health',
    expectedStatus: 200, intervalSeconds: 300, timeoutMs: 8000, slowThresholdMs: 2000, enabled: true, lastCheckedAt: new Date().toISOString(),
    lastSuccessAt: null, lastOutcome: 'failed', lastReason: 'timeout', lastSummary: 'No response', lastHttpStatus: null, lastResponseMs: null,
    failStreak: 3, okStreak: 0, failStreakStartedAt: null, createdAt: new Date().toISOString(),
  }];
  for (const k of Object.keys(store)) origs[k] = store[k];
  Object.assign(store, {
    listApplications: async () => apps, getApplication: async (_p, id) => apps.find((a) => a.id === id) || (id === 'app-new' ? { ...apps[0], id: 'app-new' } : null),
    latestIncidentByApp: async () => ({}), countOpenIncidents: async () => 1, lastCheckRecordedAt: async () => new Date().toISOString(),
    createApplication: async (_p, v) => ({ ...apps[0], ...v, id: 'app-new', lastCheckedAt: null, lastOutcome: null }),
    listTimeline: async (_p, f) => ({ items: [], total: 0, filters: f }), recentChecks: async () => [], getServiceState: async () => null,
  });
  const created = [];
  const fakeCheck = async () => { created.push(1); return { outcome: 'ok', reason: null, summary: null, httpStatus: 200, responseMs: 50, checkedAt: new Date() }; };
  store.getOpenIncident = async () => null; store.recordResult = async () => ({});
  process.env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuth.hashPassword('test owner password 123');
  process.env.APP_INTELLIGENCE_SESSION_SECRET = 'x'.repeat(48);
  const ownerToken = ownerAuth.issueToken(process.env).token;
  const router = require('./server/routes/appIntelligence.cjs')({}, { check: fakeCheck });
  const web = express(); web.use(express.json()); web.use('/ai', router);
  const srv = await listen(web); const apiBase = `${srv.url}/ai`;
  const j = async (path, init) => { const res = await fetch(apiBase + path, { headers: { 'content-type': 'application/json', authorization: `Bearer ${ownerToken}` }, ...init }); return { status: res.status, body: await res.json() }; };

  let res = await j('/summary');
  assert(res.body.counts.total === 2 && res.body.counts.reachableOnly === 1 && res.body.counts.healthy === 0, 'api: homepage-only app is counted as reachable, NOT healthy');
  assert(res.body.counts.attention === 1 && res.body.counts.activeIncidents === 1, 'api: attention and incident counts derive from data');
  res = await j('/applications');
  const shop = res.body.applications.find((a) => a.id === 'app-1');
  assert(shop.status === 'reachable' && shop.check.limitation.includes('never reported as Healthy'), 'api: application carries status + check limitation');
  assert(res.body.applications.find((a) => a.id === 'app-2').status === 'unhealthy', 'api: 3 failures => unhealthy');
  assert(res.body.applications.every((a) => !('failStreakStartedAt' in a)), 'api: internal columns not exposed');
  res = await j('/applications', { method: 'POST', body: JSON.stringify({ name: '', url: 'nope' }) });
  assert(res.status === 400 && res.body.errors.length === 2, 'api: invalid registration => 400 with each problem listed');
  res = await j('/applications', { method: 'POST', body: JSON.stringify({ name: 'New', url: 'https://new.test' }) });
  assert(res.status === 201 && created.length === 1, 'api: registration succeeds and triggers a first check');
  res = await j('/applications/missing');
  assert(res.status === 404, 'api: unknown application => 404');
  res = await j('/incidents?status=bogus&range=bogus&kind=bogus');
  assert(res.status === 200 && res.body.filters.status === undefined && res.body.filters.range === undefined, 'api: invalid filter values are ignored, not passed to SQL');
  res = await j('/applications/app-1', { method: 'PATCH', body: JSON.stringify({ checkType: 'health_endpoint' }) });
  assert(res.status === 400, 'api: switching to health endpoint without a path is rejected');
  res = await j('/applications/app-1/check', { method: 'POST' });
  assert(res.status === 429, 'api: manual check right after a check is rate-limited (cooldown)');
  apps[0].lastCheckedAt = new Date(Date.now() - 60000).toISOString();
  res = await j('/applications/app-1/check', { method: 'POST' });
  assert(res.status === 200 && res.body.result.outcome === 'ok', 'api: manual check returns the result');
  srv.server.close();
  Object.assign(store, origs);

  // ── SQL shape sanity (parameters, not interpolation) ──
  const seen = [];
  const fakePool = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ n: 0 }] }; } };
  await origs.listTimeline(fakePool, { application: "x'; DROP TABLE ai_incidents;--", status: 'open', range: '24h', page: 1, pageSize: 5 });
  assert(seen.every((q) => !q.sql.includes('DROP TABLE')), 'sql: user filter values are always bound parameters');

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
