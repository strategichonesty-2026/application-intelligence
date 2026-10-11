// server/scripts/validateIntegrations.cjs
//
// READ-ONLY validation of the eight Phase 1 applications. No database, no credentials, no login,
// no writes. It makes ordinary unauthenticated GET requests (max 3 redirects) with the production
// checker. Response bodies are never printed or stored; redirect targets are reported as host only.
//
//   node server/scripts/validateIntegrations.cjs --json out.json --report report.md
//   node server/scripts/validateIntegrations.cjs --discover-health --json out.json --report report.md
//   node server/scripts/validateIntegrations.cjs --only problemsignal     # one application (name contains)
//
// When a registered URL is a deep path (/dashboard), the site root `/` is checked too.
//
// --discover-health additionally tries a short fixed list of common health paths per application
// (GET only, unauthenticated, at most 5 requests per app, 400 ms apart). A path counts as a CANDIDATE
// only if it answers 200 with JSON containing a recognised status word. An HTML page (a typical
// single-page-app fallback) is NOT a health endpoint. The unconfirmed application is skipped unless
// --include-unconfirmed is given. Owners must confirm what a candidate actually verifies.
//
// Must run on a machine with normal internet access; if a control probe shows it has none, it
// stops with exit code 2 rather than describing the machine's network as application failures.
'use strict';

const fs = require('fs');
const targets = require('./appIntelligenceTargets.cjs');
const { runCheckWithRetry, rawRequest } = require('../services/appIntelligence/checker.cjs');
const { hasEgress } = require('../services/appIntelligence/egress.cjs');
const { deriveStatus } = require('../services/appIntelligence/status.cjs');

const HEALTH_CANDIDATES = ['/health', '/healthz', '/api/health', '/api/healthz', '/status'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The five words used in the report. Never "healthy" unless a health endpoint verified it. */
function classify(check, checkType) {
  const derived = deriveStatus({ enabled: true, lastCheckedAt: check.checkedAt, intervalSeconds: 300, lastOutcome: check.outcome, lastReason: check.reason, lastHttpStatus: check.httpStatus, failStreak: check.outcome === 'failed' ? 1 : 0, checkType }, new Date());
  if (check.outcome === 'monitor_error') return { label: 'Unable to verify', why: 'The monitoring machine had a problem, not the application.' };
  if (check.outcome === 'inconclusive') return { label: 'Unable to verify', why: check.summary };
  if (check.outcome === 'failed') return { label: 'Unavailable', why: check.summary };
  if (check.outcome === 'degraded') return { label: 'Degraded', why: check.summary };
  return derived.status === 'healthy' ? { label: 'Healthy', why: 'A health endpoint answered with an OK status.' } : { label: 'Reachable (health not verified)', why: 'The URL answers. A homepage or login page does not prove the application works.' };
}

// A small allowlist of response headers that help tell WHO answered (the application, a framework, or a hosting
// platform's edge) without exposing anything sensitive. Values are shortened; cookies and auth headers are never read.
const HINT_HEADERS = ['server', 'x-powered-by', 'x-railway-fallback', 'x-vercel-error', 'cf-ray', 'content-type'];
function pickHints(headers) {
  if (!headers) return null;
  const out = {};
  for (const h of HINT_HEADERS) { if (headers[h] !== undefined) out[h] = h === 'cf-ray' ? 'present' : String(headers[h]).slice(0, 60); }
  if (headers['x-railway-request-id'] !== undefined) out['x-railway-request-id'] = 'present';
  if (headers['x-vercel-id'] !== undefined) out['x-vercel-id'] = 'present';
  return Object.keys(out).length ? out : null;
}

async function traced(app, opts = {}) {
  const hops = [];
  let hints = null;
  const request = async (url, o) => { const res = await rawRequest(url, o); hops.push({ status: res.status, host: new URL(url).host }); hints = pickHints(res.headers); return res; };
  const check = await runCheckWithRetry(app, { allowPrivate: opts.allowPrivate, captureShape: opts.captureShape, retryDelayMs: opts.retryDelayMs, hasEgress: opts.hasEgress, run: (a, o) => require('../services/appIntelligence/checker.cjs').runHttpCheck(a, { ...o, request }) });
  const last = hops[hops.length - 1];
  return { check, hints, redirects: Math.max(0, hops.length - 1), finalHost: last ? last.host : null, crossHost: hops.length > 1 && last.host !== hops[0].host };
}

async function validateOne(t, opts = {}) {
  // No response-time limit is applied: "Degraded" needs a VERIFIED condition (a health endpoint saying so, or a limit the owner approved).
  const base = { url: t.url, checkType: 'homepage', expectedStatus: 200, timeoutMs: opts.timeoutMs || 10000, slowThresholdMs: null };
  const startedAt = new Date().toISOString();
  const r = await traced(base, opts);
  const cls = classify(r.check, 'homepage');
  const out = {
    name: t.name, url: t.url, checkedAt: startedAt, checkType: 'homepage',
    classification: cls.label, explanation: cls.why, outcome: r.check.outcome, httpStatus: r.check.httpStatus, responseMs: r.check.responseMs,
    reason: r.check.reason, responseHints: r.hints, redirects: r.redirects, finalHost: r.finalHost, redirectedToDifferentHost: r.crossHost,
    unconfirmed: Boolean(t.unconfirmed), sensitive: Boolean(t.sensitive), note: t.note, healthCandidates: [],
  };
  // When the registered URL is a deep path (e.g. /dashboard), also look at the site root, so a 404 on
  // the deep path can be told apart from a missing application. Same single GET, same rules.
  const u = new URL(t.url);
  if (u.pathname !== '/') {
    const rr = await traced({ ...base, url: `${u.origin}/` }, opts);
    const rc = classify(rr.check, 'homepage');
    out.rootCheck = { url: `${u.origin}/`, classification: rc.label, httpStatus: rr.check.httpStatus, responseMs: rr.check.responseMs, explanation: rc.why, redirects: rr.redirects, redirectedToDifferentHost: rr.crossHost, finalHost: rr.finalHost };
  }
  if (opts.discover && (!t.unconfirmed || opts.includeUnconfirmed) && r.check.outcome !== 'monitor_error') {
    const origin = new URL(t.url).origin;
    for (const path of HEALTH_CANDIDATES) {
      await sleep(opts.discoverDelayMs ?? 400);
      const hc = await traced({ url: origin, checkType: 'health_endpoint', checkPath: path, expectedStatus: 200, timeoutMs: 8000, slowThresholdMs: null }, { ...opts, retryDelayMs: 500, captureShape: true });
      const why = hc.check.reason;
      const verdict = hc.check.outcome === 'ok' ? 'candidate' : hc.check.outcome === 'degraded' ? 'candidate (reports degraded)'
        : why === 'invalid_health_response' ? 'not a health endpoint (answers 200 but not with a JSON status)'
          : why === 'not_found' || why === 'client_error' ? 'not found / not available' : why === 'auth_required' ? 'requires authentication' : `no usable answer (${why})`;
      const shape = hc.check.healthShape || null;
      // Inferred only: field NAMES suggest what a candidate covers. An owner must confirm.
      const deps = shape && shape.keys.some((k) => /^(db|database|postgres|redis|queue|cache|storage|dependencies|checks|services|components)$/i.test(k));
      out.healthCandidates.push({
        path, httpStatus: hc.check.httpStatus, verdict, responseMs: hc.check.responseMs,
        fieldNames: shape ? shape.keys : null, looksLikePrivateData: shape ? shape.sensitiveLooking : false,
        coverage: verdict.startsWith('candidate') ? (shape && shape.sensitiveLooking ? 'UNSAFE: response has fields that look like private data; do not monitor this path' : deps ? 'inferred: reports dependency checks' : 'inferred: process-level only (no dependency fields seen)') : null,
      });
    }
  }
  return out;
}

function renderReport(results, meta = {}) {
  const L = [];
  L.push('# Application Intelligence — integration validation report', '');
  L.push(`Generated: ${meta.generatedAt || new Date().toISOString()}  ·  Machine had internet access: ${meta.egress === false ? 'NO (invalid run)' : 'yes (control probe passed)'}  ·  Mode: read-only, unauthenticated GET, no bodies stored`, '');
  L.push('| # | Application | Result | HTTP | ms | Redirects | Notes |', '|---|---|---|---|---|---|---|');
  results.forEach((r, i) => {
    const hint = r.responseHints && r.httpStatus >= 400 ? `Response hints: ${Object.entries(r.responseHints).map(([k, v]) => `${k}=${v}`).join(', ')}.` : '';
    const root = r.rootCheck ? `Root \`/\`: ${r.rootCheck.classification}, HTTP ${r.rootCheck.httpStatus ?? '–'}, ${r.rootCheck.responseMs ?? '–'} ms.` : '';
    const notes = [r.explanation, hint, root, r.redirectedToDifferentHost ? `redirects to ${r.finalHost}` : '', r.unconfirmed ? '**UNCONFIRMED application: owner must identify it**' : ''].filter(Boolean).join(' ');
    L.push(`| ${i + 1} | ${r.name} | **${r.classification}** | ${r.httpStatus ?? '–'} | ${r.responseMs ?? '–'} | ${r.redirects} | ${notes} |`);
  });
  if (results.some((r) => r.healthCandidates.length)) {
    L.push('', '## Health-endpoint discovery (candidates only; an owner must confirm what each verifies)', '');
    for (const r of results.filter((x) => x.healthCandidates.length)) {
      const good = r.healthCandidates.filter((c) => c.verdict.startsWith('candidate'));
      L.push(`- **${r.name}**: ${good.length ? good.map((c) => `\`${c.path}\` (${c.verdict}; ${c.coverage}; fields: ${(c.fieldNames || []).join(', ') || 'n/a'})`).join(', ') : 'no candidate found. A dedicated health endpoint must be added.'}`);
    }
  }
  L.push('', '"Reachable" never means healthy. "Unable to verify" covers sign-in walls (401/403) and problems on the monitoring machine.');
  return L.join('\n');
}

/** `--only text` keeps applications whose name contains the text (case-insensitive). */
function selectTargets(all, only, { includeManualOnly = false } = {}) {
  // Manual-only applications (Travel Intelligence Agent) are never requested by default: validating one
  // loads its pages. With the explicit flag only its dedicated health endpoint is requested.
  return all
    .filter((x) => !only || x.name.toLowerCase().includes(String(only).toLowerCase()))
    .filter((x) => includeManualOnly || x.mode !== 'manual_only')
    .map((x) => (x.mode === 'manual_only' ? { ...x, url: new URL(x.checkPath || '/health', x.url).toString(), noDiscover: true } : x));
}

async function main() {
  require('./lib/preflight.cjs').preflight();
  const argv = process.argv; const val = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
  const only = val('--only');
  const includeManualOnly = argv.includes('--include-manual-only');
  const chosen = selectTargets(targets, only, { includeManualOnly });
  if (!includeManualOnly && only && selectTargets(targets, only, { includeManualOnly: true }).length) {
    console.error(`"${only}" is a MANUAL-ONLY application and was NOT contacted. Add --include-manual-only to request its health endpoint (only that one URL) once.`);
    process.exit(1);
  }
  if (!(await hasEgress({ useCache: false }))) {
    console.error('INVALID RUN: this machine has no direct outbound internet access (control probe failed: no public control host could be resolved).');
    console.error('Any result would describe THIS machine, not the applications, so none are produced.');
    console.error('Run it from a machine with normal internet access (for example your own computer).');
    process.exit(2);
  }
  const opts = { discover: argv.includes('--discover-health'), includeUnconfirmed: argv.includes('--include-unconfirmed') };
  const results = [];
  if (!chosen.length) { console.error(`No application name contains "${only}". Names: ${targets.map((t) => t.name).join(' | ')}`); process.exit(1); }
  for (const t of chosen) results.push(await validateOne(t, t.noDiscover ? { ...opts, discover: false } : opts));
  results.forEach((r) => console.log(`${r.name}\n  ${r.url}\n  ${r.checkedAt}  =>  ${r.classification}  (http=${r.httpStatus ?? '-'}, ${r.responseMs ?? '-'} ms, redirects=${r.redirects}${r.redirectedToDifferentHost ? ` -> ${r.finalHost}` : ''})\n  ${r.explanation || ''}`));
  const md = renderReport(results, { egress: true });
  if (val('--json')) { fs.writeFileSync(val('--json'), JSON.stringify(results, null, 2)); console.log(`\nWrote ${val('--json')}`); }
  if (val('--report')) { fs.writeFileSync(val('--report'), md); console.log(`Wrote ${val('--report')}`); }
}

module.exports = { pickHints, validateOne, renderReport, classify, selectTargets, HEALTH_CANDIDATES };
if (require.main === module) main();
