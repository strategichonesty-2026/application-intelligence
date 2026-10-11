> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# The six decisions: status, evidence and rotation plan

Everything below is development-only. **Nothing was merged, deployed, rotated, revoked or changed in production, and no billing
setting was touched.** No dashboard (Railway, Netlify, Cloudflare, Pages, any provider) was reachable from this environment, and
outbound requests to the production sites are blocked by its network policy (confirmed: a plain request to both front-end hosts is refused at the proxy), so
**no production setting is verified**. Labels: **Verified** (seen in code or reproduced by a local test), **Inferred** (follows from code), **Unverified** (needs you to look).

| # | Decision | Status |
|---|---|---|
| 1 | ElevenLabs + Postiz | Inventory and rotation plan done (below, and in the Secrets page). **Awaiting your approval to rotate.** |
| 2 | Spending caps and alerts | Controls identified; **every provider's current configuration is Unverified**. Needs you at each billing page. |
| 3 | Scheduler authentication | **Prepared, tested, not merged**: branch `claude/scheduler-auth-migration` in the scheduler repo (head `6db6cb2b`). |
| 4 | Production configuration | **Blocked**: nothing verifiable from here. Exact read-only checks below. |
| 5 | Hardening | **Implemented and tested** on this branch; see `APPLICATION_INTELLIGENCE_HARDENING.md`. |
| 6 | Monitoring Worker | **Prepared, tested, not deployed**: branch `claude/monitor-no-daily-ai` in the monitor repo (head `3cf2fa3`). |

## Decision 1: ElevenLabs and Postiz

| | ElevenLabs (`ELEVENLABS_API_KEY`) | Postiz (`POSTIZ_API_KEY`) |
|---|---|---|
| Consumers [Verified in code] | Media Studio API only: voice routes, dialogue voice provider, credential health check. No other repo references it. | Media Studio API (`postiz.cjs`, health) **and** the Scheduler backend (`postiz.js`, `weeklyScheduler.js`). |
| Where configured | Server environment variable on the Media Studio service. Exact location: Unverified. | Server environment on **two** services. Exact locations: Unverified. |
| Exposure [Verified] | Three values committed to `.env` in this private repo (June 2026, commits `0a16b95`, `22040c1`, `e6be756`); removed from tracking in `3ae636e`. | A 64-char value committed in the Scheduler repo's `.env` / `.env.bak` (private). |
| Still active? | **Unverified.** Compare locally without printing: hash the last committed value and the value in your secret store and compare the hashes (command pattern in `APPLICATION_INTELLIGENCE_PRE_STAGING_AUDIT.md` §3.1). The ElevenLabs dashboard shows each key's last-used time. | **Unverified.** Same comparison; Postiz's settings page lists the key. |
| Browser impact of rotating | None (server-only) | None (server-only) |
| Dependencies | none | Two services must switch together |

**Rotation sequence (each step is an owner action; none performed):** (1) create a second key at the provider, leaving the old one valid; (2) set the new value on each service (Postiz: both services in the same window); (3) restart; (4) test one real call (a short voice line; one Postiz integration listing, not a publish); (5) delete the old key at the provider; (6) record the rotation date and evidence in Secrets & Subscriptions. **Rollback:** until step 5 the old key still works: put its value back and restart. After step 5 rollback means creating another key, so do step 5 only after a quiet day. Neither is part of the shared-key rotation and neither needs front-end changes, so both can go first.

## Decision 2: spending caps and usage alerts

Every provider below is **Unverified**: I could not open any billing page. The "control" column is my understanding of what each provider offers and must be confirmed at the provider (and corrected in the page if wrong). "Not Supported" is recorded only when you have confirmed a provider lacks the control.

| Service (used by) | Spend driver | Control to look for | Current configuration |
|---|---|---|---|
| Anthropic (Media Studio proxy, ProblemSignal, SHIOS, API) | Per-token usage; **reachable with the public shared key until it is rotated** | Monthly spend limit and usage alerts in the Console | Unverified |
| OpenAI (Strategic Honesty API, SHIOS) | Per-token usage | Monthly budget / alert thresholds | Unverified |
| Replicate (Media Studio, Scheduler) | Per-run usage | Billing limit / spend alerts | Unverified |
| Runway, Creatomate (Media Studio) | Credits per generation | Prepaid credit balance is itself the cap; low-balance alerts | Unverified |
| ElevenLabs (Media Studio) | Character quota per plan; overage if usage billing is on | Keep overage/usage billing off so the plan quota is the cap | Unverified |
| Postiz, Buffer (publishing) | Plan tier | Plan limits | Unverified |
| Railway (all services, Postgres) | Compute + storage usage | Usage alerts and a hard usage limit in billing settings | Unverified |
| Cloudflare (Pages, Workers, KV, R2) | Plan limits; R2 storage/operations | Billing notifications; Workers plan limits | Unverified |
| Netlify, Vercel | Plan limits / bandwidth | Plan limits and notifications | Unverified |
| Resend | Email volume per plan | Plan quota | Unverified |

In-application controls [Verified in code/tests]: generation routes limited to 20 requests/min per client, other API routes 100/min (now keyed on a spoof-resistant address); the Anthropic proxy is bounded (model family, `max_tokens` ≤ 4096, size cap); manual monitoring makes no AI or paid call. **Recommended order:** Anthropic limit first (it is the open-ended exposure), then Replicate, Railway, ElevenLabs overage setting, the rest. Record each result on the Subscriptions tab (cap status Verified/Unverified/Not supported); the page does not change any billing setting.

## Decision 3: Scheduler authentication migration (branch, not merged)

Design as built [Verified by 155 backend + 125 front-end tests, plus a build check]: the Scheduler backend gets its own owner sign-in (`SCHEDULER_OWNER_PASSWORD_HASH`, `SCHEDULER_SESSION_SECRET`, optional `SCHEDULER_SESSION_VERSION`); the front-end signs in **separately** to the Scheduler backend and to Media Studio (two passwords, two tokens, each in the scheduler origin's own `sessionStorage`); an origin-aware fetch wrapper sends each token only to its own service and nothing to other hosts; no server-to-server key is read by browser code; OAuth connect/callback paths stay public; the key keeps working for server callers and during rotation.
Finding worth knowing: Create React App inlines every `REACT_APP_*` variable present at build time **even when no code reads it any more**, so the branch's `npm run build` strips the two key variables and then fails the build if a key, `x-api-key` or `sh_api_key` appears in `build/`. Removing the variables from Netlify is still required. Not verified: the real Media Studio login against this client, the sign-in screen in a real browser (jsdom only), the proxy hop count, and any host that builds from `src/` (it would bypass the guard; `netlify.toml` uses the root build). Details, env vars, ordered steps and rollback: `docs/AUTH_MIGRATION.md` on that branch. Remaining risk it records: the Bluesky app password in `localStorage`, and old `*.bak` files in the tree and history that still contain key-bearing code.

## Decision 4: production configuration checks (all Unverified)

| # | Item | Evidence available | What the code says | Read-only way to verify (owner) |
|---|---|---|---|---|
| 1 | `SCHEDULER_AUTH` | No file in any repo sets it | Default is `log` = **no enforcement** | Railway → Scheduler backend service → Variables (name and value); or call a publishing route without a key and expect 401 (the monitor's lock check does exactly this if deployed) |
| 2 | Scheduler front-end build variables | Code reads `REACT_APP_API_KEY` and `REACT_APP_MEDIA_STUDIO_API_KEY`; the repo's own history shows a key was baked in before | CRA inlines whatever is set at build time | Netlify → Site settings → Environment variables (names only needed); or look for a 64-hex string in the live `main.*.js` (do not paste it anywhere) |
| 3 | Monitor Worker deployed/active | README says "not deployed yet" but is stale; `wrangler.toml` has a KV id and bindings; later commits reference a real outage | cron `*/15 * * * *`, no public URL | `npx wrangler deployments list --name strategic-honesty-monitor`; Cloudflare → Workers → Triggers/Logs; `npx wrangler secret list` (names only) |
| 4 | `sh-claude-proxy` authentication | **Source not in any repo I can read.** Clients (Media Studio browser code, pipeline, monitor) call it with no credential header | Anything enforced must be inside the Worker (Origin check, rate limit, secret) | Open the Worker's code in the Cloudflare dashboard, or send one tiny request with no Origin from your machine and see whether it answers (costs a fraction of a cent) |
| 5 | `DEBUG_READ_TOKEN` | Route code reviewed | Route answers 404 unless the variable is set; token compared in constant time | Railway variables: confirm the name is absent (or, if set, that it is long and random and the route is still needed) |
| 6 | Railway sleep/availability | `railway.json` sets `restartPolicyType: ON_FAILURE`, no sleep setting; a 04:00 daily content-cleanup cron already runs inside the API process | Nothing in the repo prevents or confirms sleeping | Railway → service → Settings (serverless / sleep toggle) and Metrics (restarts); the optional daily check should stay off until this is known |

## Decision 6: monitoring Worker

- **What it checks** [Verified in code]: Media Studio `/health` and `/api/health/credentials` (key; probes each provider credential without spending); Scheduler backend `/health`, link and report checks, a no-key probe of a publishing route; both websites and their bundles (key-in-bundle); SHIOS health; publishing calendar horizon; heartbeat to Telegram. Cron every 15 minutes; KV writes only on state change.
- **Deployed?** Unverified (item 3 above).
- **The daily Claude call:** one `claude-haiku` request with `max_tokens: 1` per day through `sh-claude-proxy`, proving the Anthropic path answers. Cost is negligible but non-zero, and it is the only routine AI call in the estate. Its operational benefit is narrow (it detects a broken Anthropic key or proxy before a user hits it) and nothing else in the system depends on it, so the branch makes it **opt-in and off by default** (`CLAUDE_DAILY_CHECK`), keeping every non-AI check, alert and the heartbeat, and making the heartbeat say "Claude: daily call is off, not checked" rather than imply it was verified.
- **Authentication-migration changes:** new per-site `KEY_IN_BUNDLE_MEDIA_STUDIO` / `KEY_IN_BUNDLE_SCHEDULER` settings (`expected` today, `forbidden` after each front-end migration). In `forbidden` mode the check passes when no privileged key is in the bundle and **alerts if a working key is found**, without printing any part of it. Without this change the Worker would raise a false "no key in bundle, every request will be refused" alert every 15 minutes once the Media Studio front-end is migrated.
- **Result:** 173 tests, 173 pass; nothing deployed; `BACKEND_API_KEY` must still be updated by you at rotation time.

## Credential rotation plan (shared key, ElevenLabs, Postiz)

0. **Now, no deploy:** spend limits (Decision 2); rotate ElevenLabs and Postiz (Decision 1, approval needed); confirm items 1, 3, 4 above.
1. Staging per `APPLICATION_INTELLIGENCE_DEPLOYMENT.md` §5 using throwaway secrets.
2. Production API: set `MEDIA_STUDIO_*`, `APP_INTELLIGENCE_*` sign-in values, review `TRUST_PROXY_HOPS` / CORS variables; deploy API first.
3. Media Studio front-end (key leaves the bundle); then flip the monitor's `KEY_IN_BUNDLE_MEDIA_STUDIO` to `forbidden`.
4. Scheduler: deploy the backend (accepts key or token), set `SCHEDULER_*` sign-in values, deploy the front-end, delete the two `REACT_APP_*_KEY` variables from Netlify, flip `KEY_IN_BUNDLE_SCHEDULER`; then set `SCHEDULER_AUTH=enforce` after confirming nothing legitimate still calls without credentials.
5. **Rotate the shared key (receivers before senders, overlap via `*_PREVIOUS`):** Scheduler backend (`MEDIA_STUDIO_API_KEY` new, `_PREVIOUS` old) → Media Studio API (`API_SECRET_KEY` new, `_PREVIOUS` old) → SHIOS backend → Cloudflare monitor secret → scripts. Watch the "used the PREVIOUS key" log lines until quiet, then delete both `_PREVIOUS` variables.
6. Record every step and its evidence in Secrets & Subscriptions.
**Rollback:** put the old value in the `_PREVIOUS` variable and restart; bump the `*_SESSION_VERSION` variables to end all browser sessions; redeploy the previous front-end builds (they work until step 5 finishes).

## Next actions that need your approval
Rotating ElevenLabs/Postiz; merging or deploying any branch (this repo, scheduler, monitor); setting production variables; seeding the inventory; enabling anything automatic; rotating the shared key.
