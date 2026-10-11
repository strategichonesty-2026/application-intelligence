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
console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
