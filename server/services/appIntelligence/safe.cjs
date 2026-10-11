// server/services/appIntelligence/safe.cjs
// Keeps secrets out of logs, stored errors and API responses.
'use strict';

const SECRET_ENV_NAMES = [
  'API_SECRET_KEY', 'API_SECRET_KEY_PREVIOUS', 'DATABASE_URL', 'RESEND_API_KEY', 'APP_INTELLIGENCE_HEARTBEAT_URL',
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'POSTIZ_API_KEY', 'PEXELS_API_KEY', 'ELEVENLABS_API_KEY', 'ANTHROPIC_API_KEY',
  'TELEGRAM_BOT_TOKEN', 'NTFY_TOPIC',
];

function scrub(message, env = process.env) {
  let text = String(message == null ? 'unknown error' : message);
  for (const name of SECRET_ENV_NAMES) {
    const v = env[name];
    if (v && v.length >= 6) text = text.split(v).join('[redacted]');
  }
  text = text.replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//[redacted]@');           // credentialed URLs
  text = text.replace(/https?:\/\/[^\s"')]+/gi, (u) => { try { return new URL(u).origin; } catch { return '[url]'; } }); // drop paths/query tokens
  text = text.replace(/[A-Za-z0-9_\-+/=]{24,}/g, '[redacted]');               // long token-like strings
  return text.slice(0, 200);
}

const log = {
  error: (scope, err) => console.error(`[app-intelligence] ${scope}: ${scrub(err && err.message ? err.message : err)}`),
  warn: (scope, msg) => console.warn(`[app-intelligence] ${scope}: ${scrub(msg)}`),
};

module.exports = { scrub, log };
