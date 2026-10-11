// test_dbconfig.cjs: start-up database settings are checked with plain-language messages that never contain a value.
const { describeConfigProblem: d } = require('./server/db.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const SECRET = 'pw#SECRETVALUE';
assert(d({ DATABASE_URL: 'postgresql://u:pw@host.example:5432/appdb' }) === null, 'a normal DATABASE_URL is accepted');
assert(/unresolved/.test(d({ DATABASE_URL: 'postgresql://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:5432/x' })), 'an unresolved ${{...}} placeholder is named as the problem');
assert(/quotes/.test(d({ DATABASE_URL: '"postgresql://u:pw@h:5432/x"' })) && /quotes/.test(d({ DATABASE_URL: ' postgresql://u:pw@h:5432/x' })), 'quotes or stray spaces are named as the problem');
const bad = d({ DATABASE_URL: `postgresql://user:${SECRET}@host:5432/db` });
assert(typeof bad === 'string' && /PGHOST/.test(bad) && !bad.includes(SECRET) && !bad.includes('user:'), 'a password with special characters breaks the URL form: the message suggests the PG* variables and never repeats the value');
assert(/must start with postgresql/.test(d({ DATABASE_URL: 'mysql://u:p@h:3306/x' })) && /database name/.test(d({ DATABASE_URL: 'postgresql://u:p@h:5432' })), 'wrong scheme or missing database name is explained');
assert(d({ PGHOST: 'h', PGPORT: '5432', PGUSER: 'u', PGPASSWORD: SECRET, PGDATABASE: 'db' }) === null, 'separate PG* variables are accepted (no URL, so special characters in the password are fine)');
assert(/incomplete: missing PGPASSWORD/.test(d({ PGHOST: 'h', PGUSER: 'u', PGDATABASE: 'db' })) && /No database settings/.test(d({})), 'missing or incomplete settings are listed by name');
assert(/unresolved/.test(d({ PGHOST: '${{Postgres.PGHOST}}', PGUSER: 'u', PGPASSWORD: 'p', PGDATABASE: 'db' })), 'an unresolved placeholder in a PG* variable is named as the problem');

// ── one server, this app's own database name ──
const { withDatabaseName: w, effectiveUrl: e, ensureDatabase } = require('./server/db.cjs');
assert(w('postgresql://u:pw@h:5432/railway', 'app_db') === 'postgresql://u:pw@h:5432/app_db' && w('postgresql://u:pw@h:5432/railway?sslmode=require', 'app_db') === 'postgresql://u:pw@h:5432/app_db?sslmode=require', 'database name is swapped into the URL, keeping the rest and any query string');
assert(w('postgresql://u:p#w/x@h:5432/railway', 'app_db') === 'postgresql://u:p#w/x@h:5432/app_db' || /app_db$/.test(w('postgresql://u:p%23w@h:5432/railway', 'app_db')), 'swapping works with unusual password text (plain string handling, no URL parsing)');
assert(e({ DATABASE_URL: 'postgresql://u:p@h:5432/railway', APP_INTELLIGENCE_DB_NAME: 'my_app' }).endsWith('/my_app') && e({ DATABASE_URL: 'postgresql://u:p@h:5432/railway' }).endsWith('/railway') && e({}) === undefined, 'the name override applies only when set');
assert(/APP_INTELLIGENCE_DB_NAME must be/.test(d({ DATABASE_URL: 'postgresql://u:p@h:5432/x', APP_INTELLIGENCE_DB_NAME: 'Bad-Name; DROP' })) && d({ DATABASE_URL: 'postgresql://u:p@h:5432/x', APP_INTELLIGENCE_DB_NAME: 'application_intelligence_staging' }) === null, 'a database name with anything but lowercase letters, digits and underscores is refused (no SQL can be smuggled in)');
(async () => {
  assert(await ensureDatabase({}) === 'skipped', 'no automatic database creation unless APP_INTELLIGENCE_CREATE_DATABASE=true');
  let bad = ''; try { await ensureDatabase({ APP_INTELLIGENCE_CREATE_DATABASE: 'true', APP_INTELLIGENCE_DB_NAME: 'x; DROP DATABASE y', DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x' }); } catch (err) { bad = err.code; }
  assert(bad === 'BADNAME', 'automatic creation refuses an unsafe name before connecting');
  if (process.env.AI_TEST_DATABASE_URL) {
    const base = process.env.AI_TEST_DATABASE_URL; const { Pool } = require('pg'); const admin = new Pool({ connectionString: w(base, 'postgres'), ssl: false });
    await admin.query('DROP DATABASE IF EXISTS ai_autocreate_test');
    const envx = { APP_INTELLIGENCE_CREATE_DATABASE: 'true', APP_INTELLIGENCE_DB_NAME: 'ai_autocreate_test', DATABASE_URL: base, APP_INTELLIGENCE_DB_SSL: 'off' };
    const first = await ensureDatabase(envx), second = await ensureDatabase(envx);
    const found = (await admin.query("SELECT 1 FROM pg_database WHERE datname='ai_autocreate_test'")).rows.length;
    assert(first === 'created' && second === 'exists' && found === 1, 'with the switch on, the database is created once and then reported as existing (real Postgres)');
    await admin.query('DROP DATABASE IF EXISTS ai_autocreate_test'); await admin.end();
  } else console.log('ℹ️  real-Postgres creation test skipped (set AI_TEST_DATABASE_URL)');
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
