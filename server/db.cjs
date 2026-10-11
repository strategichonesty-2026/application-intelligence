// server/db.cjs: one PostgreSQL pool for THIS app's own database (not Media Studio's).
//
// Connection settings, any of:
//   1. DATABASE_URL (postgresql://user:password@host:port/database), optionally with APP_INTELLIGENCE_DB_NAME: the
//      same server and login, but THIS app's own database name (swapped into the URL). This is the easy way to
//      reuse an existing Railway Postgres: reference its DATABASE_URL and name the new database.
//   2. the standard separate variables PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
// APP_INTELLIGENCE_CREATE_DATABASE=true lets the app create that database itself at start-up if it does not exist
// (needs a database login allowed to create databases).
// Option 2 avoids URL-encoding problems (a password containing characters such as / @ # ? breaks a URL) and works
// with Railway variable references. Nothing here ever prints a value.
// Railway's Postgres requires TLS; set APP_INTELLIGENCE_DB_SSL=off only for a local database.
'use strict';
const { Pool } = require('pg');

const DB_NAME = /^[a-z][a-z0-9_]{2,62}$/;

/** Swaps the database name in a postgres URL using plain string handling (no URL parsing, so unusual characters in
 *  the password cannot break it). */
function withDatabaseName(url, name) {
  return String(url).replace(/\/[^/?#]*(\?.*)?$/, (_m, query) => `/${name}${query || ''}`);
}

function effectiveUrl(env = process.env) {
  if (!env.DATABASE_URL) return undefined;
  return env.APP_INTELLIGENCE_DB_NAME ? withDatabaseName(env.DATABASE_URL, env.APP_INTELLIGENCE_DB_NAME) : env.DATABASE_URL;
}

/** Returns null when the settings are usable, otherwise a plain-language problem (never including any value). */
function describeConfigProblem(env = process.env) {
  const url = env.DATABASE_URL;
  if (env.APP_INTELLIGENCE_DB_NAME && !DB_NAME.test(env.APP_INTELLIGENCE_DB_NAME)) return 'APP_INTELLIGENCE_DB_NAME must be 3-63 characters: lowercase letters, digits and underscores, starting with a letter (for example application_intelligence_staging).';
  if (url) {
    if (/\$\{\{/.test(url)) return 'DATABASE_URL still contains an unresolved ${{...}} placeholder. The service named inside it does not exist in this Railway project: use the exact name of your Postgres service, or set PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE instead.';
    if (/^\s|\s$|^["']|["']$/.test(url)) return 'DATABASE_URL has leading/trailing spaces or quotes. Remove them (Railway values must be entered without quotes).';
    try {
      const u = new URL(url);
      if (!/^postgres(ql)?:$/.test(u.protocol)) return 'DATABASE_URL must start with postgresql://';
      if (!u.hostname || !u.pathname || u.pathname === '/') return 'DATABASE_URL needs a host and a database name (postgresql://user:password@host:port/database).';
    } catch { return 'DATABASE_URL is not a valid address. If the password contains characters such as / @ # ? or %, the URL form breaks: set PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE instead.'; }
    return null;
  }
  const missing = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'].filter((k) => !env[k]);
  if (missing.length === 4) return 'No database settings found. Set DATABASE_URL, or PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE.';
  if (missing.length) return `Database settings are incomplete: missing ${missing.join(', ')}.`;
  if (/\$\{\{/.test(Object.values({ h: env.PGHOST, u: env.PGUSER, p: env.PGPASSWORD }).join(''))) return 'A PG* variable still contains an unresolved ${{...}} placeholder: the referenced service name does not exist in this Railway project.';
  return null;
}

const ssl = process.env.APP_INTELLIGENCE_DB_SSL === 'off' ? false : { rejectUnauthorized: false };
let pool;
const url = effectiveUrl();
try { pool = new Pool({ ...(url ? { connectionString: url } : {}), ssl, max: 5 }); }
catch { pool = new Pool({ ssl, max: 5 }); } // an invalid URL is reported by describeConfigProblem() at start-up, not as a stack trace

/** Creates the app's database if it is missing. Only when APP_INTELLIGENCE_CREATE_DATABASE=true. Returns 'created',
 *  'exists' or 'skipped'. Connects to the server's maintenance database ("postgres") to do it. */
async function ensureDatabase(env = process.env) {
  if (env.APP_INTELLIGENCE_CREATE_DATABASE !== 'true') return 'skipped';
  const name = env.APP_INTELLIGENCE_DB_NAME || env.PGDATABASE || (env.DATABASE_URL ? (/\/([^/?#]*)(\?.*)?$/.exec(env.DATABASE_URL) || [])[1] : '');
  if (!name || !DB_NAME.test(name)) throw Object.assign(new Error('database name not valid for automatic creation'), { code: 'BADNAME' });
  const admin = new Pool({ ...(env.DATABASE_URL ? { connectionString: withDatabaseName(env.DATABASE_URL, 'postgres') } : { database: 'postgres' }), ssl, max: 1 });
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rows.length) return 'exists';
    await admin.query(`CREATE DATABASE ${name}`); // name validated above: letters, digits, underscore only
    return 'created';
  } finally { await admin.end(); }
}

module.exports = { pool, describeConfigProblem, ensureDatabase, withDatabaseName, effectiveUrl, DB_NAME };
