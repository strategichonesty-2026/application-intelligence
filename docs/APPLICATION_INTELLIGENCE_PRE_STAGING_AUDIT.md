> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Final dependency audit before staging

Evidence-gathering and readiness review only. **Nothing was deployed, merged, rotated, revoked or changed in production, and no
repository other than this one was modified.** No secret value is printed here; where I compared values I compared one-way hashes
locally and report only "same / different". Labels: **[VERIFIED]** seen in code or by an isolated local test, **[INFERRED]**
follows from code but depends on configuration I cannot see, **[UNKNOWN]** needs you to look at a dashboard.

Limits of this review: there is no read access here to Railway, Netlify, Cloudflare or Pages settings, or to any live
environment. So **no deployment or environment-variable fact below is verified**; only source code and Git history are.

## 0. Correction

I did not remove or touch the `strategic-honesty-monitor` Cloudflare Worker. The file I deleted last turn was this repo's own
`server/appIntelligenceWorker.cjs` (an always-on second Railway service I had designed). The Cloudflare monitor is a separate
repo and is exactly as it was.

## 1. Consumer inventory (the shared key)

Repos inspected (read-only, shallow clones plus bounded history fetches): media-studio, strategic-honesty-scheduler (front-end **and** `src/backend`),
strategic-honesty-monitor, strategic-honesty-API, SHIOS, home-hunting-agent, tts-worker, chatbot, rag, job-alert, PFOS,
pfos-extractor, ProblemSignal, Travel-Intelligent-Agent, community-ops-hub, shios-tracker.

| # | Consumer | Uses the old shared key? | Evidence | Migrated? |
|---|---|---|---|---|
| 1 | Media Studio front-end (Cloudflare Pages) | Was `VITE_API_KEY` | [VERIFIED] code; the monitor even extracts the key from the live bundle with a `[a-f0-9]{64}` regex | **Yes, in code on this branch** (not deployed) |
| 2 | Media Studio API | Verifies it (`API_SECRET_KEY`, `_PREVIOUS`) | [VERIFIED] | Accepts key **or** session token |
| 3 | Pipeline / jobs inside the Media Studio API | Calls its own routes with it | [VERIFIED] | Server-side value, unchanged |
| 4 | **Scheduler front-end** (Netlify, CRA) | Two public build vars: `REACT_APP_API_KEY` (used by 8 components + SocialHub) and `REACT_APP_MEDIA_STUDIO_API_KEY` (services, WizardPanel, Dashboard, YouTube queue; also injected into every request to the Scheduler backend by `schedulerAuth.js`) | [VERIFIED] code. Whether the two vars hold the same value: [UNKNOWN] | **No** |
| 5 | **Scheduler backend** (`strategic-honesty-scheduler/src/backend`, Railway) | **Validates the same key**: its `MEDIA_STUDIO_API_KEY` env "must match" Media Studio's `API_SECRET_KEY` (`.env.example`); supports `MEDIA_STUDIO_API_KEY_PREVIOUS` | [VERIFIED] code. Auth mode defaults to **`log` (lets everything through)** unless `SCHEDULER_AUTH=enforce`; production value [UNKNOWN] | Not migrated; also **sends** the key to Media Studio (weekly schedulers, buffer alerts, link check) |
| 6 | `strategic-honesty-monitor` (Cloudflare Worker) | `BACKEND_API_KEY` secret as `x-api-key` to Media Studio (`/api/health/credentials`) and Scheduler backend (`/schedule/links`, report, `/calendar/posts`) | [VERIFIED] code | No |
| 7 | **SHIOS backend** | Sends its `MEDIA_STUDIO_API_KEY` to `POST /api/buffer-queue` (`backend/app/services/media_studio.py`) | [VERIFIED] code (new finding; previously unknown) | No |
| 8 | SHIOS front-end | No. Uses its own `SHIOS_API_KEY`, server-side (not `NEXT_PUBLIC_`) | [VERIFIED] | n/a |
| 9 | Strategic Honesty API / AI Council | No. Separate `X-Internal-Token`; Media Studio calls it with `STRATEGIC_API_TOKEN` | [VERIFIED] | n/a |
| 10 | PFOS, pfos-extractor | No. pfos-extractor checks its own `API_KEY` header | [VERIFIED] | n/a |
| 11 | tts-worker | No key at all: Media Studio calls `TTS_WORKER_URL` unauthenticated | [VERIFIED] code; whether the worker is reachable from the internet [UNKNOWN] | n/a (separate exposure, see §5) |
| 12 | home-hunting-agent, chatbot (Flowise), RAG, job-alert, ProblemSignal, Travel, community-ops-hub, shios-tracker | No reference found | [VERIFIED] by search of source + docs | n/a |
| 13 | Operator scripts (`testAuth*.sh`), the owner's shell/`.env` files | May hold it | [INFERRED] | Update at rotation |
| 14 | `sh-claude-proxy` Cloudflare Worker (Anthropic proxy) | Not the shared key, but called by the front-end **with no credential** (see §5) | [VERIFIED] client code; the Worker's source is in none of the repos I could read [UNKNOWN] | n/a |

**Where the key (or the other secrets) appears in Git history** (names and counts only):

| Repo | Finding |
|---|---|
| media-studio (577 commits fetched) | The shared key was **never** committed here. Only `.env` ElevenLabs lines, commits `0a16b95`, `22040c1`, `e6be756` (value lengths 52, 65, 65). [VERIFIED] |
| scheduler (389 commits) | One 64-hex value appears in `src/constants.js` and `src/SocialHub.jsx` history (plus `.bak` copies), **and as `REACT_APP_API_KEY` in committed `.env` / `.env.bak`** (`8f1c73c8`, `68499c8f`), i.e. the value baked into the scheduler front-end was committed. Also a second 64-hex `POSTIZ_API_KEY` in the same files, and `node_modules` is committed. Repo is private. [VERIFIED] Whether that first value equals today's `API_SECRET_KEY`: [UNKNOWN] (see §3 for a local one-way check you can run). |
| Other token formats (`sk-ant-`, `AKIA`, `ghp_`, `r8_`, `re_`, Slack/Google/Telegram) | None found in either repo's history. [VERIFIED] |

All sibling repos I inspected are private except Travel-Intelligent-Agent, community-ops-hub and shios-tracker (public; nothing relevant found in them).

**Summary**
- *Still require the old key:* Media Studio API (verifier), pipeline, Scheduler backend (verifier and caller), Scheduler front-end, Cloudflare monitor, SHIOS backend, scripts.
- *Already on another method:* Strategic Honesty API (internal token), SHIOS front-end, PFOS/extractor, Application Intelligence console.
- *Migrated in code but not deployed:* Media Studio front-end.
- *Unverified:* every production env value; the Scheduler backend's `SCHEDULER_AUTH` mode; whether the scheduler's two build variables match; the Cloudflare monitor's deployment; `sh-claude-proxy` protection; Netlify/Pages/Railway settings.

## 2. Scheduler front-end: findings and migration plan

### 2.1 Findings [VERIFIED unless noted]
- **Hosting split:** front-end on Netlify (`scheduler.strategichonesty.com`, redirects everything to `index.html`); backend a separate Railway service. The repo holds both (`src/` and `src/backend/`).
- **The front-end has no authentication of its own.** No login, no session. The only protection of anything it can reach is the shared key it ships to every visitor. Anyone who opens the site can read the key and publish.
- **Calls to Media Studio** (browser → `media…up.railway.app`): `/api/buffer-queue*` (list, needs-approval, quarantined, approve, restore, delete), `/api/assets*`, `/api/archive`, `/api/content*`, `/api/scheduled`, `/api/queue/:id`, `/api/pipeline`, `/api/jobs/auto-generate` (**paid pipeline**), `/api/claude/messages` (**pass-through to Anthropic on your key**), `/scheduler/posts*`, `/scheduler/media/*`.
- **Calls to the Scheduler backend:** `/posts*` (including `/posts/postiz/publish`, integrations), `/buffer/post`, `/buffer/channels`, `/calendar/posts`, `/audit*`, `/auth/status`, `/auth/disconnect`.
- **Server-to-server (must stay key-based):** pipeline → backend `/schedule/rows`; backend's weekly/YouTube schedulers and capacity alert → Media Studio; monitor → both; SHIOS backend → `/api/buffer-queue`.
- **OAuth:** LinkedIn and YouTube connect/callback are plain browser navigations on the Scheduler backend (`/auth/linkedin/connect`, `/auth/linkedin/callback`, `/auth/youtube/connect`, `/auth/youtube/service-callback`), kept public by `PUBLIC_OAUTH`; only `/auth/status` and `/auth/disconnect` are called with `fetch`. Media Studio has an equivalent pair under `/scheduler/auth/*` (kept public by `schedulerGate`). A header cannot ride a redirect, so these must stay public and rely on their one-time `state`.
- **Other browser-held secrets in that app:** a Bluesky app password stored in `localStorage` (`sh_bsky_apppw`), and an `sh_api_key` read from `localStorage`. Both are readable by any script on the page.

### 2.2 Why the Media Studio sign-in cannot simply be reused [VERIFIED/INFERRED]
1. **Different origin, different storage.** The token lives in `sessionStorage`, which is per-origin. `media.strategichonesty.com` and `scheduler.strategichonesty.com` cannot see each other's token, so the scheduler site needs its own sign-in.
2. **Different verifier.** The Scheduler backend is a separate service that only knows the key. A Media Studio token is signed with `MEDIA_STUDIO_SESSION_SECRET`; for the backend to verify it, it would need that secret (widening the blast radius) or call Media Studio to validate each token (a new runtime dependency and extra requests).
3. **Two audiences.** The browser talks to two APIs, so it needs two tokens, or one token both accept.
4. **CORS.** Media Studio's allowlist covers `*.strategichonesty.com` and `*.pages.dev`; the scheduler's `.env.example` lists a `*.netlify.app` origin that is **not** covered unless `ALLOWED_ORIGINS` includes it [UNKNOWN]. The Scheduler backend's CORS comes only from its `ALLOWED_ORIGINS`, and `Authorization` is **not** in its `allowedHeaders` default (cors reflects the request headers by default, so likely fine, but must be tested).
5. **Existing server callers** use the key and must keep working.

### 2.3 Proposed design (not implemented)
- **Scheduler backend:** add the same `createOwnerAuth` profile (own audience `scheduler`, own `SCHEDULER_OWNER_PASSWORD_HASH` / `SCHEDULER_SESSION_SECRET`), `POST /auth/login` + `GET /auth/session` (public like the OAuth routes), and let `apiAuth` accept a valid token **or** the key. Keep `PUBLIC_OAUTH` and `/health`. The key path remains for server callers and is controlled by the existing `_PREVIOUS` rotation support.
- **Scheduler front-end:** one sign-in screen that posts the owner's password to **both** `POST …/api/auth/login` (Media Studio, already built) and the new backend login, keeping the two tokens in `sessionStorage`. Replace the existing `schedulerAuth.js` fetch wrapper with an origin-aware one: Media Studio origin → Media Studio token, Scheduler backend origin → its token, anything else → nothing. Delete all `x-api-key` reads (about 25 call sites) and both `REACT_APP_*_KEY` variables, drop the `localStorage` key fallback, and move the Bluesky app password server-side later.
- **No change needed in Media Studio** for this (it already accepts its token and the scheduler origin passes CORS), except to confirm the Netlify origin.
- **Calls that stay key-based:** all server-to-server rows above.
- **Why I did not implement it:** it spans two deployables in a repo I can only change on a branch, depends on facts I cannot see (backend auth mode, whether the two build variables match, the Netlify origin, whether you want one password or two), and a half-migrated scheduler would lock you out of publishing. It needs your decisions in §7 first. When approved I can build it on a branch of that repo with offline tests (login, per-origin token routing, 401 handling, OAuth paths untouched, no key in the CRA bundle).

## 3. Credential rotation readiness

### 3.1 What is probably still active
- **`API_SECRET_KEY`**: [INFERRED] active. It is in a public bundle that is presumably live; the monitor's design assumes the key is readable from the live bundle. The value in Git history of the scheduler repo may be an older or the current value [UNKNOWN]. One-way local check you can run (prints only the word `SAME` or `DIFFERENT`, never a value):
  ```
  H1=$(git -C <scheduler clone> show 8f1c73c8:.env | grep '^REACT_APP_API_KEY=' | cut -d= -f2- | tr -d '\r\n' | shasum -a 256 | cut -c1-64)
  H2=$(printf %s "$API_SECRET_KEY_FROM_YOUR_SECRET_STORE" | tr -d '\r\n' | shasum -a 256 | cut -c1-64)
  [ "$H1" = "$H2" ] && echo SAME || echo DIFFERENT
  ```
  (Do not paste the secret on the command line if your shell records history; read it from a prompt or password manager.)
- **ElevenLabs**: [UNKNOWN]. Three versions were committed; `e6be756` ("with TTS permission") is the last, and the server still reads `ELEVENLABS_API_KEY`. Compare it with production the same way (`git show e6be756:.env`). ElevenLabs' dashboard shows each key's last-used time and lets you delete one. The repo is private [VERIFIED], which lowers but does not remove risk (every clone, CI cache and past collaborator has a copy).
- **`POSTIZ_API_KEY`** (publishing service) is also in the scheduler repo's committed `.env`; rotate it too [INFERRED active].
- **`ANTHROPIC_API_KEY`**: not exposed, but reachable indirectly through the proxies in §5.

### 3.2 Staged order (the important point: rotation only helps once no public bundle holds the new key)
Rotating before the browsers stop embedding the key would just republish the new key. So:

0. **Containment now (no key change, no deploy):** in the Anthropic, Replicate, ElevenLabs, Runway and Creatomate dashboards set spend caps/alerts and review recent usage for unfamiliar spikes; in Railway, look at request logs for the Media Studio API (valid-key requests are not logged by the app, so unfamiliar origins/user agents can only be seen there or in Cloudflare analytics). Rotate **ElevenLabs** and **Postiz** keys now: only the server's own env uses them, so it is a one-variable change each with no browser impact.
1. Staging per `APPLICATION_INTELLIGENCE_DEPLOYMENT.md` §5.
2. Production API with the Media Studio sign-in variables; then the new Media Studio front-end (key gone from that bundle).
3. Build and deploy the scheduler migration (§2.3): backend first (token or key accepted), then front-end; remove both `REACT_APP_*_KEY`.
4. Update the monitor so it stops expecting a key in the Media Studio bundle (its `frontendKeyChecks` would otherwise alert "No API key found … every request will be refused" every 15 minutes) and later the scheduler one.
5. **Rotate the shared key**, receivers before senders, with overlap windows:
   a. Generate the new value.
   b. **Scheduler backend:** `MEDIA_STUDIO_API_KEY`=new, `MEDIA_STUDIO_API_KEY_PREVIOUS`=old (it must accept the new one before Media Studio starts sending it).
   c. **Media Studio API (and any separate pipeline service):** `API_SECRET_KEY`=new, `API_SECRET_KEY_PREVIOUS`=old.
   d. **SHIOS backend** `MEDIA_STUDIO_API_KEY`=new; **Cloudflare monitor** `wrangler secret put BACKEND_API_KEY`; scripts/shell.
   e. Watch the "used the PREVIOUS key" log lines (hourly per distinct caller, no key material) on both services until quiet for several days.
   f. Delete both `_PREVIOUS` variables. The old key is dead.
6. Remove `VITE_API_KEY` from Cloudflare Pages settings; optionally scrub the scheduler repo's committed `.env`/`.bak`/`constants.js.*` files (Git-history rewriting is **not** part of this task).

### 3.3 Rollback
- Before 5f: put the old value back into the `_PREVIOUS` variable (or `API_SECRET_KEY`) on the affected service and restart; old callers work immediately.
- Bump `MEDIA_STUDIO_SESSION_VERSION` (and the scheduler's) to sign out every browser.
- A mis-set `SCHEDULER_AUTH=enforce` rollback is `log` (the mode is read at start-up).
- Front-end rollback: redeploy the previous build; it still works until step 5f because the old key is still accepted.

### 3.4 Recommended immediate containment (risk-ranked)
1. **Spend caps on every paid provider** (§3.2-0): the public key can start paid generation (`/api/jobs/auto-generate`, `/api/video/*`, `/api/images/*`, `/api/voice/*`) and reach an **open Anthropic pass-through** (`/api/claude/messages`, any model, any size, your key). This is the largest financial exposure.
2. Rotate ElevenLabs and Postiz now.
3. Confirm `SCHEDULER_AUTH=enforce` on the Scheduler backend; the monitor's `schedulerLockCheck` already tests this daily-ish if the Worker is running.
4. Consider a Cloudflare WAF rate-limit rule in front of the API hostname (no code change).

## 4. Monitoring behaviour and cost

### 4.1 Defaults in the code [VERIFIED by reading it and by `test_manual_monitoring.cjs`, 29 assertions passing]
- Automatic monitoring in Application Intelligence: **off**. `monitor.start()` creates no timer unless `APP_INTELLIGENCE_SCHEDULE=daily`; there is no `setInterval` in the scheduler; the dashboard's auto-refresh defaults to off.
- Check now / Check all work, with 10 s / 30 s cooldowns. Check all and the daily pass never include `manual_only` apps; **Travel is seeded `manual_only`** (health endpoint `/health` only). The validator and latency script skip/refuse it without an explicit flag.
- No LLM or paid provider is imported anywhere in the monitoring code (enforced by a test that checks every `require`).
- Existing rows in a database that already has the tables become `manual` (never checked automatically); the seed script does not modify existing rows.
- A second background job already lives in the same process: a 04:00 daily content-cleanup `node-cron` (`server/routes/content.cjs`). That is precedent for a daily in-process timer, but not proof the Railway service is awake then [UNKNOWN].

### 4.2 `strategic-honesty-monitor` (separate Cloudflare Worker)
- **Deployed?** [UNKNOWN]. The README says "not deployed yet" but is stale (later commits, e.g. the 2026-10-03 SHIOS check "catches the 2026-10-03 outage", read as if it is running); `wrangler.toml` has a real-looking KV namespace id and a service binding to `sh-claude-proxy`. Deployed "from the laptop" (`npm run deploy`), so no pipeline record exists. To find out, read-only: Cloudflare dashboard → Workers → `strategic-honesty-monitor` → Triggers/Logs, or `npx wrangler deployments list --name strategic-honesty-monitor` and `npx wrangler secret list --name strategic-honesty-monitor` (names only).
- **Schedule (in code):** cron `*/15 * * * *` (96 runs/day), no public URL.
- **What it calls:** Media Studio `/health` and `/api/health/credentials` (key); Scheduler backend `/health`, `/schedule/links`, a scheduler report, a no-key probe of a publishing route, `/calendar/posts` (key, daily); both websites' pages **and their JavaScript bundles** (to read the embedded key); SHIOS `/api/v1/health` (public); Telegram (alerts); optional ntfy; and **once a day a real Claude call** (haiku, `max_tokens: 1`) through `sh-claude-proxy`.
- **Credentials:** `BACKEND_API_KEY` (the shared key), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, optional `NTFY_*`.
- **If it were removed:** you would lose credential-drift detection (the incident it was built for), the Scheduler "lock" and link checks, the publishing-horizon check, SHIOS health, push alerts to your phone (Application Intelligence only emails, and only when a check runs), and the daily real-Claude check. None of that is replaced by manual-first Application Intelligence, which checks reachability/health of listed URLs only when you click.
- **Conclusion:** do not replace it; keep it, but (a) update its key checks when the bundles lose the key, (b) consider turning off the daily Claude call if you want zero routine AI usage (≈ one 1-token request a day), and (c) include `BACKEND_API_KEY` in the rotation. I did not modify it.

### 4.3 Costs that remain even with automatic monitoring off [none measured]
Railway: Media Studio API, Scheduler backend, SHIOS backend, other services, and Postgres(es); Cloudflare Pages and Workers (the monitor and `sh-claude-proxy`, subject to plan limits I have not verified); Netlify; domains; Anthropic/Replicate/ElevenLabs/Runway/Creatomate/Postiz usage when you generate or publish; optional Resend. Application Intelligence itself adds no service, no AI usage and no background process by default.

## 5. Review of the Media Studio authentication

Isolated local checks run for this review: `test_studio_auth.cjs` (33 assertions, mutation-checked) and a throwaway probe against the real login router, results below. Passing tests are **not** a claim that the application is production-secure.

| # | Severity | Finding | Status |
|---|---|---|---|
| A | **High** (pre-existing, not fixed by this branch) | The old key stays valid and public until step 5f; with it anyone can run paid generation and the open Anthropic pass-through `/api/claude/messages`. | [VERIFIED] |
| B | **High / unknown** | Browsers call `sh-claude-proxy.strategichonesty.workers.dev` with **no credential** (Media Studio `CreateTab`, `VideoTab`; pipeline). Unless that Worker enforces origin/rate limits itself, it is an open paid Anthropic endpoint. Its source is in none of the repos I could read. | client side [VERIFIED]; Worker controls [UNKNOWN] |
| C | **High / unknown** | Scheduler backend defaults to auth mode `log`: with `SCHEDULER_AUTH` unset, everything (publishing, OAuth token deletion) is reachable without any credential. | code [VERIFIED]; production value [UNKNOWN] |
| D | **Medium** (my code) | **Login lock-out:** the global limiter (30 failures / 15 min) can be filled by anyone, rotating `X-Forwarded-For`, so the real owner then gets 429. Probe: ~32 spoofed wrong guesses → correct password from a new client → **429**. | [VERIFIED] locally |
| E | **Medium** (my code) | **Per-client limit is bypassable** by rotating `X-Forwarded-For` (probe: 12 wrong guesses all processed). The app does not set `trust proxy`, so client identity is spoofable; only the global ceiling (≈ 2,880 guesses/day) bounds guessing. Acceptable only with a strong passphrase. | [VERIFIED] locally; real proxy behaviour on Railway [INFERRED] |
| F | **Medium** (pre-existing parser) | `express.json({limit:'50mb'})` runs before authentication, so an anonymous caller can make the server parse up to 50 MB per request to `/api/auth/login` (probe: 20 MB accepted, 0.7 s). Same for every route. | [VERIFIED] locally |
| G | **Medium** | scrypt N=16384 (the floor I enforce) is below the current OWASP recommendation (N=2¹⁷, r=8); hashes are server-only, so this matters only if the env leaks. | [VERIFIED] code |
| H | **Medium** | Token is in `sessionStorage`: readable by any XSS. The Pages site has no `_headers`/CSP (`public/` has none). A CSP is the main mitigation. | [VERIFIED] |
| I | **Medium** | CORS allows **every** `*.pages.dev` and `*.strategichonesty.com` origin and sets `credentials: true`. No cookies are used, so this does not expose the token, but it widens who can script the API from a browser, and a dangling subdomain would inherit trust. Use an exact allowlist; drop `credentials`. | [VERIFIED] |
| J | Low | No server-side logout or per-session revocation (global `…_SESSION_VERSION` bump only). 8-hour token. | by design |
| K | Low | One shared owner password, no MFA, no audit trail of successful sign-ins; failed session-token use is not logged. | [VERIFIED] |
| L | Low | `GET /health/youtube` is public (shows which YouTube variables are set); `/api/debug` is mounted before the gate but is inert unless `DEBUG_READ_TOKEN` is set (confirm it is unset in production). | [VERIFIED] code; env [UNKNOWN] |
| M | Info | Separation of sessions holds: distinct audience, token type, password and secret per surface; cross-use is rejected in both directions (tests). Authorization is all-or-nothing: any valid session has full privileges. | [VERIFIED] |
| N | Info | No secret, password, token or key fragment reaches logs in the exercised paths (test captures console output). | [VERIFIED] for tested paths |

Recommended fixes (not applied; they change behaviour and need your OK):
1. D/E: set Express `trust proxy` to the exact Railway hop count and key the limiter on `req.ip`; make the lock-out per client plus a *softer* global brake that never blocks a request from a previously successful client (e.g. a signed "known device" cookie), or accept D as the cost of a single-owner app.
2. F: mount a 1 kB JSON parser on `/api/auth/login` (and the console login) before the global 50 MB one.
3. G: raise scrypt cost to N=2¹⁷ after checking Railway memory headroom.
4. H/I: add a strict CSP via Pages `_headers`; exact-origin CORS allowlist.
5. A/B/C: containment in §3.4; require a session token (not the key) on `/api/claude/messages` once the front-ends are migrated, and add origin/rate limits or a credential to `sh-claude-proxy`.

## 6. Staging prerequisites and safe test plan

Prerequisites: a separate staging Railway project (API + scratch Postgres) with **different** secrets from production; a staging Pages (and Netlify, for the scheduler) deployment; the four sign-in variables with throwaway passwords; **no** production keys or databases; `APP_INTELLIGENCE_ALLOW_PRIVATE` unset; staging `API_SECRET_KEY` unrelated to production's.
1. API tests from `APPLICATION_INTELLIGENCE_DEPLOYMENT.md` §5.3, plus an anonymous call to `/api/claude/messages` and `/api/jobs/auto-generate` → 401 with a stub provider key (do not put a real Anthropic key on staging).
2. Front-end: sign in; open every tab; confirm in the browser network panel no request carries `x-api-key`, and that a stale token returns the sign-in screen.
3. Rotation rehearsal on staging only: steps 5a–5f, watching the previous-key log lines on both the API and the Scheduler backend.
4. Manual monitoring: seed, Check all (Travel absent), Check now on Travel (one `/health` request, verified from the target's access log), leave 24 h and confirm no new check rows.
5. Scheduler migration (when built): staging backend in `enforce`; OAuth connect/callback still work end-to-end with a test LinkedIn/YouTube app; publish to a sandbox integration only.
6. Negative tests: expired token, tampered token, token for the other audience, wrong origin, 20 MB body to login, rotating `X-Forwarded-For` (to confirm fixes D–F).

## 7. Decisions needed from you

1. Rotate ElevenLabs and Postiz keys now? (recommended)
2. Spend caps on all paid providers today? (recommended)
3. Do you want me to build the scheduler migration (§2.3) on a branch of that repo: one shared password for Media Studio and Scheduler, or separate ones?
4. Confirm facts only you can see: `SCHEDULER_AUTH` on the Scheduler backend; whether the two scheduler build variables hold the same key; whether the Cloudflare monitor is deployed; how `sh-claude-proxy` is protected; whether `DEBUG_READ_TOKEN` is unset; whether Railway services ever sleep.
5. Approve the security fixes in §5 (D–I) as a follow-up branch?
6. Keep the monitor's daily real-Claude call, or switch it off?
