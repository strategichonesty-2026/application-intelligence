/**
 * server/index.cjs: Application Intelligence server.
 *
 * One small Node service that serves BOTH the console (static files from ./dist) and its API, on one origin:
 *   GET  /healthz                      public, static answer (uptime checks); says nothing about the database
 *   /api/app-intelligence/auth/login   public, throttled, tiny body
 *   /api/app-intelligence/*            owner sign-in required (see routes/appIntelligence.cjs)
 *   everything else                    the console's static files
 * There is no shared API key and no CORS (same origin). Nothing runs on a timer unless
 * APP_INTELLIGENCE_SCHEDULE=daily (default: off, monitoring is manual).
 */
'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const { pool, describeConfigProblem } = require('./db.cjs');
const store = require('./services/appIntelligence/store.cjs');
const monitor = require('./services/appIntelligence/monitor.cjs');
const { log } = require('./services/appIntelligence/safe.cjs');
const bodyLimits = require('./middleware/bodyLimits.cjs');
const { createLimiter } = require('./middleware/rateLimiter.cjs');
const { securityHeaders } = require('./middleware/securityHeaders.cjs');

const DIST = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.PORT) || 3002;

function createApp({ pool: db = pool, dist = DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Railway puts one proxy in front. Set TRUST_PROXY_HOPS=2 if another proxy (e.g. Cloudflare) is added.
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : 1);
  app.use(securityHeaders);

  app.get('/healthz', (_req, res) => res.json({ status: 'ok', service: 'application-intelligence' }));

  // Large bodies are never needed here: the API takes small JSON documents only.
  app.use('/api/app-intelligence', createLimiter({ max: 120 }), bodyLimits.consoleJson(), require('./routes/appIntelligence.cjs')(db));
  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found.' }));

  if (fs.existsSync(dist)) {
    app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', index: false, setHeaders: (res) => res.set('Cache-Control', 'public, max-age=31536000, immutable') }));
    app.use(express.static(dist, { index: false, maxAge: 0 }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.status(503).type('text').send('The console has not been built. Run: npm run build'));
  }
  app.use((err, _req, res, _next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'Request too large.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Request body is not valid JSON.' });
    log.error('unhandled', err);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  });
  return app;
}

async function boot() {
  const problem = describeConfigProblem();
  if (problem) { console.error(`[application-intelligence] Cannot start: ${problem}`); process.exit(1); }
  try { await store.initSchema(pool); } catch (err) {
    const why = { ECONNREFUSED: 'the database refused the connection (wrong host or port?)', ENOTFOUND: 'the database host name was not found (check PGHOST / the host in DATABASE_URL)', ETIMEDOUT: 'the database did not answer in time', '28P01': 'the database rejected the user name or password', '28000': 'the database rejected the login', '3D000': 'that database does not exist yet: create it first (CREATE DATABASE <name>;) and check the database name', '42501': 'the database user is not allowed to create tables in this database' }[err && err.code]
      || (/SSL|TLS/i.test(String(err && err.message)) ? 'the SSL setting does not match the server (for a database on Railway\'s private network try APP_INTELLIGENCE_DB_SSL=off)' : `database error ${(err && err.code) || 'unknown'}`);
    console.error(`[application-intelligence] Cannot start: ${why}.`);
    process.exit(1);
  }
  const app = createApp();
  const server = app.listen(PORT, () => console.log(`[application-intelligence] listening on ${PORT} (automatic checks: ${monitor.scheduleConfig().mode})`));
  monitor.start(pool); // returns without creating any timer unless APP_INTELLIGENCE_SCHEDULE=daily
  const shutdown = async () => {
    server.close();
    try { await monitor.stopAndDrain(8000); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}

if (require.main === module) boot().catch((err) => { log.error('boot', err); process.exit(1); });

module.exports = { createApp };
