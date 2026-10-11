// The eight Phase 1 applications. Check type starts as "homepage" (reachability only) for all of
// them until an owner confirms a dedicated, unauthenticated health endpoint. Paths are NOT assumed:
// validateIntegrations.cjs --discover-health looks for candidates, and an owner must confirm them.
//
// `mode` is how the application is checked (see services/appIntelligence/status.cjs MODES):
//   daily        (default here) included in the optional daily check, if the owner switches it on, and in Check all
//   manual_only  never in any schedule or Check all, only when the owner clicks Check now on it. It must use a
//                health endpoint check, so a check never loads the application's real pages.
'use strict';
const targets = [
  { name: 'SHIOS Intelligence', url: 'https://ai.intelligence.strategichonesty.com/', environment: 'production', note: '' },
  { name: 'PFOS', url: 'https://personal-financial-operating-system.vercel.app/dashboard', environment: 'production', sensitive: true, note: 'Holds financial data. Operational metadata only; response bodies are never read for homepage checks.' },
  { name: 'Travel Intelligence Agent', url: 'https://travel-intelligence-agent-production.up.railway.app/', environment: 'production', mode: 'manual_only', checkType: 'health_endpoint', checkPath: '/health',
    note: 'MANUAL ONLY. Its homepage runs 21 outbound link checks and may call paid travel APIs, so it is never requested by monitoring. Only /health (a static answer) is requested, and only when the owner clicks Check now. That proves the process is up, not that searches work.' },
  { name: 'Strategic Honesty Scheduler', url: 'https://scheduler.strategichonesty.com/', environment: 'production', note: '' },
  { name: 'Media Studio', url: 'https://media.strategichonesty.com/', environment: 'production', note: 'Front-end. Its API has a public /health, but that route returns a static "ok" and does not test the database.' },
  { name: 'ProblemSignal', url: 'https://problemsignal-production.up.railway.app/dashboard', environment: 'production', note: '' },
  { name: 'Unconfirmed application (possibly Home Hunting Agent)', url: 'https://web-production-95161.up.railway.app/', environment: 'production', unconfirmed: true, note: 'UNCONFIRMED: the owner must confirm what this service is. Not identified by this project.' },
  { name: 'Strategic Honesty API / AI Council', url: 'https://strategic-honesty-api-production-01dd.up.railway.app/', environment: 'production', note: '' },
];

const isManualOnly = (t) => t.mode === 'manual_only';
module.exports = Object.assign(targets, { isManualOnly });
