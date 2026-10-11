// server/services/appIntelligence/alerts.cjs
//
// Email alerting through an outbox table.
//
//  * An alert row is written in the SAME transaction that opens/closes an
//    incident, with a unique dedupe key (incident:<id>:opened|recovered), so a
//    given incident can never queue the same email twice, however many
//    instances or retries run.
//  * A dispatcher claims rows with FOR UPDATE SKIP LOCKED, sends, and records
//    the provider's answer. Temporary failures retry with backoff; permanent
//    ones stop and keep the (sanitised) reason.
//  * "sent" means the provider ACCEPTED the message and returned an id. It is
//    never described as delivered: inbox delivery is not confirmed here.
'use strict';

const { scrub } = require('./safe.cjs');

const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 5, 15, 60];
const RESEND_URL = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function parseAddress(raw) {
  const m = String(raw || '').trim().match(/^(?:[^<>@]*<)?([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+)>?$/);
  return m ? m[1] : null;
}

const maskEmail = (e) => e.replace(/^(.).*(@.*)$/, '$1•••$2');

/** Validates configuration without sending anything. Never returns secret values. */
function getAlertConfig(env = process.env) {
  const missing = []; const invalid = [];
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY');
  else if (!/^re_[A-Za-z0-9_\-]{8,}$/.test(env.RESEND_API_KEY)) invalid.push('RESEND_API_KEY (expected a key starting with re_)');
  if (!env.ALERT_EMAIL_FROM) missing.push('ALERT_EMAIL_FROM');
  else if (!parseAddress(env.ALERT_EMAIL_FROM)) invalid.push('ALERT_EMAIL_FROM (expected an address such as alerts@yourdomain.com)');
  const recipients = String(env.ALERT_EMAIL_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!recipients.length) missing.push('ALERT_EMAIL_TO');
  else if (recipients.length > 5) invalid.push('ALERT_EMAIL_TO (at most 5 recipients)');
  else if (recipients.some((r) => !EMAIL_RE.test(r))) invalid.push('ALERT_EMAIL_TO (one or more addresses are not valid)');
  const configured = !missing.length && !invalid.length;
  return {
    configured, provider: 'resend', missing, invalid,
    recipients: configured ? recipients.map(maskEmail) : [],
    message: configured ? 'Email alerts are configured.'
      : `Email alerts are not configured. ${[...missing.map((m) => `${m} is not set`), ...invalid.map((i) => `${i} is invalid`)].join('; ')}.`,
  };
}

/** Resend provider. `fetchImpl` is injectable so tests never touch the network. */
function createResendProvider({ env = process.env, fetchImpl = fetch } = {}) {
  return {
    name: 'resend',
    async send({ subject, text, idempotencyKey }) {
      const cfg = getAlertConfig(env);
      if (!cfg.configured) return { ok: false, retryable: false, error: cfg.message };
      let res;
      try {
        res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify({
            from: env.ALERT_EMAIL_FROM, to: String(env.ALERT_EMAIL_TO).split(',').map((s) => s.trim()).filter(Boolean), subject, text,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (err) {
        return { ok: false, retryable: true, error: `Could not reach the email provider (${scrub(err && err.name === 'TimeoutError' ? 'timed out' : 'network error', env)}).` };
      }
      let body = null; try { body = await res.json(); } catch { /* not JSON */ }
      if (res.ok && body && body.id) return { ok: true, providerId: String(body.id) };
      if (res.ok) return { ok: false, retryable: true, error: 'The email provider answered without a message id, so acceptance cannot be confirmed.' };
      const retryable = res.status === 429 || res.status >= 500;
      const why = body && (body.message || body.error) ? scrub(body.message || body.error, env) : '';
      const hint = res.status === 401 || res.status === 403 ? ' Check RESEND_API_KEY and that ALERT_EMAIL_FROM uses a verified domain.' : '';
      return { ok: false, retryable, error: `Email provider answered HTTP ${res.status}${why ? `: ${why}` : ''}.${hint}`.slice(0, 300) };
    },
  };
}

// ── Message content: names, URLs (no query strings are stored) and plain summaries only. ──
const oneLine = (v) => String(v).replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, 120); // a name must not be able to inject mail headers
function buildMessage(event, { app, incident }) {
  const name = app ? oneLine(app.name) : 'Application Intelligence';
  if (event === 'opened') {
    return {
      subject: `[${incident.severity === 'critical' ? 'ALERT' : 'WARNING'}] ${name} is having problems`,
      text: [
        `${name} (${app.environment}) has an open incident.`, '',
        `What happened: ${incident.summary}`,
        `First detected: ${incident.firstDetectedAt}`, `Failed or degraded checks in a row: ${incident.failureCount}`,
        `URL: ${app.url}`, '',
        'Checked from Application Intelligence. This message is sent once per incident; you will get one more when it recovers.',
      ].join('\n'),
    };
  }
  if (event === 'recovered') {
    return {
      subject: `[RECOVERED] ${name} is responding again`,
      text: [
        `${name} (${app.environment}) has recovered.`, '',
        `Incident started: ${incident.firstDetectedAt}`, `Recovered: ${incident.resolvedAt}`, `URL: ${app.url}`,
      ].join('\n'),
    };
  }
  return {
    subject: '[TEST] Application Intelligence test notification',
    text: 'This is a test notification requested by the console owner. If you can read this, the provider accepted the message and your recipient address is configured.',
  };
}

const mapAlert = (r) => ({
  id: Number(r.id), event: r.event, applicationId: r.application_id, applicationName: r.application_name || null,
  incidentId: r.incident_id ? Number(r.incident_id) : null, subject: r.subject, status: r.status, attempts: r.attempts,
  lastError: r.last_error, providerId: r.provider_id ? `${String(r.provider_id).slice(0, 8)}…` : null,
  createdAt: r.created_at && new Date(r.created_at).toISOString(), sentAt: r.sent_at && new Date(r.sent_at).toISOString(),
  nextAttemptAt: r.status === 'pending' && r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
});

async function recentAlerts(pool, limit = 20) {
  const { rows } = await pool.query(
    `SELECT n.*, a.name AS application_name FROM ai_alerts n LEFT JOIN ai_applications a ON a.id = n.application_id
     ORDER BY n.created_at DESC LIMIT $1`, [Math.min(limit, 50)]);
  return rows.map(mapAlert);
}

/** Send one claimed row and record the outcome. Never throws. */
async function deliver(pool, row, provider) {
  let result;
  try { result = await provider.send({ subject: row.subject, text: row.body, idempotencyKey: row.dedupe_key }); }
  catch (err) { result = { ok: false, retryable: true, error: scrub(err && err.message) }; }

  if (result.ok) {
    await pool.query(`UPDATE ai_alerts SET status = 'sent', provider_id = $2, sent_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1`, [row.id, result.providerId]);
    return { status: 'sent', providerId: result.providerId };
  }
  const exhausted = row.attempts >= MAX_ATTEMPTS;
  if (result.retryable && !exhausted) {
    const wait = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)];
    await pool.query(
      `UPDATE ai_alerts SET status = 'pending', last_error = $2, next_attempt_at = NOW() + ($3 || ' minutes')::interval, updated_at = NOW() WHERE id = $1`,
      [row.id, scrub(result.error), String(wait)]);
    return { status: 'pending', error: result.error };
  }
  await pool.query(`UPDATE ai_alerts SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
    [row.id, scrub(`${result.error}${result.retryable ? ' Gave up after repeated attempts.' : ''}`)]);
  return { status: 'failed', error: result.error };
}

/** Claim due rows (safe across instances) and send them. */
async function dispatchDue(pool, provider, { limit = 10 } = {}) {
  const { rows } = await pool.query(
    `UPDATE ai_alerts SET status = 'sending', attempts = attempts + 1, updated_at = NOW()
     WHERE id IN (
       SELECT id FROM ai_alerts
       WHERE (status = 'pending' AND next_attempt_at <= NOW()) OR (status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes')
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING *`, [limit]);
  const results = [];
  for (const row of rows) results.push(await deliver(pool, row, provider));
  return results;
}

/** Owner-initiated test: sent immediately, result reported exactly as the provider answered. */
async function sendTest(pool, provider, env = process.env) {
  const cfg = getAlertConfig(env);
  if (!cfg.configured) return { ok: false, configured: false, message: cfg.message, missing: cfg.missing, invalid: cfg.invalid };
  const recent = await pool.query(`SELECT 1 FROM ai_alerts WHERE event = 'test' AND created_at > NOW() - INTERVAL '30 seconds' LIMIT 1`);
  if (recent.rows.length) return { ok: false, configured: true, tooSoon: true, message: 'A test was sent less than 30 seconds ago. Wait a moment before sending another.' };
  const msg = buildMessage('test', {});
  const key = `test:${Date.now()}`;
  const { rows } = await pool.query(
    `INSERT INTO ai_alerts (dedupe_key, event, subject, body, status, attempts, next_attempt_at)
     VALUES ($1,'test',$2,$3,'sending',1,NOW()) RETURNING *`, [key, msg.subject, msg.text]);
  const out = await deliver(pool, rows[0], { send: (m) => provider.send(m) });
  // A test is never retried in the background: the owner asked a direct question and gets a direct answer.
  if (out.status === 'pending') {
    await pool.query(`UPDATE ai_alerts SET status = 'failed', last_error = $2 WHERE id = $1`, [rows[0].id, scrub(out.error)]);
    return { ok: false, configured: true, message: `The provider did not accept the test: ${out.error}` };
  }
  return out.status === 'sent'
    ? { ok: true, configured: true, message: 'The email provider accepted the test message. This confirms the provider took it, not that it reached the inbox. Check your inbox (and spam) to confirm.', providerId: `${String(out.providerId).slice(0, 8)}…` }
    : { ok: false, configured: true, message: `The provider did not accept the test: ${out.error}` };
}

module.exports = {
  getAlertConfig, createResendProvider, buildMessage, dispatchDue, sendTest, recentAlerts, deliver, parseAddress,
  MAX_ATTEMPTS, BACKOFF_MINUTES,
};
