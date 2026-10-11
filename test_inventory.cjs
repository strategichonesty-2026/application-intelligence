// test_inventory.cjs
// Secrets & Subscriptions: metadata-only inventory. Offline (in-memory store, local server, dummy values) plus a
// Postgres round trip when AI_TEST_DATABASE_URL is set. Run: node test_inventory.cjs
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const inv = require('./server/services/appIntelligence/inventory.cjs');
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
const targets = require('./server/scripts/inventoryTargets.cjs');

let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = Date.UTC(2026, 9, 12); // 2026-10-12

(async () => {
  // ── 1. secret values are rejected everywhere ──
  const shapes = {
    hex64: crypto.randomBytes(32).toString('hex'), skKey: 'sk_' + crypto.randomBytes(16).toString('hex'), anthropic: 'sk-ant-api03-' + crypto.randomBytes(20).toString('base64url'),
    bearer: 'Bearer ' + crypto.randomBytes(18).toString('base64url'), jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.' + crypto.randomBytes(12).toString('base64url'),
    awsId: 'AKIA' + 'ABCDEFGHIJKLMNOP', pem: '-----BEGIN PRIVATE KEY-----', hash: 'scrypt$65536$8$2$abc$def', tg: '123456789:AA' + crypto.randomBytes(24).toString('base64url'),
    urlCreds: 'https://user:hunter2hunter2@example.com/x', queryKey: 'https://example.com/billing?api_key=abcdef', longToken: crypto.randomBytes(30).toString('base64url') + 'Zq9',
  };
  const bad = Object.entries(shapes).filter(([, v]) => !inv.looksLikeSecret(v)).map(([k]) => k);
  assert(bad.length === 0, `secret filter: recognises ${Object.keys(shapes).length} secret shapes${bad.length ? ' (missed: ' + bad.join(',') + ')' : ''}`);
  const fine = ['Stored in password manager entry "Provider API key"', 'Railway variable API_SECRET_KEY on service example-api', 'API_SECRET_KEY', 'https://dashboard.example.com/billing', 'strategic-honesty-media-studio-production.up.railway.app', 'Verified on the Railway variables page on 2026-10-12'];
  assert(fine.every((t) => !inv.looksLikeSecret(t)), 'secret filter: ordinary references, variable names and URLs are accepted');
  for (const [name, val] of Object.entries(shapes)) {
    for (const field of ['name', 'purpose', 'storageReference', 'evidence', 'migrationNotes']) {
      const r = inv.validateCredential({ name: 'x', [field]: field === 'name' ? val : `see ${val}` });
      if (!(r.errors.length === 1 && /looks like a secret value/.test(r.errors[0]) && !r.errors[0].includes(val))) { assert(false, `credential field ${field} accepted or echoed a ${name}`); }
    }
  }
  const nested = inv.validateCredential({ name: 'x', consumers: [{ name: 'app', impact: shapes.hex64 }] });
  assert(nested.errors.length === 1 && /consumers\[0\]\.impact/.test(nested.errors[0]) && !nested.errors[0].includes(shapes.hex64), 'secret filter: a secret hidden inside a consumer entry is caught, and the error names the field, never the content');
  assert(inv.validateCredential({ name: 'x', envVarName: shapes.hex64 }).errors.length >= 1 && inv.validateCredential({ name: 'x', envVarName: 'has space' }).errors.length === 1, 'env var NAME must be a plain identifier, so a value cannot be smuggled in as a name');
  const sub = inv.validateSubscription({ provider: 'P', notes: shapes.skKey });
  assert(sub.errors.length === 1 && !sub.errors[0].includes(shapes.skKey), 'subscription notes are screened too');
  assert(inv.validateSubscription({ provider: 'P', accountUrl: shapes.queryKey }).errors.length >= 1 && inv.validateSubscription({ provider: 'P', accountUrl: 'http://x.example/billing' }).errors.length === 1 && inv.validateSubscription({ provider: 'P', accountUrl: 'https://x.example/billing' }).errors.length === 0, 'billing URL: https only, no query string, no credentials');

  // ── 2. no claim without evidence ──
  const base = { name: 'k', status: 'unknown', verification: 'unknown', evidence: '', lastVerifiedAt: null, lastRotatedAt: null };
  assert(inv.checkCredentialClaims({ ...base, verification: 'verified' }).length === 1 && inv.checkCredentialClaims({ ...base, verification: 'verified', evidence: 'Railway variables page', lastVerifiedAt: '2026-10-11' }).length === 0, 'claims: "verified" needs evidence AND a date');
  assert(inv.checkCredentialClaims({ ...base, status: 'revoked' }).length === 1 && inv.checkCredentialClaims({ ...base, status: 'revoked', evidence: 'deleted in provider dashboard', lastVerifiedAt: '2026-10-11' }).length === 0, 'claims: "revoked" needs evidence AND a verification date');
  assert(inv.checkCredentialClaims({ ...base, lastRotatedAt: '2026-10-01' }).length === 1 && inv.checkCredentialClaims({ ...base, lastRotatedAt: '2026-10-01', evidence: 'new key created, old deleted' }).length === 0, 'claims: a rotation date needs evidence');
  assert(inv.validateCredential({ name: 'k', lastRotatedAt: '2026-10-13' }, { now: NOW }).errors.length === 1 && inv.validateCredential({ name: 'k', lastVerifiedAt: '2026-10-13' }, { now: NOW }).errors.length === 1 && inv.validateCredential({ name: 'k', nextReviewAt: '2026-10-13' }, { now: NOW }).errors.length === 0, 'claims: rotated/verified dates cannot be in the future; a review date can');
  assert(inv.validateCredential({ name: 'k', status: 'rotated' }).errors.length === 1 && inv.validateCredential({ name: 'k', verification: 'sure' }).errors.length === 1, 'status and evidence level only accept the defined values');
  assert(inv.checkSubscriptionClaims({ priceBasis: 'verified', price: 20 }).length === 1 && inv.checkSubscriptionClaims({ priceBasis: 'verified', price: 20, lastVerifiedAt: '2026-10-01' }).length === 0 && inv.checkSubscriptionClaims({ priceBasis: 'estimate', price: null }).length === 1 && inv.checkSubscriptionClaims({ priceBasis: 'unknown', price: 5 }).length === 1, 'claims: a verified price needs a date; a basis needs a price; a price needs a basis');

  // ── 3. cost calculations ──
  const S = (o) => ({ status: 'active', currency: 'USD', priceBasis: 'verified', billingFrequency: 'monthly', price: 10, ...o });
  const costs = inv.costSummary([
    S({ price: 20 }), S({ price: 120, billingFrequency: 'annual' }), S({ price: 30, billingFrequency: 'quarterly', priceBasis: 'estimate' }),
    S({ price: 8, currency: 'EUR' }), S({ billingFrequency: 'usage', price: null, priceBasis: 'unknown' }), S({ price: null, priceBasis: 'unknown' }),
    S({ status: 'cancelled', price: 999 }), S({ status: 'unknown', price: 500 }), S({ billingFrequency: 'free', price: null, priceBasis: 'verified' }),
  ]);
  const u = costs.byCurrency.USD;
  assert(u.monthlyVerified === 30 && u.annualVerified === 360 && u.monthlyEstimated === 10 && u.annualEstimated === 120, `costs: monthly = 20 + 120/12 verified (30), quarterly 30/3 estimated (10), annual x12 (got ${u.monthlyVerified}/${u.monthlyEstimated})`);
  assert(costs.byCurrency.EUR.monthlyVerified === 8 && !('EUR' in {}) && Object.keys(costs.byCurrency).length === 2, 'costs: currencies are never mixed');
  assert(costs.missingPrice === 1 && costs.usageBased === 1 && costs.unknownStatus === 1 && costs.cancelledCount === 1 && costs.total === 9, 'costs: missing price, usage-based, unknown-status and cancelled rows are counted separately and kept out of the totals');
  assert(u.verifiedCount === 3 && u.estimatedCount === 1, 'costs: verified and estimated rows are tallied apart (free plan counts as a verified zero)');
  assert(Object.keys(inv.costSummary([]).byCurrency).length === 0, 'costs: no data => no figures (nothing invented)');

  // ── 4. dates, summaries, dependency view ──
  const up = inv.upcomingDates([{ id: 'a', provider: 'A', status: 'active', renewalDate: '2026-10-20' }, { id: 'b', provider: 'B', status: 'active', renewalDate: '2026-12-31' }, { id: 'c', provider: 'C', status: 'active', trialEndsAt: '2026-10-10' }, { id: 'd', provider: 'D', status: 'cancelled', renewalDate: '2026-10-13' }, { id: 'e', provider: 'E', status: 'unknown', renewalDate: '2026-10-12' }], NOW, 45);
  assert(up.map((x) => x.id).join() === 'c,e,a' && up[0].overdue && up[0].daysAway === -2 && up[2].daysAway === 8, 'dates: overdue first and flagged, within-window next, far-off and cancelled omitted');
  const cs = inv.summarizeCredentials([{ id: '1', name: 'a', status: 'exposed', verification: 'inferred' }, { id: '2', name: 'b', status: 'active', verification: 'verified', nextReviewAt: '2026-10-01' }, { id: '3', name: 'c', status: 'active', verification: 'unknown', nextReviewAt: '2026-11-01' }, { id: '4', name: 'd', status: 'revoked', verification: 'verified', nextReviewAt: '2026-01-01' }, { id: '5', name: 'e', status: 'pending_migration', verification: 'unknown' }], NOW);
  assert(cs.total === 5 && cs.byStatus.exposed === 1 && cs.byStatus.active === 2 && cs.byStatus.revoked === 1 && cs.needsReview.map((x) => x.name).join() === 'a,b,e', 'summary: counts by status; review list = exposed/rotation/pending plus overdue reviews (revoked and future reviews excluded)');
  const cons = (migration, verification = 'verified') => ({ name: 'x', migration, verification });
  assert(inv.dependencyView({ id: 'a', name: 'a', status: 'exposed', consumers: [cons('migrated'), cons('pending')] }).readiness === 'blocked_by_consumers', 'dependencies: a pending consumer blocks rotation');
  assert(inv.dependencyView({ id: 'a', name: 'a', status: 'exposed', consumers: [cons('migrated', 'inferred')] }).readiness === 'verify_consumers_first' && inv.dependencyView({ id: 'a', name: 'a', status: 'active', consumers: [cons('not_needed')] }).readiness === 'ready' && inv.dependencyView({ id: 'a', name: 'a', status: 'active', consumers: [] }).readiness === 'unknown_consumers' && inv.dependencyView({ id: 'a', name: 'a', status: 'revoked', consumers: [] }).readiness === 'already_revoked', 'dependencies: ready / verify first / unknown consumers / already revoked');

  // ── 5. starting records ──
  const allValid = targets.credentials.every((t) => { const r = inv.validateCredential(t); return !r.errors.length && !inv.checkCredentialClaims(r.value).length; }) && targets.subscriptions.every((t) => { const r = inv.validateSubscription(t); return !r.errors.length && !inv.checkSubscriptionClaims({ priceBasis: 'unknown', ...r.value }).length; });
  assert(allValid && targets.credentials.length >= 20, `seed: all ${targets.credentials.length} credential and ${targets.subscriptions.length} subscription records pass the same validation as the page`);
  const seedText = fs.readFileSync('./server/scripts/inventoryTargets.cjs', 'utf8');
  assert(!inv.findSecretFields(targets).length && !/[a-f0-9]{40,}/i.test(seedText), 'seed: contains no secret-shaped value');
  assert(targets.credentials.every((c) => c.verification !== 'verified' && c.status !== 'revoked' && !c.lastRotatedAt) && targets.subscriptions.every((s) => s.price === null && s.priceBasis === 'unknown'), 'seed: nothing is pre-marked verified, revoked or rotated, and no price is invented');
  assert(targets.credentials.filter((c) => c.status === 'exposed').length >= 2 && targets.credentials.find((c) => c.envVarName === 'ELEVENLABS_API_KEY').status === 'rotation_required' && targets.credentials.find((c) => c.envVarName === 'POSTIZ_API_KEY').status === 'rotation_required', 'seed: shared key and scheduler bundle keys exposed; ElevenLabs and Postiz rotation-required');

  // ── 6. HTTP API with an in-memory store: authorization + management ──
  const env = process.env;
  env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH = await ownerAuth.hashPassword('dummy inventory owner passphrase');
  env.APP_INTELLIGENCE_SESSION_SECRET = 'inventory-secret-'.padEnd(48, 'i');
  const other = ownerAuth.createOwnerAuth({ audience: 'some-other-app', typ: 'OTH', passwordHashVar: 'OTHER_HASH', secretVar: 'OTHER_SECRET', versionVar: 'OTHER_VERSION' });
  env.OTHER_SECRET = 'other-app-secret-'.padEnd(48, 'o');
  env.API_SECRET_KEY = 'dummy_server_key_for_inventory_test_0123456789';
  const owner = ownerAuth.issueToken(env).token; const studio = other.issueToken(env).token; // a validly signed token for a DIFFERENT application
  const mem = { c: [], s: [] }; let n = 0;
  const orig = { ...inv };
  Object.assign(inv, {
    listCredentials: async () => mem.c.map((x) => ({ ...x })), getCredential: async (_p, id) => mem.c.find((x) => x.id === id) || null,
    createCredential: async (_p, v) => { const r = { id: `cred-${++n}`, provider: '', environment: 'production', applications: [], envVarName: '', status: 'unknown', verification: 'unknown', evidence: '', consumers: [], ...v }; mem.c.push(r); return r; },
    updateCredential: async (_p, id, v) => { const r = mem.c.find((x) => x.id === id); Object.assign(r, v); return r; }, deleteCredential: async (_p, id) => { const l = mem.c.length; mem.c = mem.c.filter((x) => x.id !== id); return mem.c.length < l; },
    listSubscriptions: async () => mem.s.map((x) => ({ ...x })), getSubscription: async (_p, id) => mem.s.find((x) => x.id === id) || null,
    createSubscription: async (_p, v) => { const r = { id: `sub-${++n}`, currency: 'USD', priceBasis: 'unknown', billingFrequency: 'unknown', status: 'unknown', price: null, applications: [], ...v }; mem.s.push(r); return r; },
    updateSubscription: async (_p, id, v) => { const r = mem.s.find((x) => x.id === id); Object.assign(r, v); return r; }, deleteSubscription: async (_p, id) => { const l = mem.s.length; mem.s = mem.s.filter((x) => x.id !== id); return mem.s.length < l; },
  });
  const web = express(); web.use(express.json()); web.use('/ai', require('./server/routes/appIntelligence.cjs')({}, { env, failDelayMs: 0 }));
  const srv = await new Promise((r) => { const s = web.listen(0, '127.0.0.1', () => r(s)); }); const api = `http://127.0.0.1:${srv.address().port}/ai`;
  const call = (m, p, body, headers = { authorization: `Bearer ${owner}` }) => fetch(api + p, { method: m, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const endpoints = [['GET', '/inventory'], ['POST', '/credentials', { name: 'x' }], ['PATCH', '/credentials/cred-1', { name: 'y' }], ['DELETE', '/credentials/cred-1'], ['POST', '/subscriptions', { provider: 'x' }], ['PATCH', '/subscriptions/sub-1', { provider: 'y' }], ['DELETE', '/subscriptions/sub-1']];
  let leaked = 0; const denied = [{}, { 'x-api-key': env.API_SECRET_KEY }, { authorization: `Bearer ${studio}` }, { authorization: 'Bearer ' + 'a'.repeat(40) }];
  for (const h of denied) for (const [m, p, b] of endpoints) { const r = await call(m, p, b, h); if (r.status !== 401) leaked++; }
  assert(leaked === 0 && mem.c.length === 0 && mem.s.length === 0, `authorization: all ${endpoints.length} inventory endpoints answer 401 to anonymous callers, the shared API key and another application's session; nothing was written`);
  let r = await call('POST', '/credentials', { name: 'Test key', provider: 'Acme', envVarName: 'ACME_KEY', applications: ['App'], status: 'exposed', verification: 'inferred', consumers: [{ name: 'App', migration: 'pending', verification: 'inferred' }] });
  assert(r.status === 201 && r.body.credential.name === 'Test key', 'management: create a credential record');
  const id = r.body.credential.id;
  r = await call('POST', '/credentials', { name: 'Leaky', purpose: shapes.skKey }); assert(r.status === 400 && !JSON.stringify(r.body).includes(shapes.skKey) && mem.c.length === 1, 'management: a secret-looking value is refused with 400, is not stored and is not echoed back');
  r = await call('PATCH', `/credentials/${id}`, { status: 'revoked' }); assert(r.status === 400 && /Revoked.*evidence/i.test(r.body.error) && mem.c[0].status === 'exposed', 'management: marking revoked without evidence is refused and changes nothing');
  r = await call('PATCH', `/credentials/${id}`, { status: 'revoked', evidence: 'Deleted in the provider dashboard', lastVerifiedAt: '2026-10-01' }); assert(r.status === 200 && mem.c[0].status === 'revoked', 'management: marking revoked WITH evidence and a date works');
  r = await call('PATCH', '/credentials/nope', { name: 'z' }); assert(r.status === 404, 'management: editing an unknown record answers 404');
  r = await call('POST', '/subscriptions', { provider: 'Acme', service: 'API', price: 20, priceBasis: 'verified', billingFrequency: 'monthly', status: 'active', lastVerifiedAt: '2026-10-01', accountUrl: 'https://billing.example.com/account' }); assert(r.status === 201, 'management: create a subscription record');
  r = await call('POST', '/subscriptions', { provider: 'Bad', price: 20, priceBasis: 'verified', lastVerifiedAt: null }); assert(r.status === 400, 'management: a "verified" price without a verification date is refused');
  r = await call('GET', '/inventory'); const text = JSON.stringify(r.body);
  assert(r.status === 200 && r.body.credentials.length === 1 && r.body.summary.costs.byCurrency.USD.monthlyVerified === 20 && r.body.dependencies.length === 1 && /Maintained by hand/.test(r.body.notice), 'inventory: returns records, cost summary, dependency view and the "maintained by hand" notice');
  assert(!text.includes(shapes.skKey) && !text.includes(env.API_SECRET_KEY) && !text.includes(owner), 'inventory: the response contains no secret, key or token');
  r = await call('DELETE', `/credentials/${id}`); assert(r.status === 200 && mem.c.length === 0, 'management: delete removes only the register entry');
  srv.close(); Object.assign(inv, orig);

  // ── 7. front-end view helpers (filtering, sorting, money) ──
  const src = fs.readFileSync('./src/intelligence/data/inventoryView.js', 'utf8');
  const view = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
  const creds = [
    { id: '1', name: 'Zeta', provider: 'P1', environment: 'production', status: 'active', verification: 'verified', applications: ['A'], envVarName: 'Z_KEY', lastVerifiedAt: '2026-10-01', consumers: [{ name: 'Svc' }] },
    { id: '2', name: 'alpha', provider: 'P2', environment: 'staging', status: 'exposed', verification: 'inferred', applications: ['A', 'B'], envVarName: 'A_KEY', lastVerifiedAt: null, consumers: [] },
    { id: '3', name: 'Mid', provider: 'P1', environment: 'production', status: 'unknown', verification: 'unknown', applications: ['B'], envVarName: 'M_KEY', lastVerifiedAt: '2026-09-01', consumers: [] },
  ];
  const ids = (l) => l.map((c) => c.id).join();
  assert(ids(view.filterCredentials(creds, { status: 'exposed' })) === '2' && ids(view.filterCredentials(creds, { provider: 'P1' })) === '1,3' && ids(view.filterCredentials(creds, { application: 'B' })) === '2,3' && ids(view.filterCredentials(creds, { verification: 'verified' })) === '1' && ids(view.filterCredentials(creds, { environment: 'staging' })) === '2', 'filters: status, provider, application, evidence level, environment');
  assert(ids(view.filterCredentials(creds, { q: 'z_key' })) === '1' && ids(view.filterCredentials(creds, { q: 'svc' })) === '1' && ids(view.filterCredentials(creds, { q: 'ALPHA', status: 'exposed' })) === '2' && ids(view.filterCredentials(creds, { q: 'nothing-matches' })) === '', 'search: matches name, variable name and consumer, case-insensitively, and combines with filters');
  assert(ids(view.sortCredentials(creds, 'status')) === '2,3,1' && ids(view.sortCredentials(creds, 'name')) === '2,3,1' && ids(view.sortCredentials(creds, 'lastVerifiedAt', 'desc')) === '1,3,2' && ids(view.sortCredentials(creds, 'lastVerifiedAt', 'asc')) === '3,1,2', 'sort: by risk-ranked status, name, and dates with missing dates always last');
  const subs = [{ id: 'a', provider: 'B', status: 'active', billingFrequency: 'monthly', price: 5, applications: ['X'] }, { id: 'b', provider: 'A', status: 'unknown', billingFrequency: 'usage', price: null, applications: [] }];
  assert(ids(view.filterSubscriptions(subs, { status: 'unknown' })) === 'b' && ids(view.filterSubscriptions(subs, { frequency: 'monthly' })) === 'a' && ids(view.sortSubscriptions(subs, 'price', 'asc')) === 'a,b' && ids(view.sortSubscriptions(subs, 'provider')) === 'b,a', 'subscriptions: filter by status/billing, sort by price (missing last) and provider');
  assert(view.money(1234.5, 'USD') === '$1,234.50' && view.costLines({ byCurrency: { USD: { monthlyVerified: 30, monthlyEstimated: 10, annualVerified: 360, annualEstimated: 120 } } })[0].text === '$30.00/mo verified + $10.00/mo estimated', 'money: formatted, with verified and estimated kept apart in the text');
  assert(Object.keys(view.CREDENTIAL_STATUS).sort().join() === [...inv.CREDENTIAL_STATUSES].sort().join() && Object.keys(view.READINESS).length === 5, 'view labels cover every status the server can send');

  // ── 8. built bundles contain no secret-shaped value ──
  if (fs.existsSync('./dist/assets')) {
    const js = fs.readdirSync('./dist/assets').filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(`./dist/assets/${f}`, 'utf8'));
    assert(js.length >= 1 && js.every((t) => !/(?<![A-Za-z0-9])[a-f0-9]{64}(?![A-Za-z0-9])/.test(t) && !/sk-ant-[A-Za-z0-9_-]{20,}/.test(t) && !/x-api-key/i.test(t)), `bundle: none of the ${js.length} built JavaScript files holds a 64-hex key, an Anthropic-style key or the x-api-key header`);
    assert(js.some((t) => t.includes('Secrets & Subscriptions') || t.includes('Secrets &amp; Subscriptions')), 'bundle: the new page is part of the build');
  }

  // ── 9. Postgres round trip (only when a scratch database is supplied) ──
  if (process.env.AI_TEST_DATABASE_URL) {
    const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.AI_TEST_DATABASE_URL, ssl: false });
    await require('./server/services/appIntelligence/store.cjs').initSchema(pool);
    await pool.query('DELETE FROM ai_credentials'); await pool.query('DELETE FROM ai_subscriptions');
    const c = await inv.createCredential(pool, inv.validateCredential({ name: 'DB key', envVarName: 'DB_KEY', applications: ['A'], status: 'exposed', consumers: [{ name: 'S', migration: 'pending' }], rotationStep: 2, nextReviewAt: '2026-11-01' }).value);
    const back = await inv.getCredential(pool, c.id);
    assert(back.name === 'DB key' && back.applications[0] === 'A' && back.consumers[0].migration === 'pending' && back.nextReviewAt === '2026-11-01' && back.rotationStep === 2, 'database: credential round trip (JSON lists, dates, numbers)');
    const upd = await inv.updateCredential(pool, c.id, { status: 'active', consumers: [] });
    assert(upd.status === 'active' && upd.consumers.length === 0 && upd.name === 'DB key', 'database: partial update changes only the supplied fields');
    const sb = await inv.createSubscription(pool, inv.validateSubscription({ provider: 'DB', price: 12.5, priceBasis: 'estimate', billingFrequency: 'monthly', status: 'active', renewalDate: '2026-11-05' }).value);
    assert((await inv.getSubscription(pool, sb.id)).price === 12.5 && (await inv.listSubscriptions(pool)).length === 1, 'database: subscription round trip with numeric price and date');
    assert(await inv.deleteCredential(pool, c.id) && !(await inv.deleteCredential(pool, c.id)), 'database: delete is real and idempotent');
    await pool.query('DELETE FROM ai_subscriptions'); await pool.end();
  } else console.log('ℹ️  database round trip skipped (set AI_TEST_DATABASE_URL to run it)');

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
