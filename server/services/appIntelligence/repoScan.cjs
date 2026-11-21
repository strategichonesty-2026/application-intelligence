// server/services/appIntelligence/repoScan.cjs
//
// Command Center: turns a repository's FILE LIST (plus small text files) into SUGGESTIONS. Pure functions, no network.
//
// Rules (a suggestion only; the owner confirms; only confirmed applications/services are ever health-checked):
//   archived on GitHub                         -> archive
//   frontend AND deploy config                 -> application
//   deploy config, no frontend                 -> service
//   frontend only (no deploy config)           -> no suggestion (cannot tell a working app from a prototype)
//   code, no deploy config                     -> tool
//   no code (docs, data, images only)          -> content
//   empty or unreadable                        -> no suggestion
// Every suggestion carries the evidence it came from, in plain words.
'use strict';

const CODE_EXT = /\.(c?js|mjs|jsx|tsx?|py|go|rb|java|kt|rs|php|cs|sh|sql|ps1)$/i;
const FRONTEND_FILES = /(^|\/)(index\.html|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|svelte\.config\.[cm]?[jt]s|angular\.json)$/i;
const FRONTEND_DEPS = ['react', 'react-dom', 'vue', 'svelte', 'next', '@angular/core', 'vite'];

// deploy config file -> platform. Only ROOT-level files count: a nested sample file is not this repo's deployment.
const DEPLOY_FILES = [
  [/^railway\.(json|toml)$/i, 'Railway'], [/^nixpacks\.toml$/i, 'Railway'], [/^netlify\.toml$/i, 'Netlify'], [/^vercel\.json$/i, 'Vercel'],
  [/^render\.yaml$/i, 'Render'], [/^fly\.toml$/i, 'Fly.io'], [/^app\.yaml$/i, 'Google App Engine'], [/^procfile$/i, 'Procfile (Heroku-style)'],
  [/^dockerfile$/i, 'Docker'], [/^docker-compose\.ya?ml$/i, 'Docker Compose'],
];

const STACK_DEPS = { react: 'React', vue: 'Vue', svelte: 'Svelte', next: 'Next.js', vite: 'Vite', express: 'Express', fastify: 'Fastify', pg: 'PostgreSQL', 'pg-boss': 'pg-boss', bullmq: 'BullMQ', sharp: 'Sharp', puppeteer: 'Puppeteer', playwright: 'Playwright' };
const PY_DEPS = { flask: 'Flask', fastapi: 'FastAPI', django: 'Django', psycopg2: 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', psycopg: 'PostgreSQL', sqlalchemy: 'SQLAlchemy', requests: 'requests', playwright: 'Playwright', streamlit: 'Streamlit' };

const rootName = (p) => (p.includes('/') ? null : p);

function detectDeployConfig(paths) {
  const found = [];
  for (const p of paths) { const n = rootName(p); if (!n) continue; const hit = DEPLOY_FILES.find(([re]) => re.test(n)); if (hit) found.push({ file: p, platform: hit[1] }); }
  return found;
}

function parseJson(text) { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; } }

function detectStack(paths, pkg, requirements, language) {
  const out = new Set();
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [d, label] of Object.entries(STACK_DEPS)) if (deps[d]) out.add(label);
    if (pkg.engines && pkg.engines.node) out.add(`Node ${String(pkg.engines.node).replace(/[^0-9.]/g, '').split('.')[0] || ''}`.trim());
    else out.add('Node.js');
  }
  if (typeof requirements === 'string') {
    out.add('Python');
    for (const line of requirements.split('\n')) { const name = line.trim().split(/[<>=~!\[; ]/)[0].toLowerCase(); if (PY_DEPS[name]) out.add(PY_DEPS[name]); }
  } else if (paths.some((p) => /\.py$/i.test(p))) out.add('Python');
  if (paths.some((p) => rootName(p) && /^dockerfile$/i.test(p))) out.add('Docker');
  if (!out.size && language) out.add(language);
  return [...out].slice(0, 12);
}

/** First meaningful sentence of a README: skips titles, badges, images and link-only lines. */
function extractPurpose(readme) {
  if (typeof readme !== 'string') return '';
  for (const raw of readme.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^(#|>|```|---|===|\||<|!\[|\[!\[|-\s*\[)/.test(line)) continue;
    line = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    if (line.length < 12) continue;
    return line.length > 300 ? `${line.slice(0, 297)}...` : line;
  }
  return '';
}

/**
 * @param repo   { archived, language, description }
 * @param files  { paths: string[] (relative file paths), truncated?: bool, packageJson?: string, requirements?: string, readme?: string }
 * @param deployments  null (not readable) | [] (none recorded) | [{ state: 'success'|... , environment }] newest first
 */
function classify(repo, files, deployments) {
  const paths = Array.isArray(files && files.paths) ? files.paths : [];
  const pkg = files && files.packageJson ? parseJson(files.packageJson) : null;
  const config = detectDeployConfig(paths);
  const hasCode = paths.some((p) => CODE_EXT.test(p));
  const pkgDeps = pkg ? Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }) : [];
  const frontendBy = paths.find((p) => FRONTEND_FILES.test(p)) || (pkgDeps.find((d) => FRONTEND_DEPS.includes(d)) && 'package.json');
  const stack = detectStack(paths, pkg, files && files.requirements, repo.language);
  const purpose = extractPurpose(files && files.readme) || '';

  // Deployment: what GitHub or the config files show. Unknown stays unknown.
  let deployState; let deployEvidence; const platform = config[0] ? config[0].platform : '';
  if (Array.isArray(deployments) && deployments.length) {
    const latest = deployments[0];
    deployState = latest.state === 'success' ? 'deployed' : latest.state === 'failure' || latest.state === 'error' ? 'failed' : config.length ? 'configured' : 'unknown';
    deployEvidence = `Latest GitHub deployment: ${latest.state || 'no status'}${latest.environment ? ` (${latest.environment})` : ''}`;
  } else if (config.length) { deployState = 'configured'; deployEvidence = `Deploy config found: ${config.map((c) => c.file).join(', ')}. No deployment record on GitHub, so it is not shown as deployed.`; }
  else if (deployments === null) { deployState = 'unknown'; deployEvidence = 'No deploy config file found; GitHub deployments could not be read.'; }
  else { deployState = 'none'; deployEvidence = 'No deploy config file and no GitHub deployment record found.'; }

  const base = { suggestedPurpose: purpose, stack, deployPlatform: platform, deployState, deployEvidence };
  if (repo.archived) return { ...base, suggestedKind: 'archive', kindEvidence: 'Archived on GitHub.' };
  if (!paths.length) return { ...base, suggestedKind: null, kindEvidence: 'The repository file list is empty or could not be read.' };
  const trunc = files.truncated ? ' (file list was cut short by GitHub)' : '';
  if (frontendBy && config.length) return { ...base, suggestedKind: 'application', kindEvidence: `Frontend (${frontendBy}) and deploy config (${config[0].file})${trunc}.` };
  if (config.length) return { ...base, suggestedKind: 'service', kindEvidence: `Deploy config (${config[0].file}) but no frontend files${trunc}.` };
  if (frontendBy) return { ...base, suggestedKind: null, kindEvidence: `Frontend files (${frontendBy}) but no deploy config: cannot tell a working app from a prototype${trunc}.` };
  if (hasCode) return { ...base, suggestedKind: 'tool', kindEvidence: `Code but no deploy config or frontend${trunc}.` };
  return { ...base, suggestedKind: 'content', kindEvidence: `No code files found (documents, data or images only)${trunc}.` };
}

module.exports = { classify, extractPurpose, detectDeployConfig, detectStack };
