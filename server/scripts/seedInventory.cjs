// server/scripts/seedInventory.cjs
//
// Loads the starting Secrets & Subscriptions records (metadata only, see inventoryTargets.cjs).
// DRY RUN by default. --apply writes to DATABASE_URL and also requires --confirm-host <exact host>, like seedApplications.cjs.
// Idempotent: a record that already exists (same name+variable+environment, or same provider+service) is skipped; nothing
// is ever updated or deleted. Every record passes the same validation as the page, so a secret-looking value is rejected.
'use strict';

try { require('dotenv').config(); } catch { /* only needed for --apply */ }
const targets = require('./inventoryTargets.cjs');
const inv = require('../services/appIntelligence/inventory.cjs');

(async () => {
  require('./lib/preflight.cjs').preflight();
  const creds = targets.credentials.map((t) => ({ t, v: inv.validateCredential(t) }));
  const subs = targets.subscriptions.map((t) => ({ t, v: inv.validateSubscription(t) }));
  const bad = [...creds, ...subs].filter((r) => r.v.errors.length || (r.t.envVarName !== undefined ? inv.checkCredentialClaims(r.v.value).length : inv.checkSubscriptionClaims({ priceBasis: 'unknown', ...r.v.value }).length));
  if (bad.length) { bad.forEach((r) => console.error(`INVALID ${r.t.name || r.t.provider}: ${r.v.errors.join(' ') || 'claims check failed'}`)); process.exit(1); }
  if (!process.argv.includes('--apply')) {
    creds.forEach((r) => console.log(`[dry run] credential: ${r.t.name}  (${r.t.envVarName}, ${r.t.status}, ${r.t.verification})`));
    subs.forEach((r) => console.log(`[dry run] subscription: ${r.t.provider} - ${r.t.service}`));
    console.log(`\n${creds.length} credential and ${subs.length} subscription records. Nothing was written. Re-run with --apply --confirm-host <host> (and DATABASE_URL).`);
    return;
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
  const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return 'unknown host'; } })();
  const ci = process.argv.indexOf('--confirm-host');
  if (ci < 0 || process.argv[ci + 1] !== host) { console.error(`REFUSED: --apply would write to the database on host "${host}". Re-run with --confirm-host ${host} only if that is the intended database and the plan is approved.`); process.exit(1); }
  const { Pool } = require('pg');
  const store = require('../services/appIntelligence/store.cjs');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await store.initSchema(pool);
    const have = await inv.listCredentials(pool); const haveSubs = await inv.listSubscriptions(pool);
    for (const r of creds) {
      if (have.some((x) => x.name === r.v.value.name && x.envVarName === r.v.value.envVarName && x.environment === r.v.value.environment)) { console.log(`skip (exists): ${r.t.name}`); continue; }
      await inv.createCredential(pool, r.v.value); console.log(`added: ${r.t.name}`);
    }
    for (const r of subs) {
      if (haveSubs.some((x) => x.provider === r.v.value.provider && x.service === r.v.value.service)) { console.log(`skip (exists): ${r.t.provider}`); continue; }
      await inv.createSubscription(pool, r.v.value); console.log(`added: ${r.t.provider}`);
    }
  } finally { await pool.end(); }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
