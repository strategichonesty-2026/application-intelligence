// server/services/appIntelligence/egress.cjs
//
// Control probe: "can the monitoring service reach the internet at all?"
// Without it, a monitor whose own network is down would report every
// application as failed (DNS errors, timeouts). With it, those results are
// recorded as a MONITORING fault and never count toward an application incident.
'use strict';

const dns = require('dns');

// DNS is the control: a bare TCP connect can be accepted by a NAT or sandbox even with no real route.
const CONTROL_HOSTS = ['one.one.one.one', 'dns.google', 'www.cloudflare.com', 'www.google.com'];
const CACHE_MS = 20 * 1000;
let cache = null;

const tryDns = (host, resolver) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(false), 3000);
  resolver(host, (err) => { clearTimeout(t); resolve(!err); });
});

/** True when ANY control host resolves. */
async function hasEgress({ resolver = dns.lookup, now = Date.now, useCache = true } = {}) {
  if (process.env.APP_INTELLIGENCE_EGRESS_PROBE === 'off') return true;
  if (useCache && cache && now() - cache.at < CACHE_MS) return cache.ok;
  const attempts = await Promise.all(CONTROL_HOSTS.map((h) => tryDns(h, resolver)));
  const ok = attempts.some(Boolean);
  if (useCache) cache = { ok, at: now() };
  return ok;
}

const resetCache = () => { cache = null; };
module.exports = { hasEgress, resetCache };
