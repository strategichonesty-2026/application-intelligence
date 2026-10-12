// server/services/appIntelligence/starter.cjs
//
// "Load suggested starting records": adds the starting applications, credential records and subscription records
// that are MISSING, from the same lists the seed scripts use. Rules:
//   * additive only: a record that already exists is skipped; nothing is ever updated or deleted
//   * matching: applications by web address (host + path, ignoring a trailing slash and letter case), credentials by
//     name + variable name + environment, subscriptions by provider + service
//   * applications are added WITHOUT a first check (nothing is requested from any monitored application)
//   * metadata only: every record passes the same validation as the forms, so no secret value can enter
//   * nothing is marked verified, rotated or revoked, and no price is invented
'use strict';

const store = require('./store.cjs');
const inventory = require('./inventory.cjs');
const { validateApplicationInput } = require('./validation.cjs');
const appTargets = require('../../scripts/appIntelligenceTargets.cjs');
const inventoryTargets = require('../../scripts/inventoryTargets.cjs');

const MAX_APPLICATIONS = 100;

const norm = (u) => { try { const x = new URL(u); return `${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}`; } catch { return String(u || '').toLowerCase(); } };
const credKey = (c) => `${String(c.name).toLowerCase()}|${String(c.envVarName || '').toLowerCase()}|${c.environment || 'production'}`;
const subKey = (s) => `${String(s.provider).toLowerCase()}|${String(s.service || '').toLowerCase()}`;

function buildApplications() {
  return appTargets.map((t) => {
    const v = validateApplicationInput({ name: t.name, url: t.url, environment: t.environment, checkType: t.checkType || 'homepage', checkPath: t.checkPath, mode: t.mode || 'daily', description: t.note });
    return { target: t, errors: v.errors, value: v.value };
  });
}

/** What loading would do. Reads only. */
async function plan(pool) {
  const [apps, creds, subs] = await Promise.all([store.listApplications(pool), inventory.listCredentials(pool), inventory.listSubscriptions(pool)]);
  const haveApps = new Set(apps.map((a) => norm(a.url)));
  const haveCreds = new Set(creds.map(credKey));
  const haveSubs = new Set(subs.map(subKey));
  const appPlan = buildApplications();
  const room = Math.max(0, MAX_APPLICATIONS - apps.length);
  const out = {
    applications: { add: [], skip: [], invalid: [] },
    credentials: { add: [], skip: [] },
    subscriptions: { add: [], skip: [] },
  };
  appPlan.forEach((a) => {
    const label = { name: a.target.name, url: a.target.url, mode: a.value.mode, unconfirmed: Boolean(a.target.unconfirmed) };
    if (a.errors.length) out.applications.invalid.push(label.name);
    else if (haveApps.has(norm(a.value.url))) out.applications.skip.push(label);
    else if (out.applications.add.length >= room) out.applications.invalid.push(`${label.name} (the ${MAX_APPLICATIONS}-application limit)`);
    else out.applications.add.push(label);
  });
  inventoryTargets.credentials.forEach((c) => {
    const row = { name: c.name, envVarName: c.envVarName, status: c.status };
    (haveCreds.has(credKey(c)) ? out.credentials.skip : out.credentials.add).push(row);
  });
  inventoryTargets.subscriptions.forEach((s) => {
    const row = { provider: s.provider, service: s.service };
    (haveSubs.has(subKey(s)) ? out.subscriptions.skip : out.subscriptions.add).push(row);
  });
  return out;
}

/** Adds the missing records the owner selected. Returns the counts actually added. */
async function load(pool, { applications = false, credentials = false, subscriptions = false } = {}) {
  const p = await plan(pool);
  const added = { applications: 0, credentials: 0, subscriptions: 0 };
  if (applications) {
    const wanted = new Set(p.applications.add.map((a) => norm(a.url)));
    for (const a of buildApplications()) {
      if (a.errors.length || !wanted.has(norm(a.value.url))) continue;
      await store.createApplication(pool, a.value); // no first check: nothing is requested from the monitored application
      added.applications += 1;
    }
  }
  if (credentials) {
    const wanted = new Set(p.credentials.add.map((c) => credKey(c)));
    for (const t of inventoryTargets.credentials) {
      if (!wanted.has(credKey(t))) continue;
      const v = inventory.validateCredential(t);
      if (v.errors.length || inventory.checkCredentialClaims(v.value).length) continue;
      await inventory.createCredential(pool, v.value); added.credentials += 1;
    }
  }
  if (subscriptions) {
    const wanted = new Set(p.subscriptions.add.map((s) => subKey(s)));
    for (const t of inventoryTargets.subscriptions) {
      if (!wanted.has(subKey(t))) continue;
      const v = inventory.validateSubscription(t);
      if (v.errors.length || inventory.checkSubscriptionClaims({ priceBasis: 'unknown', ...v.value }).length) continue;
      await inventory.createSubscription(pool, v.value); added.subscriptions += 1;
    }
  }
  return added;
}

module.exports = { plan, load, norm };
