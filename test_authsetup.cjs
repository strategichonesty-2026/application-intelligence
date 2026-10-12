// test_authsetup.cjs: easy passphrase set-up and plain-language sign-in diagnostics. Offline, dummy values.
const ownerAuth = require('./server/services/appIntelligence/ownerAuth.cjs');
let failures = 0;
const assert = (c, l) => { if (c) console.log(`✅ ${l}`); else { console.log(`❌ FAIL: ${l}`); failures++; } };
const PASS = 'dummy easy setup passphrase 77';
(async () => {
  const env = { APP_INTELLIGENCE_OWNER_PASSWORD: PASS };
  let r = await ownerAuth.prepareAuthEnv(env);
  assert(r.configured && r.mode === 'passphrase' && r.problems.length === 0, 'one variable (the passphrase) is enough: hash and signing secret are prepared at start-up');
  assert(await ownerAuth.verifyPassword(PASS, env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH) && !(await ownerAuth.verifyPassword('wrong passphrase of length', env.APP_INTELLIGENCE_OWNER_PASSWORD_HASH)), 'the prepared hash accepts the passphrase and nothing else');
  const tok = ownerAuth.issueToken(env).token; assert(ownerAuth.verifyToken(tok, env) !== null, 'a token issued with the derived secret verifies');
  const env2 = { APP_INTELLIGENCE_OWNER_PASSWORD: PASS }; await ownerAuth.prepareAuthEnv(env2);
  assert(env2.APP_INTELLIGENCE_SESSION_SECRET === env.APP_INTELLIGENCE_SESSION_SECRET && ownerAuth.verifyToken(tok, env2) !== null, 'the derived signing secret is stable across restarts (sessions survive a redeploy)');
  assert(env.APP_INTELLIGENCE_SESSION_SECRET.length >= 32 && !env.APP_INTELLIGENCE_SESSION_SECRET.includes(PASS), 'the derived secret is long enough and does not contain the passphrase');
  r = await ownerAuth.prepareAuthEnv({ APP_INTELLIGENCE_OWNER_PASSWORD: 'too short' });
  assert(!r.configured && r.problems.some((p) => /at least 16 characters/.test(p)), 'a short passphrase is refused with a plain message');
  r = await ownerAuth.prepareAuthEnv({ APP_INTELLIGENCE_OWNER_PASSWORD_HASH: 'scrypt$65536$8$2$abc', APP_INTELLIGENCE_SESSION_SECRET: 'x'.repeat(40) });
  assert(!r.configured && r.problems.some((p) => /not a valid scrypt hash/.test(p)), 'a damaged hash (for example one altered when pasted) is reported as invalid');
  r = await ownerAuth.prepareAuthEnv({});
  assert(!r.configured && r.problems.some((p) => /APP_INTELLIGENCE_OWNER_PASSWORD_HASH is not set/.test(p)), 'nothing set: the missing variables are named');
  const real = await ownerAuth.hashPassword(PASS); const env3 = { APP_INTELLIGENCE_OWNER_PASSWORD_HASH: real, APP_INTELLIGENCE_SESSION_SECRET: 's'.repeat(40), APP_INTELLIGENCE_OWNER_PASSWORD: 'another passphrase 1234' };
  r = await ownerAuth.prepareAuthEnv(env3);
  assert(r.configured && env3.APP_INTELLIGENCE_OWNER_PASSWORD_HASH === real && r.problems.some((p) => /hash is used/.test(p)), 'when both are set the hash wins and the conflict is reported');
  assert(![...r.problems].join(' ').includes(PASS) && ![...r.problems].join(' ').includes(real), 'no message contains a value');
  console.log(failures ? `\n${failures} FAILED` : '\nAll passed'); process.exit(failures ? 1 : 0);
})();
