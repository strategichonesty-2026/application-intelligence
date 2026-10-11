// server/db.cjs: one PostgreSQL pool for THIS app's own database (not Media Studio's).
//
// Connection settings, either way:
//   1. DATABASE_URL  (postgresql://user:password@host:port/database), or
//   2. the standard separate variables PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
// Option 2 avoids URL-encoding problems (a password containing characters such as / @ # ? breaks a URL) and works
// with Railway variable references. Nothing here ever prints a value.
// Railway's Postgres requires TLS; set APP_INTELLIGENCE_DB_SSL=off only for a local database.
'use strict';
const { Pool } = require('pg');

/** Returns null when the settings are usable, otherwise a plain-language problem (never including any value). */
function describeConfigProblem(env = process.env) {
  const url = env.DATABASE_URL;
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
try { pool = new Pool({ ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}), ssl, max: 5 }); }
catch { pool = new Pool({ ssl, max: 5 }); } // an invalid URL is reported by describeConfigProblem() at start-up, not as a stack trace

module.exports = { pool, describeConfigProblem };
