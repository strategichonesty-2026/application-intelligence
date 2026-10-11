// server/scripts/lib/preflight.cjs
//
// Checks shared by the local Application Intelligence commands, so a wrong working directory, an old
// checkout or an old Node produce a clear message instead of a stack trace or a silent wrong result.
//
//  * requireRepoRoot(): the command must be run from the repository root (reports and --json files are
//    written relative to it, and the relative paths in the docs assume it). Exit code 3 otherwise.
//  * nodeNotice(): one line when Node is older than the project's Node 20. It never blocks and never
//    changes anything on the machine.
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_NAME = 'application-intelligence';
const REQUIRED_NODE_MAJOR = 20;
const BRANCH = 'main';

/** Repository root derived from where THIS file lives (never from cwd). */
const repoRoot = () => path.resolve(__dirname, '../../..');

function readPackageName(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name; } catch { return null; }
}

function requireRepoRoot({ cwd = process.cwd(), exit = (c) => process.exit(c), err = console.error } = {}) {
  const root = repoRoot();
  const here = readPackageName(cwd);
  if (path.resolve(cwd) !== root || here !== PROJECT_NAME) {
    err(`WRONG DIRECTORY: this command must be run from the repository root.`);
    err(`  You are in:       ${cwd}${here ? ` (a different project: "${here}")` : ' (no package.json here)'}`);
    err(`  Repository root:  ${root}`);
    err(`Fix:  cd "${root}"   and run the same command again.`);
    exit(3);
    return false;
  }
  return true;
}

function nodeMajor(version = process.versions.node) { return Number(String(version).split('.')[0]); }

function nodeNotice({ version = process.versions.node, log = console.error } = {}) {
  if (nodeMajor(version) >= REQUIRED_NODE_MAJOR) return false;
  log(`Note: Node ${version} detected; the project requires Node ${REQUIRED_NODE_MAJOR} or newer.`);
  log('  This read-only command uses only Node built-ins and is tested on this version, so it continues.');
  log(`  For everything else in the project use Node ${REQUIRED_NODE_MAJOR} (see docs/APPLICATION_INTELLIGENCE_LOCAL_RUNBOOK.md). Nothing on your machine is changed.`);
  return true;
}

/** Call first thing in a command: directory check, then the Node notice. */
function preflight(opts = {}) { if (requireRepoRoot(opts)) nodeNotice(opts); }

module.exports = { preflight, requireRepoRoot, nodeNotice, nodeMajor, repoRoot, PROJECT_NAME, REQUIRED_NODE_MAJOR, BRANCH };
