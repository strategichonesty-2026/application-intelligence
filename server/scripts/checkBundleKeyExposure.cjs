// server/scripts/checkBundleKeyExposure.cjs
//
// READ-ONLY check: is the server's shared API key present in a site's PUBLIC JavaScript?
//
//   node server/scripts/checkBundleKeyExposure.cjs --prompt https://media.strategichonesty.com/
//   (the key is typed at a hidden prompt; or set API_SECRET_KEY / API_SECRET_KEY_PREVIOUS in the environment)
//
// It downloads the page and its same-origin JavaScript files exactly as any anonymous visitor could
// (plain GET, no cookies, no credentials) and looks for the key's value. It prints ONLY yes/no per file:
// the key, any part of it, and any other secret are never printed, logged or written anywhere.
// It also reports whether an anonymous request is redirected to Cloudflare Access (evidence that the site
// is behind an Access login) or is served directly.
//
// Never put the key on the command line (this script refuses --key): argv is saved in shell history and
// visible in the process list. Do not paste it into chat.
'use strict';

const MAX_FILES = 40; const MAX_BYTES = 12 * 1024 * 1024;

function extractScripts(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)=["']([^"']+\.m?js)["']/gi)) {
    try { out.add(new URL(m[1], base).toString()); } catch { /* skip */ }
  }
  return [...out];
}

function extractChunkRefs(js, fileUrl) {
  const out = new Set();
  for (const m of js.matchAll(/["'](\.{0,2}\/?[\w./-]*assets\/[\w.-]+\.m?js|\.\/[\w.-]+\.m?js)["']/g)) {
    try { out.add(new URL(m[1].replace(/^assets\//, '/assets/'), fileUrl).toString()); } catch { /* skip */ }
  }
  return [...out];
}

async function getText(url, fetchImpl) {
  const res = await fetchImpl(url, { redirect: 'manual', headers: { 'user-agent': 'ApplicationIntelligence-KeyExposureCheck/1.0' } });
  const text = res.status >= 200 && res.status < 300 ? (await res.text()).slice(0, MAX_BYTES) : '';
  return { status: res.status, location: res.headers.get('location'), text };
}

/** @returns {{ access, files: [{file,bytes,containsKey,containsPreviousKey,mentionsKeyHeaderName}], summary }} */
async function checkSite(siteUrl, { key, previousKey, fetchImpl = fetch } = {}) {
  const home = await getText(siteUrl, fetchImpl);
  const loc = home.location ? new URL(home.location, siteUrl) : null;
  if (home.status >= 300 && home.status < 400 && loc && /cloudflareaccess\.com$/i.test(loc.hostname)) {
    return { access: { protected: true, evidence: `anonymous request redirected to ${loc.hostname}` }, files: [], summary: 'The site redirects anonymous visitors to a Cloudflare Access login, so its JavaScript was not downloaded.' };
  }
  const access = { protected: false, evidence: `anonymous request answered HTTP ${home.status} directly (no Cloudflare Access redirect)` };
  const queue = extractScripts(home.text, siteUrl); const seen = new Set(); const files = [];
  const origin = new URL(siteUrl).origin;
  while (queue.length && files.length < MAX_FILES) {
    const url = queue.shift();
    if (seen.has(url) || new URL(url).origin !== origin) continue;
    seen.add(url);
    const f = await getText(url, fetchImpl);
    if (!f.text) continue;
    files.push({
      file: new URL(url).pathname, bytes: f.text.length,
      containsKey: Boolean(key) && f.text.includes(key),
      containsPreviousKey: Boolean(previousKey) && f.text.includes(previousKey),
      mentionsKeyHeaderName: /x-api-key/i.test(f.text),
    });
    for (const ref of extractChunkRefs(f.text, url)) if (!seen.has(ref)) queue.push(ref);
  }
  const leaked = files.filter((f) => f.containsKey || f.containsPreviousKey);
  return {
    access, files,
    summary: !key ? 'No key was supplied, so only the header-name check was possible.'
      : leaked.length ? `The key IS present in ${leaked.length} of ${files.length} public JavaScript file(s). Anyone who loads the site can read it.`
        : `The key was NOT found in the ${files.length} public JavaScript file(s) checked.`,
  };
}

async function main() {
  require('./lib/preflight.cjs').preflight();
  const { readHidden, secretOnCommandLine } = require('./lib/cli.cjs');
  const argv = process.argv.slice(2);
  if (secretOnCommandLine(argv)) {
    console.error('REFUSED: never put a key on the command line (it would be saved in your shell history and visible in the process list).');
    console.error('Use the hidden prompt:  node server/scripts/checkBundleKeyExposure.cjs --prompt <https://site/>');
    process.exit(2);
  }
  const url = argv.find((a) => /^https?:\/\//.test(a));
  if (!url) {
    console.error('usage: node server/scripts/checkBundleKeyExposure.cjs --prompt <https://site/>');
    console.error('   or: set API_SECRET_KEY in the environment with a hidden prompt (see the runbook), then omit --prompt.');
    process.exit(1);
  }
  let key = process.env.API_SECRET_KEY; let previousKey = process.env.API_SECRET_KEY_PREVIOUS; let source = 'the API_SECRET_KEY environment variable';
  if (argv.includes('--prompt')) {
    try {
      key = await readHidden('Server API key (typing is hidden, nothing is printed or saved): ');
      previousKey = await readHidden('Previous key, if a rotation is in progress (Enter to skip): ');
      source = 'a hidden prompt';
    } catch (e) { console.error(`${e.message} Run this in an interactive terminal, or set the API_SECRET_KEY environment variable.`); process.exit(1); }
  }
  key = (key || '').trim(); previousKey = (previousKey || '').trim();
  if (!key) {
    console.error('No key was provided, so the key value cannot be compared. Only the "x-api-key" header name is checked.');
    console.error('Re-run with --prompt (recommended) or set API_SECRET_KEY.');
  } else {
    console.log(`Comparing against the key from ${source} (the value is never printed).`);
  }
  const r = await checkSite(url, { key: key || undefined, previousKey: previousKey || undefined });
  console.log(`Site: ${new URL(url).origin}`);
  console.log(`Cloudflare Access: ${r.access.protected ? 'YES' : 'NOT detected'}: ${r.access.evidence}`);
  r.files.forEach((f) => console.log(`  ${f.file}  ${Math.round(f.bytes / 1024)} KB  contains key: ${f.containsKey ? 'YES' : 'no'}${previousKey ? `  previous key: ${f.containsPreviousKey ? 'YES' : 'no'}` : ''}  mentions "x-api-key": ${f.mentionsKeyHeaderName ? 'yes' : 'no'}`));
  console.log(r.summary);
  console.log('Reminder: a YES means the key is publicly readable. It does not show the key was used by anyone. A NO is not proof of safety: see docs/APPLICATION_INTELLIGENCE_LOCAL_RUNBOOK.md.');
}

module.exports = { checkSite, extractScripts };
if (require.main === module) main().catch((e) => { console.error('failed:', e.message); process.exit(1); });
