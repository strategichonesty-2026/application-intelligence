// test_briefing_telegram.cjs: the rule-based "What's wrong?" assistant and the Telegram alert channel. Offline, dummy values.
process.env.NODE_ENV = 'test';
const alerts = require('./server/services/appIntelligence/alerts.cjs');
const { buildBriefing, answer, topicOf } = require('./server/services/appIntelligence/briefing.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const NOW = new Date('2026-10-12T10:00:00Z'); const ago = (min) => new Date(NOW.getTime() - min * 60000).toISOString();
const app = (o) => ({ id: o.name, name: 'A', url: 'https://x.example', enabled: true, mode: 'manual', checkType: 'health_endpoint', intervalSeconds: 3600, lastCheckedAt: ago(5), lastOutcome: 'ok', failStreak: 0, ...o });
const cred = (o) => ({ id: o.name, name: 'K', status: 'active', verification: 'verified', consumers: [], applications: [], ...o });
const sub = (o) => ({ id: o.provider, provider: 'P', service: '', status: 'active', billingFrequency: 'monthly', price: 10, priceBasis: 'verified', currency: 'USD', ...o });

(async () => {
  // ── briefing ──
  let b = buildBriefing({ now: NOW });
  let a = answer("What's wrong?", b);
  assert(a.level === 'ok' && /nothing wrong/i.test(a.headline) && a.notes.some((n) => /No apps are registered/.test(n)), 'empty records: says nothing is wrong AND that no apps exist (does not claim health)');
  assert(a.notes.some((n) => /only know what is in your records/.test(n)), 'always states that it only knows what is recorded');

  b = buildBriefing({ now: NOW, apps: [app({ name: 'Down', lastOutcome: 'failed', failStreak: 3 }), app({ name: 'Fine' })] });
  a = answer('whats wrong', b);
  assert(a.level === 'critical' && a.items[0].severity === 'critical' && /Down is down/.test(a.items[0].title), 'a confirmed-down app is Critical and listed first');
  assert(!a.items.some((i) => i.target === 'Fine'), 'a healthy app is not listed');

  b = buildBriefing({ now: NOW, apps: [app({ name: 'Slow', lastOutcome: 'degraded', lastSummary: 'Responding slowly.' }), app({ name: 'Cant', lastOutcome: 'inconclusive', lastReason: 'auth_required' })] });
  a = answer('apps', b);
  assert(a.items.find((i) => i.target === 'Slow').severity === 'attention' && a.items.find((i) => i.target === 'Cant').severity === 'info' && a.level === 'attention', 'degraded is Needs attention; an inconclusive check is only Good to know');
  b = buildBriefing({ now: NOW, apps: [app({ name: 'New', lastCheckedAt: null }), app({ name: 'Old', mode: 'daily', lastCheckedAt: ago(60 * 24 * 5) }), app({ name: 'Off', enabled: false })] });
  a = answer('apps', b);
  assert(a.items.some((i) => /never been checked/.test(i.title)) && a.items.some((i) => /not been checked recently/.test(i.title)) && !a.items.some((i) => i.target === 'Off'), 'never-checked and stale apps are flagged; paused apps are skipped');

  b = buildBriefing({ now: NOW, credentials: [cred({ name: 'Bad', status: 'exposed' }), cred({ name: 'Due', status: 'rotation_required' }), cred({ name: 'Guess', verification: 'unknown' })] });
  a = answer('keys', b);
  assert(a.level === 'critical' && a.items.some((i) => /recorded as exposed/.test(i.title)) && a.items.some((i) => /needing rotation/.test(i.title)) && a.items.some((i) => /never been checked/.test(i.title)), 'keys: exposed is Critical, rotation due is Attention, unverified is Good to know');
  assert(!JSON.stringify(a).includes('storageReference'), 'no register internals are copied into the answer');

  b = buildBriefing({ now: NOW, subscriptions: [sub({ provider: 'Soon', renewalDate: '2026-10-15' }), sub({ provider: 'Far', renewalDate: '2027-01-01' }), sub({ provider: 'NoPrice', price: null, priceBasis: 'unknown' }), sub({ provider: 'Gone', status: 'cancelled', renewalDate: '2026-10-13' })] });
  a = answer('what do I pay', b);
  assert(a.topic === 'money' && a.items.some((i) => /Soon renews in 3 days/.test(i.title)) && !a.items.some((i) => /Far|Gone/.test(i.title)), 'money: a renewal within 7 days is flagged; far-off and cancelled are not');
  assert(a.items.some((i) => /no price recorded/.test(i.title)), 'money: missing prices are reported as a gap');

  assert(topicOf('Any problems with my keys?') === 'keys' && topicOf('are my apps up') === 'apps' && topicOf('what do I pay') === 'money' && topicOf('help me') === 'all', 'questions are routed to the right topic by keywords');
  const all = answer('what am I missing', buildBriefing({ now: NOW, apps: [app({ name: 'Down', lastOutcome: 'failed', failStreak: 3 })], credentials: [cred({ name: 'Due', status: 'rotation_required' })] }));
  assert(all.topic === 'all' && all.items.length === 2 && all.items[0].severity === 'critical', 'a general question covers apps, keys and money, worst first');

  // ── Telegram ──
  const TOKEN = '123456789:AAEhBP0av28dummyDUMMYdummyDUMMY12345'; const CHAT = '987654321';
  const env = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT };
  assert(alerts.getTelegramConfig(env).configured && !alerts.getTelegramConfig({}).configured && alerts.getTelegramConfig({ TELEGRAM_BOT_TOKEN: 'nope', TELEGRAM_CHAT_ID: 'abc' }).invalid.length === 2, 'telegram config: valid, missing and malformed values are told apart');
  assert(alerts.anyChannelConfigured(env) && !alerts.anyChannelConfigured({}), 'any channel (email or Telegram) is enough to queue alerts');
  assert(!JSON.stringify(alerts.getTelegramConfig(env)).includes(TOKEN) && !JSON.stringify(alerts.getTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: 'bad' })).includes(TOKEN), 'config answers never contain the token');

  let seen = null;
  const okFetch = async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) }; };
  const tg = alerts.createTelegramProvider({ env, fetchImpl: okFetch });
  let r = await tg.send({ subject: '[ALERT] X is having problems', text: 'details' });
  assert(r.ok && r.providerId === 'tg-42' && seen.url === `https://api.telegram.org/bot${TOKEN}/sendMessage` && seen.body.chat_id === CHAT && !('parse_mode' in seen.body), 'telegram: posts plain text to the bot API and reports the message id');
  r = await alerts.createTelegramProvider({ env, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }).send({ subject: 's', text: 't' });
  assert(!r.ok && !r.retryable && /TELEGRAM_BOT_TOKEN/.test(r.error) && !r.error.includes(TOKEN), 'telegram: a 401 is permanent and the error never contains the token');
  r = await alerts.createTelegramProvider({ env, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) }).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable, 'telegram: 429 is retried later');
  r = await alerts.createTelegramProvider({ env, fetchImpl: async () => { throw new Error(`connect failed for ${TOKEN}`); } }).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable && !JSON.stringify(r).includes(TOKEN), 'telegram: a network error does not leak the token');
  r = await alerts.createTelegramProvider({ env: {}, fetchImpl: okFetch }).send({ subject: 's', text: 't' });
  assert(!r.ok && !r.retryable, 'telegram: unconfigured does nothing');

  // ── notifier ──
  const good = { send: async () => ({ ok: true, providerId: 'x1' }) }; const bad = { send: async () => ({ ok: false, retryable: true, error: 'down' }) };
  const emailEnv = { RESEND_API_KEY: 're_dummykey12345', ALERT_EMAIL_FROM: 'a@b.example', ALERT_EMAIL_TO: 'c@d.example', ...env };
  r = await alerts.createNotifier({ env: emailEnv, email: bad, telegram: good }).send({ subject: 's', text: 't' });
  assert(r.ok && r.channels.join() === 'telegram' && r.failedChannels.join() === 'email', 'notifier: succeeds if one channel accepted and notes the other failed');
  r = await alerts.createNotifier({ env: emailEnv, email: bad, telegram: bad }).send({ subject: 's', text: 't' });
  assert(!r.ok && r.retryable && /email: down/.test(r.error) && /telegram: down/.test(r.error), 'notifier: fails (retryable) only when every channel failed');
  r = await alerts.createNotifier({ env: env, email: bad, telegram: good }).send({ subject: 's', text: 't' });
  assert(r.ok && r.channels.join() === 'telegram', 'notifier: an unconfigured channel is skipped, not tried');
  r = await alerts.createNotifier({ env: {}, email: good, telegram: good }).send({ subject: 's', text: 't' });
  assert(!r.ok && !r.retryable, 'notifier: with no channel configured it sends nothing');

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
