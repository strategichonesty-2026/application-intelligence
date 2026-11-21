'use strict';
// Decides whether the importer may talk to a database. Local only, strictly.
// Nothing here ever returns or prints a password; messages name only host and database.
const fs = require('fs');
const path = require('path');

class GuardError extends Error { constructor(msg) { super(msg); this.name = 'GuardError'; } }

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CONSOLE_TABLES = ['ai_applications', 'ai_checks', 'ai_service_state', 'ai_repos', 'ai_credentials', 'ai_oss_projects', 'ai_portfolio_items'];
const PRODUCTION_NAME = /prod|railway|live/i;

function safeHostLabel(raw) { return String(raw || '').replace(/[^\w.:\-\[\],%@]/g, '?').slice(0, 80) || '(none)'; }

// Parses the URL and returns a connection config built from separate fields (never the raw string),
// so no query option (host=, hostaddr=, service=) and no PGHOST variable can redirect the connection.
function parseLocalDatabaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new GuardError('No database URL given. Set PIH_DATABASE_URL (see docs/PIH_LOCAL_SETUP.md).');
  let u;
  try { u = new URL(raw.trim()); } catch { throw new GuardError('The database URL could not be read. Expected postgresql://user:password@127.0.0.1:5434/dbname'); }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new GuardError('The database URL must start with postgresql://');
  if ([...u.searchParams.keys()].length) throw new GuardError('Refused: the database URL has query options (for example ?host=). Remove them; the importer only accepts a plain local URL.');
  if (u.hostname.includes('%')) throw new GuardError('Refused: the database host is percent-encoded. Write the host plainly (127.0.0.1 or localhost).');
  const host = decodeURIComponent(u.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new GuardError('Refused: the database URL has no host. The importer will not fall back to PGHOST or any default.');
  if (!LOCAL_HOSTS.has(host)) throw new GuardError(`Refused: database host "${safeHostLabel(host)}" is not local. The importer only runs against 127.0.0.1, localhost or ::1.`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new GuardError('Refused: the database URL has no database name.');
  if (PRODUCTION_NAME.test(database)) throw new GuardError(`Refused: database name "${database}" looks like a production or Railway database. Use a dedicated local database such as pih_local.`);
  const port = u.port ? Number(u.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new GuardError('Refused: invalid database port.');
  const config = {
    host: host === 'localhost' ? 'localhost' : host,
    port,
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database,
    ssl: false,
  };
  return { config, display: { host, port, database } };
}

// Minimal .env reader (KEY=VALUE per line). Only PIH_DATABASE_URL is looked at.
function readEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function insideGitRepo(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return true;
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

// The URL comes from the environment or from --env-file. Never from a command-line value.
function loadDatabaseUrl({ env = process.env, envFile } = {}) {
  let url = env.PIH_DATABASE_URL;
  if (envFile) {
    const real = fs.realpathSync(envFile);
    if (insideGitRepo(real)) throw new GuardError('Refused: the settings file is inside a Git repository. Keep it outside, for example ~/.config/pih/local.env.');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(real).mode & 0o077;
      if (mode) throw new GuardError('Refused: the settings file can be read by other users. Run: chmod 600 <file>');
    }
    url = readEnvFile(real).PIH_DATABASE_URL || url;
  }
  if (url && env.DATABASE_URL && url.trim() === env.DATABASE_URL.trim()) throw new GuardError('Refused: PIH_DATABASE_URL is the same as DATABASE_URL (the console database).');
  return url;
}

// Run after connecting: checks what the server actually is, not just what the URL said.
async function verifyConnectedServer(client, expectedDatabase) {
  const r = await client.query('select current_database() as db, inet_server_addr()::text as addr');
  const { db, addr } = r.rows[0];
  if (db !== expectedDatabase) throw new GuardError('Refused: connected database name does not match the requested one.');
  if (addr && !/^(127\.|::1)/.test(addr)) throw new GuardError('Refused: the database server address is not a loopback address.');
  const t = await client.query('select table_name from information_schema.tables where table_schema = current_schema() and table_name = any($1)', [CONSOLE_TABLES]);
  if (t.rows.length) throw new GuardError('Refused: this database contains Application Intelligence console tables (production marker). Use a dedicated database for the Hub.');
  return { database: db };
}

module.exports = { GuardError, parseLocalDatabaseUrl, loadDatabaseUrl, readEnvFile, verifyConnectedServer, LOCAL_HOSTS, CONSOLE_TABLES };
