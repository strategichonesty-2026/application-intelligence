// Pure view helpers for the Secrets & Subscriptions page (no React, no network), so filtering, sorting and
// money formatting are unit-testable. Nothing here ever sees a secret value: the inventory holds metadata only.

export const CREDENTIAL_STATUS = {
  active: { label: 'Active', tone: 'ok', icon: 'check-circle', rank: 5 },
  rotation_required: { label: 'Rotation required', tone: 'warn', icon: 'alert-triangle', rank: 1 },
  exposed: { label: 'Exposed', tone: 'bad', icon: 'octagon-alert', rank: 0 },
  pending_migration: { label: 'Pending migration', tone: 'warn', icon: 'clock', rank: 2 },
  revoked: { label: 'Revoked', tone: 'neutral', icon: 'x-circle', rank: 6 },
  unknown: { label: 'Unknown', tone: 'neutral', icon: 'help-circle', rank: 3 },
};
export const VERIFICATION = {
  verified: { label: 'Verified', tone: 'ok', icon: 'check-circle', help: 'Checked, with evidence and a date recorded.' },
  inferred: { label: 'Inferred', tone: 'warn', icon: 'info', help: 'Deduced from code or documents; not checked in the live system.' },
  unknown: { label: 'Unknown', tone: 'neutral', icon: 'help-circle', help: 'Nobody has checked.' },
};
export const MIGRATION = { not_needed: 'Not needed', pending: 'Pending', migrated: 'Migrated', unknown: 'Unknown' };
export const READINESS = {
  ready: { label: 'Ready to rotate', tone: 'ok', help: 'Every consumer is verified and migrated.' },
  verify_consumers_first: { label: 'Verify consumers first', tone: 'warn', help: 'Consumers are migrated but not all are verified.' },
  blocked_by_consumers: { label: 'Blocked: consumers not migrated', tone: 'bad', help: 'Rotating now would break the consumers listed as blockers.' },
  unknown_consumers: { label: 'Consumers unknown', tone: 'warn', help: 'No consumers recorded; find them before changing this credential.' },
  already_revoked: { label: 'Already revoked', tone: 'neutral', help: 'Recorded as revoked.' },
};
export const SUB_STATUS = { active: { label: 'Active', tone: 'ok' }, cancelled: { label: 'Cancelled', tone: 'neutral' }, unknown: { label: 'Unknown', tone: 'warn' } };
export const FREQUENCY = { monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Annual', usage: 'Usage-based', free: 'Free', unknown: 'Unknown' };
export const PRICE_BASIS = { verified: 'Verified', estimate: 'Estimate', unknown: 'Unknown' };
export const CAP_STATUS = { verified: 'Verified', unverified: 'Unverified', not_supported: 'Not supported', unknown: 'Unknown' };

const norm = (v) => String(v == null ? '' : v).toLowerCase();

export function filterCredentials(list, { q = '', status = 'all', provider = 'all', application = 'all', verification = 'all', environment = 'all' } = {}) {
  const needle = norm(q).trim();
  return list.filter((c) =>
    (status === 'all' || c.status === status) &&
    (provider === 'all' || c.provider === provider) &&
    (environment === 'all' || c.environment === environment) &&
    (verification === 'all' || c.verification === verification) &&
    (application === 'all' || (c.applications || []).includes(application)) &&
    (!needle || [c.name, c.provider, c.envVarName, c.purpose, ...(c.applications || []), ...(c.consumers || []).map((x) => x.name)].some((f) => norm(f).includes(needle))));
}

export function sortCredentials(list, key = 'status', dir = 'asc') {
  const val = (c) => {
    if (key === 'status') return CREDENTIAL_STATUS[c.status] ? CREDENTIAL_STATUS[c.status].rank : 9;
    if (key === 'lastVerifiedAt' || key === 'lastRotatedAt' || key === 'nextReviewAt') return c[key] || null;
    return norm(c[key]);
  };
  const m = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const av = val(a); const bv = val(b);
    if (av === null && bv === null) return norm(a.name).localeCompare(norm(b.name));
    if (av === null) return 1; // missing dates always last
    if (bv === null) return -1;
    return (av < bv ? -1 : av > bv ? 1 : norm(a.name).localeCompare(norm(b.name))) * m;
  });
}

export function filterSubscriptions(list, { q = '', status = 'all', frequency = 'all', application = 'all' } = {}) {
  const needle = norm(q).trim();
  return list.filter((s) =>
    (status === 'all' || s.status === status) && (frequency === 'all' || s.billingFrequency === frequency) &&
    (application === 'all' || (s.applications || []).includes(application)) &&
    (!needle || [s.provider, s.service, s.plan, ...(s.applications || [])].some((f) => norm(f).includes(needle))));
}

export function sortSubscriptions(list, key = 'provider', dir = 'asc') {
  const val = (s) => (key === 'price' ? (s.price === null ? null : s.price) : key === 'renewalDate' || key === 'trialEndsAt' ? s[key] || null : norm(s[key]));
  const m = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const av = val(a); const bv = val(b);
    if (av === null && bv === null) return norm(a.provider).localeCompare(norm(b.provider));
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * m;
  });
}

export const uniqueSorted = (items) => [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function money(amount, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount); } catch { return `${currency} ${Number(amount).toFixed(2)}`; }
}

/** One short line per currency, keeping verified and estimated apart (never blended into one confident number). */
export function costLines(costs) {
  return Object.entries(costs.byCurrency).map(([cur, c]) => ({
    currency: cur,
    monthlyVerified: c.monthlyVerified, monthlyEstimated: c.monthlyEstimated, annualVerified: c.annualVerified, annualEstimated: c.annualEstimated,
    text: `${money(c.monthlyVerified, cur)}/mo verified${c.monthlyEstimated ? ` + ${money(c.monthlyEstimated, cur)}/mo estimated` : ''}`,
  }));
}
