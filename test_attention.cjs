// test_attention.cjs
// Command Center step 4: the Overview "needs attention" rules. Pure function, fixed clock, dummy data. Run: node test_attention.cjs
const { buildAttention } = require('./server/services/appIntelligence/attention.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = Date.UTC(2026, 10, 21, 12);
const iso = (d) => new Date(NOW - d * 86400000).toISOString();
const repo = (o = {}) => ({
  id: 'repo-1', name: 'media', type: { value: 'application', confirmed: true }, priority: null, appId: null,
  activity: { state: 'active', days: 2, pushedAt: iso(2), readAt: iso(0) }, health: { state: 'not_checked', lastCheckedAt: null }, ...o,
});
const calm = { configured: true, last: { ok: true, finishedAt: iso(0), errors: [] } };
const run = (o) => buildAttention({ sync: calm, ...o }, NOW);
const find = (r, id) => r.items.find((i) => i.id === id);

const quiet = run({ repos: [repo({ priority: 'maintain' })] });
assert(quiet.items.length === 0 && quiet.total === 0, 'quiet: nothing is invented when nothing is wrong');
assert(quiet.numbers.repositories === 1 && quiet.numbers.confirmedApplications === 1 && quiet.numbers.pushedLast14Days === 1, 'numbers: repositories, confirmed applications and recent pushes are counted');

const apps = run({ apps: [{ id: 'a1', name: 'Site', status: 'unhealthy', lastSummary: '3 failed checks', lastCheckedAt: iso(0) }, { id: 'a2', name: 'Blog', status: 'healthy' }, { id: 'a3', name: 'Api', status: 'degraded', lastSummary: 'slow' }] });
assert(find(apps, 'app:a1').level === 'high' && /unavailable/.test(find(apps, 'app:a1').title) && /3 failed checks/.test(find(apps, 'app:a1').evidence) && !find(apps, 'app:a2') && find(apps, 'app:a3').level === 'medium', 'apps: unavailable is High, degraded is Medium, healthy is not listed, and the checker\'s own words are the evidence');
assert(run({ apps: [{ id: 'a', name: 'X', status: 'unknown', monitoringFault: true, lastSummary: 'timeout' }] }).items[0].title === 'X could not be checked', 'apps: a monitoring fault is reported as "could not be checked", not as the app being down');

const creds = [{ id: 'c1', name: 'Provider key', verification: 'inferred', updatedAt: iso(3) }, { id: 'c2', name: 'Other key', verification: 'verified', lastVerifiedAt: '2026-11-01' }];
const cr = run({ credentials: creds, credentialReview: [{ id: 'c1', name: 'Provider key', status: 'exposed', reason: 'exposed' }, { id: 'c2', name: 'Other key', status: 'active', reason: 'review_due' }] });
assert(find(cr, 'cred:c1').level === 'high' && /exposed/.test(find(cr, 'cred:c1').title) && /inferred, not verified/.test(find(cr, 'cred:c1').evidence), 'credentials: an exposed key is High and says it is only inferred, not verified');
assert(find(cr, 'cred:c2').level === 'low' && /verified 2026-11-01/.test(find(cr, 'cred:c2').evidence), 'credentials: a review that is merely due is Low');
assert(!JSON.stringify(cr).match(/sk_|secret value/i), 'credentials: names and statuses only');

const ren = run({ renewals: [{ id: 's1', provider: 'Host', service: 'Pro', kind: 'renewal', date: '2026-11-25', daysAway: 4, overdue: false }, { id: 's2', provider: 'Old', service: '', kind: 'trial_end', date: '2026-11-15', daysAway: -6, overdue: true }] });
assert(/renews in 4 days/.test(find(ren, 'renewal:s1:renewal').title) && find(ren, 'renewal:s1:renewal').level === 'low' && find(ren, 'renewal:s2:trial_end').level === 'medium' && /date has passed/.test(find(ren, 'renewal:s2:trial_end').title), 'renewals: upcoming is Low; a date that has passed is Medium and says so');

const rp = run({ repos: [repo({ id: 'r1', name: 'alpha', type: { value: 'application', confirmed: false } }), repo({ id: 'r2', name: 'beta', type: { value: null, confirmed: false } }), repo({ id: 'r3', name: 'gamma', priority: 'invest', appId: null }), repo({ id: 'r4', name: 'delta', priority: 'invest', activity: { state: 'dormant', days: 120, readAt: iso(0) }, health: { state: 'healthy' } }), repo({ id: 'r5', name: 'eps', type: { value: 'tool', confirmed: true }, activity: { state: 'dormant', days: 90, readAt: iso(0) } }), repo({ id: 'r6', name: 'zeta', type: { value: 'archive', confirmed: true }, activity: { state: 'archived', days: null } })] });
assert(/2 repositories need a confirmed type/.test(find(rp, 'repos:need-type').title) && find(rp, 'repos:need-type').href === '/applications?type=needs_type', 'repos: counts repositories that still need a type');
assert(/gamma is marked Invest but its health has never been checked/.test(find(rp, 'repo:r3:health').title) && /No monitored application is linked/.test(find(rp, 'repo:r3:health').evidence), 'repos: an Invest application with no health check is flagged, with the reason');
assert(!find(rp, 'repo:r4:health') && /delta is marked Invest but has had no push for 120 days/.test(find(rp, 'repo:r4:dormant').title), 'repos: an Invest repository that went quiet is flagged; one with a healthy check is not flagged for health');
assert(/1 repository has had no push for 60\+ days and no priority/.test(find(rp, 'repos:idle').title), 'repos: dormant, unprioritised repositories are grouped into ONE low item, and archived ones are ignored');

assert(run({ sync: { configured: false, last: null } }).items[0].id === 'sync:not-configured', 'sync: no token is a Low item that says nothing is being read');
assert(find(run({ sync: { configured: true, last: null } }), 'sync:never') && find(run({ sync: { configured: true, last: { ok: false, finishedAt: iso(0), errors: [{ message: 'GitHub rejected the token (expired or revoked).' }] } } }), 'sync:failed').level === 'medium', 'sync: never synced is Low; a failed sync is Medium with the reason');
assert(/last synced 9 days ago/.test(find(run({ sync: { configured: true, last: { ok: true, finishedAt: iso(9), errors: [] } } }), 'sync:old').title), 'sync: an old sync is flagged with its age');

const mixed = run({ apps: [{ id: 'a', name: 'S', status: 'unhealthy' }], renewals: [{ id: 's', provider: 'P', service: '', kind: 'renewal', date: 'x', daysAway: 3, overdue: false }], repos: [repo({ type: { value: null, confirmed: false } })] });
assert(mixed.items.map((i) => i.level).join() === 'high,medium,low', 'order: High first, then Medium, then Low');
const many = run({ credentials: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}` })), credentialReview: Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `K${i}`, status: 'exposed', reason: 'exposed' })) });
assert(many.items.length === 25 && many.total === 40, 'cap: at most 25 items are returned, and the true total is reported');
{
  const gone = run({ repos: [repo({ id: 'repo-9', name: 'old-thing', missing: true }), repo({ id: 'repo-2', name: 'media' })] });
  const it = gone.items.find((x) => x.id === 'repos:missing');
  assert(it && it.level === 'medium' && /old-thing/.test(it.title) && !/media/.test(it.title) && /not list it/.test(it.evidence || it.why || JSON.stringify(it)), 'attention: a repository no longer found on GitHub is called out by name, with the reason');
  assert(!run({ repos: [repo()] }).items.some((x) => x.id === 'repos:missing'), 'attention: nothing is said when no repository is missing');
}
console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
