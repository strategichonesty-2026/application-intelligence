// server/scripts/hashOwnerPassword.cjs
//
// Creates the two server-side values the Application Intelligence sign-in needs. Run it on a trusted
// machine; set the output as environment variables on the SERVER (Railway), never in the front-end build.
//
//   node server/scripts/hashOwnerPassword.cjs
//
// The password is read from the terminal WITHOUT echo and is never printed or written anywhere. It prints:
//   APP_INTELLIGENCE_OWNER_PASSWORD_HASH  a one-way scrypt hash (safe to store as a server variable)
//   APP_INTELLIGENCE_SESSION_SECRET       a fresh random signing secret (treat as a secret)
// For automation only, the password may be supplied as APP_INTELLIGENCE_NEW_PASSWORD (not recommended: shell history).
'use strict';

const crypto = require('crypto');
const { hashPassword, MIN_PASSWORD_LENGTH } = require('../services/appIntelligence/ownerAuth.cjs');
const { readHidden } = require('./lib/cli.cjs');
const { preflight } = require('./lib/preflight.cjs');

async function main() {
  preflight();
  let password = process.env.APP_INTELLIGENCE_NEW_PASSWORD;
  if (!password) {
    password = await readHidden(`Choose an owner password (at least ${MIN_PASSWORD_LENGTH} characters, a passphrase is best): `);
    const again = await readHidden('Repeat it: ');
    if (again !== password) { console.error('The two entries did not match. Nothing was created.'); process.exit(1); }
  }
  const hash = await hashPassword(password);
  const prefix = 'APP_INTELLIGENCE';
  const hashVar = 'APP_INTELLIGENCE_OWNER_PASSWORD_HASH';
  console.log('\nSet these two variables on the server (e.g. in Railway), then redeploy:\n');
  console.log(`${hashVar}=${hash}`);
  console.log(`${prefix}_SESSION_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
  console.log(`\nTo sign everyone out later: set ${prefix}_SESSION_VERSION to a new value (e.g. 2).`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
