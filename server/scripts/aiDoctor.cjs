// server/scripts/aiDoctor.cjs
//
// First command to run after cloning or pulling. Checks, read-only, that this checkout can run the local
// Application Intelligence commands, and says exactly how to fix anything that is wrong.
//
//   node server/scripts/aiDoctor.cjs
//
// It changes nothing, sends no credentials, and makes no request except a DNS lookup of public control hosts.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { preflight, repoRoot, nodeMajor, REQUIRED_NODE_MAJOR, BRANCH } = require('./lib/preflight.cjs');
const { hasEgress } = require('../services/appIntelligence/egress.cjs');

const REQUIRED_FILES = [
  'server/scripts/validateIntegrations.cjs', 'server/scripts/measureLatency.cjs', 'server/scripts/checkBundleKeyExposure.cjs',
  'server/scripts/appIntelligenceTargets.cjs', 'server/scripts/lib/preflight.cjs', 'server/scripts/lib/cli.cjs',
  'server/services/appIntelligence/checker.cjs', 'server/services/appIntelligence/egress.cjs',
];

const git = (args) => { try { return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

async function main() {
  preflight();
  const root = repoRoot(); const rows = []; const add = (ok, label, fix, warnOnly = false) => rows.push({ ok, label, fix, warnOnly });

  const major = nodeMajor();
  add(major >= REQUIRED_NODE_MAJOR, `Node ${process.versions.node} (project requires ${REQUIRED_NODE_MAJOR}+)`,
    major >= REQUIRED_NODE_MAJOR ? '' : `Optional for these read-only commands. To use Node ${REQUIRED_NODE_MAJOR}: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR} (changes only this terminal).`, true);

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  add(branch === BRANCH, `Git branch: ${branch || 'not a git checkout'} (expected ${BRANCH})`, `git checkout ${BRANCH}`);
  const head = git(['rev-parse', '--short', 'HEAD']);
  if (head) add(true, `Commit: ${head}`, '');
  const dirty = git(['status', '--porcelain']);
  add(true, dirty ? 'Working tree has local changes (informational; they are yours)' : 'Working tree clean', '');

  const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(root, f)));
  add(missing.length === 0, missing.length ? `MISSING files: ${missing.join(', ')}` : `All ${REQUIRED_FILES.length} required script files are present`,
    `Your checkout is older than the branch. Run:  git pull origin ${BRANCH}   (then re-run this command)`);

  const egress = await hasEgress({ useCache: false });
  add(egress, egress ? 'This machine can resolve public hostnames (control probe passed)' : 'No outbound internet for the control probe', 'Connect to the internet or use another machine. The validation commands refuse to produce results without it.');

  rows.forEach((r) => { console.log(`${r.ok ? 'PASS' : r.warnOnly ? 'WARN' : 'FAIL'}  ${r.label}`); if (!r.ok && r.fix) console.log(`      -> ${r.fix}`); });
  const failed = rows.filter((r) => !r.ok && !r.warnOnly);
  console.log(failed.length ? '\nNot ready: fix the FAIL lines above.' : '\nReady. Next: see docs/APPLICATION_INTELLIGENCE_LOCAL_RUNBOOK.md');
  process.exit(failed.length ? 1 : 0);
}

module.exports = { REQUIRED_FILES };
if (require.main === module) main();
