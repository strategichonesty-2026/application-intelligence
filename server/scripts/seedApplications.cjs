// server/scripts/seedApplications.cjs
//
// Registers the eight Phase 1 applications in the Application Intelligence
// registry. DRY RUN by default: it only prints what it would do.
//
//   node server/scripts/seedApplications.cjs            # dry run, no database needed
//   DATABASE_URL=... node server/scripts/seedApplications.cjs --apply --confirm-host <db host>
//
// --apply writes to whatever DATABASE_URL points at, so it ALSO requires --confirm-host with the exact
// host of that database. This forces a human to read which database is about to be written to; a stale
// or production DATABASE_URL in the shell cannot be used by accident. Run it against STAGING first, and
// never against production or any persistent database without explicit approval of the deployment plan.
// It is idempotent (an application whose URL is already registered is skipped) and never deletes or updates.
'use strict';

try { require('dotenv').config(); } catch { /* dotenv is only needed for --apply; the dry run needs no npm install */ }
const targets = require('./appIntelligenceTargets.cjs');
const { validateApplicationInput } = require('../services/appIntelligence/validation.cjs');

(async () => {
  require('./lib/preflight.cjs').preflight();
  const apply = process.argv.includes('--apply');
  const rows = targets.map((t) => ({ t, v: validateApplicationInput({ name: t.name, url: t.url, environment: t.environment, checkType: t.checkType || 'homepage', checkPath: t.checkPath, mode: t.mode || 'daily', description: t.note }) }));
  const invalid = rows.filter((r) => r.v.errors.length);
  if (invalid.length) { invalid.forEach((r) => console.error(`INVALID ${r.t.name}: ${r.v.errors.join(' ')}`)); process.exit(1); }
  if (!apply) {
    rows.forEach((r) => console.log(`[dry run] would register: ${r.t.name}  ${r.v.value.url}  (${r.v.value.checkType === 'health_endpoint' ? `health endpoint ${r.v.value.checkPath}` : 'homepage check'}; mode ${r.v.value.mode}${r.v.value.mode === 'manual_only' ? ' - never scheduled, never in Check all' : ''})`));
    console.log('\nNothing was written. Re-run with --apply (and DATABASE_URL) to register them.');
    return;
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
  const { Pool } = require('pg');
  const store = require('../services/appIntelligence/store.cjs');
  const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return 'unknown host'; } })();
  const ci = process.argv.indexOf('--confirm-host');
  if (ci < 0 || process.argv[ci + 1] !== host) {
    console.error(`REFUSED: --apply would write to the database on host "${host}".`);
    console.error(`Re-run with  --confirm-host ${host}  only if that is the intended STAGING database and the plan is approved.`);
    process.exit(1);
  }
  console.log(`Registering into database on ${host}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await store.initSchema(pool);
    const existing = (await store.listApplications(pool)).map((a) => a.url);
    for (const r of rows) {
      if (existing.includes(r.v.value.url)) { console.log(`skip (already registered): ${r.t.name}`); continue; }
      await store.createApplication(pool, r.v.value);
      console.log(`registered: ${r.t.name}`);
    }
  } finally { await pool.end(); }
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
