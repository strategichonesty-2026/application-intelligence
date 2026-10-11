// server/scripts/lib/cli.cjs
// Small command-line helpers. Secrets are never accepted on the command line, because argv appears in
// shell history and in the process list of every user on the machine.
'use strict';

/** Reads a line from the terminal WITHOUT echo. Rejects when there is no interactive terminal. */
function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error('No interactive terminal available for a hidden prompt.'));
    process.stderr.write(prompt);
    const stdin = process.stdin; let buf = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stderr.write('\n'); return resolve(buf); }
        if (c === '\u0003') { stdin.setRawMode(false); process.stderr.write('\n'); return process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1); else buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

/** True if any argument looks like an attempt to pass a secret on the command line. */
function secretOnCommandLine(argv, flags = ['--key', '--api-key', '--secret', '--previous-key', '--password']) {
  return argv.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`)));
}

const argValue = (argv, flag, fallback) => { const i = argv.indexOf(flag); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };

module.exports = { readHidden, secretOnCommandLine, argValue };
