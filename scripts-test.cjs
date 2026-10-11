// Runs every test_*.cjs at the repository root, one after another, and fails if any fails.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const files = fs.readdirSync(__dirname).filter((f) => /^test_.*\.cjs$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}`);
  if (!ok) { failed++; console.log((r.stdout || '').split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 6).join('\n')); }
}
console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
