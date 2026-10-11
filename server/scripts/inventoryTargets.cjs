// Starting records for Secrets & Subscriptions. METADATA ONLY: names, variable NAMES, where things are used, and
// what is and is not known. No value of any credential appears here, and none was read from a .env file or from
// Git history for this file. Every statement is labelled with how it is known:
//   verification "inferred" = seen in source code / documents in the repositories, NOT checked in a live system
//   verification "unknown"  = nobody has checked
// Nothing is marked verified, rotated or revoked, because none of that has happened.
'use strict';

const SEEN = '2026-10-11 code review of the repositories (no live system was inspected)';
const c = (name, env, extra) => ({ name, environment: 'production', envVarName: env, status: 'unknown', verification: 'inferred', evidence: `Variable name seen in source code, ${SEEN}. Existence, validity and permissions in production not checked.`, storageReference: 'Not recorded (owner to fill in, e.g. password-manager entry name)', ...extra });
const k = (name, authMethod, migration, verification = 'inferred', extra = {}) => ({ name, environment: 'production', authMethod, migration, verification, impact: '', ...extra });

const credentials = [
  c('Media Studio shared API key', 'API_SECRET_KEY', {
    provider: 'Internal (Media Studio API)', applications: ['Media Studio', 'Scheduler', 'SHIOS', 'Monitor'], status: 'exposed',
    purpose: 'x-api-key for the Media Studio API and (same value) the Scheduler backend; also paid generation and the AI proxy.', permissions: 'Full access to protected Media Studio routes, including paid generation and the Anthropic pass-through.',
    evidence: `Code compiles it into the public Media Studio and Scheduler bundles (VITE_API_KEY / REACT_APP_*). ${SEEN}; the live bundles and the production values were not inspected.`,
    rotationStep: 5,
    consumers: [
      k('Media Studio front-end (Cloudflare Pages)', 'x-api-key from VITE_API_KEY (public bundle)', 'pending', 'verified', { impact: 'New build uses a sign-in token instead; not deployed yet.' }),
      k('Media Studio API (verifier)', 'Checks x-api-key or session token', 'not_needed', 'verified', { impact: 'Accepts API_SECRET_KEY_PREVIOUS during rotation.' }),
      k('Media Studio pipeline / jobs', 'x-api-key from server env (self-calls)', 'not_needed', 'verified', { impact: 'Server-side; must receive the new value with the API.' }),
      k('Scheduler backend', 'Validates MEDIA_STUDIO_API_KEY; also sends it to Media Studio', 'pending', 'verified', { impact: 'Must accept the new key BEFORE Media Studio sends it. Mode (SCHEDULER_AUTH) in production not checked.' }),
      k('Scheduler front-end (Netlify)', 'x-api-key from REACT_APP_* (public bundle)', 'pending', 'verified', { impact: 'Breaks at rotation unless migrated to sign-in; rebuilding with the new key would re-publish it.' }),
      k('strategic-honesty-monitor Worker', 'BACKEND_API_KEY secret as x-api-key', 'pending', 'verified', { impact: 'Alerts every 15 min after rotation until the secret is updated (if deployed: not verified).' }),
      k('SHIOS backend', 'MEDIA_STUDIO_API_KEY to POST /api/buffer-queue', 'pending', 'verified', { impact: 'Publishing hand-off from SHIOS fails until updated.' }),
      k('Operator scripts / shell', 'x-api-key from local env', 'unknown', 'inferred'),
    ],
    migrationNotes: 'Migrate both front-ends to sign-in first; rotating earlier only republishes the new key. See docs/APPLICATION_INTELLIGENCE_PRE_STAGING_AUDIT.md.',
    revocationImpact: 'Every consumer above stops working (401/403) until updated. No data is lost.',
    rollbackNotes: 'Put the old value back into API_SECRET_KEY_PREVIOUS (Media Studio) and MEDIA_STUDIO_API_KEY_PREVIOUS (Scheduler backend) and restart; remove the *_PREVIOUS values only after several quiet days.',
  }),
  c('Scheduler front-end build keys', 'REACT_APP_API_KEY', {
    provider: 'Internal (Netlify build variable)', applications: ['Scheduler'], status: 'exposed', purpose: 'Key embedded in the Scheduler browser bundle. A second variable, REACT_APP_MEDIA_STUDIO_API_KEY, is used the same way.',
    evidence: `Both variables are read by the Scheduler front-end code. A 64-character value was also committed in that repo's Git history (.env, constants.js). Whether either equals the current production key is unknown. ${SEEN}.`,
    rotationStep: 4, consumers: [k('Scheduler front-end (Netlify)', 'x-api-key', 'pending', 'verified', { impact: 'Replaced by sign-in on branch claude/scheduler-auth-migration (not merged).' })],
    migrationNotes: 'Delete both variables from Netlify after the sign-in build is live.', revocationImpact: 'Scheduler pages stop loading data until the sign-in build is deployed.', rollbackNotes: 'Redeploy the previous Scheduler build.',
  }),
  c('Scheduler backend key', 'MEDIA_STUDIO_API_KEY', { provider: 'Internal (Railway, Scheduler backend)', applications: ['Scheduler', 'Media Studio'], status: 'pending_migration', rotationStep: 5, purpose: 'Key the Scheduler backend both accepts and sends. Optional MEDIA_STUDIO_API_KEY_PREVIOUS for rotation.', consumers: [k('Scheduler backend', 'Validates and sends x-api-key', 'pending', 'verified')], rollbackNotes: 'Restore the old value in MEDIA_STUDIO_API_KEY_PREVIOUS.' }),
  c('SHIOS to Media Studio key', 'MEDIA_STUDIO_API_KEY', { provider: 'Internal (SHIOS backend)', applications: ['SHIOS', 'Media Studio'], status: 'pending_migration', rotationStep: 5, purpose: 'SHIOS backend sends it to Media Studio /api/buffer-queue.', consumers: [k('SHIOS backend', 'x-api-key', 'pending', 'verified')] }),
  c('Monitor Worker backend key', 'BACKEND_API_KEY', { provider: 'Cloudflare Worker secret', applications: ['Monitor'], status: 'pending_migration', rotationStep: 5, purpose: 'Lets the monitor call protected health routes.', evidence: `Secret name seen in the monitor repo README and code. Whether the Worker is deployed was not checked. ${SEEN}.`, consumers: [k('strategic-honesty-monitor', 'x-api-key', 'pending', 'verified', { impact: 'Update with wrangler secret put (owner action).' })] }),
  c('ElevenLabs API key', 'ELEVENLABS_API_KEY', {
    provider: 'ElevenLabs', applications: ['Media Studio'], status: 'rotation_required', purpose: 'Text-to-speech and voice listing.', permissions: 'Recorded commit says it has TTS permission.',
    evidence: 'Three values of this key were committed to this repo\'s .env in June 2026 (commits 0a16b95, 22040c1, e6be756; private repo). Whether the last committed value is still the live key is unchecked.',
    rotationStep: 1, consumers: [k('Media Studio API (voice routes, dialogue provider, credential health check)', 'xi-api-key header from server env', 'not_needed', 'verified', { impact: 'Voice generation fails until the new key is set.' })],
    migrationNotes: 'Server-only value: no browser impact. Create the new key first, update Railway, confirm a voice call works, then delete the old key in the ElevenLabs dashboard.',
    revocationImpact: 'Voice generation and the credential health check fail.', rollbackNotes: 'Keep the old key until the new one is confirmed working; if it fails, put the old value back in ELEVENLABS_API_KEY and restart.',
  }),
  c('Postiz API key', 'POSTIZ_API_KEY', {
    provider: 'Postiz', applications: ['Media Studio', 'Scheduler'], status: 'rotation_required', purpose: 'Publishing through Postiz integrations.',
    evidence: 'A 64-character POSTIZ_API_KEY value was committed in the Scheduler repo\'s .env/.env.bak history (private repo). Whether it is the live key is unchecked.',
    rotationStep: 1, consumers: [k('Media Studio API (postiz service)', 'Postiz API key from server env', 'not_needed', 'verified', { impact: 'Publishing through Postiz fails.' }), k('Scheduler backend (postiz service, weekly scheduler)', 'Postiz API key from server env', 'not_needed', 'verified', { impact: 'Scheduled publishing fails.' })],
    migrationNotes: 'Two services hold it: change both in the same window, or publishing from one fails.', revocationImpact: 'All Postiz publishing stops.', rollbackNotes: 'Keep the old key until both services are confirmed publishing; restore it on both if needed.',
  }),
  c('Media Studio sign-in', 'MEDIA_STUDIO_OWNER_PASSWORD_HASH', { provider: 'Internal', applications: ['Media Studio'], status: 'pending_migration', verification: 'unknown', purpose: 'Owner password hash + MEDIA_STUDIO_SESSION_SECRET for the browser sign-in.', evidence: 'Implemented on the development branch; not deployed, not yet set anywhere.', rotationStep: 2, consumers: [k('Media Studio API', 'scrypt password hash, signed session token', 'pending', 'verified')] }),
  c('Application Intelligence sign-in', 'APP_INTELLIGENCE_OWNER_PASSWORD_HASH', { provider: 'Internal', applications: ['Application Intelligence'], status: 'pending_migration', verification: 'unknown', purpose: 'Owner password hash + APP_INTELLIGENCE_SESSION_SECRET (must differ from the Media Studio pair).', evidence: 'Implemented on the development branch; not deployed.', rotationStep: 2, consumers: [k('Application Intelligence API', 'scrypt password hash, signed session token', 'pending', 'verified')] }),
  c('Scheduler sign-in', 'SCHEDULER_OWNER_PASSWORD_HASH', { provider: 'Internal', applications: ['Scheduler'], status: 'pending_migration', verification: 'unknown', purpose: 'Scheduler owner password hash + SCHEDULER_SESSION_SECRET (separate password from Media Studio).', evidence: 'Prepared on branch claude/scheduler-auth-migration; not merged or deployed.', rotationStep: 3, consumers: [k('Scheduler backend', 'scrypt password hash, signed session token', 'pending', 'verified')] }),
  c('Anthropic API key (Media Studio)', 'ANTHROPIC_API_KEY', { provider: 'Anthropic', applications: ['Media Studio'], purpose: 'Server-side key behind /api/claude/messages.', permissions: 'Unrestricted by this app except the new model/size limits.', consumers: [k('Media Studio API /api/claude/messages', 'x-api-key header from server env', 'not_needed', 'verified', { impact: 'AI proxy calls fail.' })], migrationNotes: 'Not exposed directly, but reachable through the shared key until it is rotated; set a spending limit.' }),
  c('Replicate API token', 'REPLICATE_API_TOKEN', { provider: 'Replicate', applications: ['Media Studio', 'Scheduler'], purpose: 'Image/video generation.', consumers: [k('Media Studio API', 'Bearer token from server env', 'not_needed', 'inferred'), k('Scheduler backend', 'Bearer token from server env', 'not_needed', 'inferred')] }),
  c('Runway API secret', 'RUNWAYML_API_SECRET', { provider: 'Runway', applications: ['Media Studio'], purpose: 'Video generation.', consumers: [k('Media Studio API', 'Bearer token from server env', 'not_needed', 'inferred')] }),
  c('Creatomate API key', 'CREATOMATE_API_KEY', { provider: 'Creatomate', applications: ['Media Studio'], purpose: 'Video rendering.', consumers: [k('Media Studio API', 'Bearer token from server env', 'not_needed', 'inferred')] }),
  c('Pexels API key', 'PEXELS_API_KEY', { provider: 'Pexels', applications: ['Media Studio'], purpose: 'Stock media search.', consumers: [k('Media Studio API', 'Authorization header from server env', 'not_needed', 'inferred')] }),
  c('Unsplash access key', 'UNSPLASH_ACCESS_KEY', { provider: 'Unsplash', applications: ['Media Studio'], purpose: 'Stock image search.', consumers: [k('Media Studio API', 'Client-ID from server env', 'not_needed', 'inferred')] }),
  c('Cloudflare R2 access key', 'R2_ACCESS_KEY_ID', { provider: 'Cloudflare R2', applications: ['Media Studio', 'Strategic Honesty API'], purpose: 'Object storage for generated media (paired with R2_SECRET_ACCESS_KEY).', consumers: [k('Media Studio API', 'S3-compatible access key pair', 'not_needed', 'inferred'), k('Strategic Honesty API', 'S3-compatible access key pair', 'not_needed', 'inferred')] }),
  c('Database connection (Media Studio)', 'DATABASE_URL', { provider: 'Railway Postgres', applications: ['Media Studio', 'Application Intelligence'], purpose: 'Application database. Contains a password inside the URL: never copy it into tickets or notes.', consumers: [k('Media Studio API', 'Connection string from server env', 'not_needed', 'verified')] }),
  c('Resend API key', 'RESEND_API_KEY', { provider: 'Resend', applications: ['Application Intelligence', 'Home Hunting Agent'], purpose: 'Alert / digest email.', consumers: [k('Application Intelligence (optional)', 'Bearer token from server env', 'not_needed', 'verified'), k('Home Hunting Agent', 'Bearer token from server env', 'not_needed', 'inferred')] }),
  c('YouTube OAuth client / refresh token', 'YOUTUBE_CLIENT_SECRET', { provider: 'Google Cloud (YouTube)', applications: ['Media Studio', 'Scheduler', 'Strategic Honesty API'], purpose: 'YouTube publishing (client secret and refresh token).', consumers: [k('Media Studio API', 'OAuth client + refresh token', 'not_needed', 'inferred'), k('Scheduler backend', 'OAuth client', 'not_needed', 'inferred')] }),
  c('LinkedIn OAuth client', 'LINKEDIN_CLIENT_SECRET', { provider: 'LinkedIn', applications: ['Media Studio', 'Scheduler'], purpose: 'LinkedIn publishing.', consumers: [k('Media Studio API', 'OAuth client', 'not_needed', 'inferred'), k('Scheduler backend', 'OAuth client', 'not_needed', 'inferred')] }),
  c('Strategic Honesty API internal token', 'INTERNAL_SERVICE_TOKEN', { provider: 'Internal', applications: ['Strategic Honesty API', 'Media Studio', 'Home Hunting Agent'], purpose: 'X-Internal-Token between services (Media Studio sends STRATEGIC_API_TOKEN).', consumers: [k('Media Studio mediaScan', 'X-Internal-Token (STRATEGIC_API_TOKEN)', 'not_needed', 'verified'), k('Home Hunting Agent', 'INTERNAL_SERVICE_TOKEN', 'not_needed', 'inferred')] }),
  c('Telegram bot token', 'TELEGRAM_BOT_TOKEN', { provider: 'Telegram', applications: ['Monitor'], purpose: 'Phone alerts from the monitor Worker.', consumers: [k('strategic-honesty-monitor', 'Bot API token (Worker secret)', 'not_needed', 'inferred')] }),
  c('Debug read token', 'DEBUG_READ_TOKEN', { provider: 'Internal', applications: ['Media Studio'], purpose: 'Temporary read-only production-plan route; inert (404) when unset.', evidence: `Route code reviewed; whether the variable is set in production is not checked. ${SEEN}.`, consumers: [k('Media Studio /api/debug', 'Bearer token', 'unknown', 'verified', { impact: 'Remove the variable when no longer needed.' })] }),
];

const s = (provider, service, applications, extra) => ({ provider, service, applications, plan: '', price: null, currency: 'USD', priceBasis: 'unknown', billingFrequency: 'unknown', status: 'unknown', capStatus: 'unknown', spendingCap: '', usageLimits: '', notes: `Seeded from code references only (${SEEN}). Plan, price, renewal and any spending cap have NOT been checked: fill them in from the provider's billing page.`, ...extra });
const subscriptions = [
  s('Railway', 'Hosting: APIs, workers and Postgres databases', ['Media Studio', 'Scheduler', 'SHIOS', 'Strategic Honesty API', 'ProblemSignal', 'Home Hunting Agent', 'Travel Intelligence Agent']),
  s('Cloudflare', 'Pages (Media Studio front-end), Workers (monitor, sh-claude-proxy), KV, R2', ['Media Studio', 'Monitor', 'Strategic Honesty API']),
  s('Netlify', 'Scheduler front-end hosting', ['Scheduler']),
  s('Vercel', 'PFOS hosting', ['PFOS']),
  s('Anthropic', 'Claude API (usage-based)', ['Media Studio', 'Monitor', 'ProblemSignal', 'SHIOS', 'Strategic Honesty API'], { billingFrequency: 'usage' }),
  s('OpenAI', 'API (usage-based)', ['Strategic Honesty API', 'SHIOS'], { billingFrequency: 'usage' }),
  s('Replicate', 'Image/video model runs (usage-based)', ['Media Studio', 'Scheduler'], { billingFrequency: 'usage' }),
  s('Runway', 'Video generation', ['Media Studio']),
  s('Creatomate', 'Video rendering', ['Media Studio']),
  s('ElevenLabs', 'Text-to-speech', ['Media Studio']),
  s('Postiz', 'Social publishing', ['Media Studio', 'Scheduler']),
  s('Buffer', 'Social publishing queue', ['Scheduler', 'Strategic Honesty API']),
  s('Resend', 'Transactional email', ['Application Intelligence', 'Home Hunting Agent']),
  s('Pexels / Unsplash', 'Stock media APIs', ['Media Studio']),
  s('RentCast / Recreation.gov / OpenRouteService', 'Data APIs', ['Home Hunting Agent']),
  s('Domain registrar and DNS', 'strategichonesty.com', ['All']),
];

module.exports = { credentials, subscriptions };
