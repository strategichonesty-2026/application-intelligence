> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Shared API key: dependency map, migration plan, containment, rollback

> **Superseded in part by `APPLICATION_INTELLIGENCE_PRE_STAGING_AUDIT.md`:** the Scheduler backend validates this same key (and defaults to a non-enforcing `log` mode), the SHIOS backend also sends it, the scheduler repo's Git history contains it, and rotating before the scheduler front-end is migrated would republish the new key. Where the two documents differ, the audit is correct.

**Status: code prepared and tested on branch `claude/funny-johnson-xw51bq`. Nothing deployed, nothing rotated, revoked or
changed in production. The production key and every production setting are untouched.** No secret value appears in this
document or in any test (tests use dummy values; this document records only names, lengths and file paths).

## 1. What was exposed, and where (confirmed from code)

| Secret | Where | How it is exposed | Evidence |
|---|---|---|---|
| `API_SECRET_KEY` (Media Studio API key) | `VITE_API_KEY` at front-end build time | Vite compiles every `VITE_*` value into the **public JavaScript** that every visitor downloads. Anyone can read it from the browser. It grants `x-api-key` access to every protected route: paid generation, publishing, deleting assets, `/scheduler/*`. | 11 front-end files read it (before this change). The old build test proved the dummy build key appeared in the shipped JS. |
| A second copy of a key | Scheduler front-end repo `strategic-honesty-scheduler`, `REACT_APP_MEDIA_STUDIO_API_KEY` (Create React App also embeds `REACT_APP_*` publicly) | Same mechanism, in that app's bundle. It calls Media Studio with `x-api-key`. **Not changed by this work** (different repo). Whether its value equals the Media Studio key is **unconfirmed**. | Code in that repo (read-only inspection). |
| `.env` committed to Git history | This repo, commits `26b27fa`, `0a16b95`, `22040c1`, `e6be756` (2026-05-25 … 2026-06-01); removed from tracking in `3ae636e`; `.env` is now in `.gitignore`. | Three historical versions contain an `ELEVENLABS_API_KEY` line (value lengths 52, 65, 65 — i.e. the key was replaced twice). Values were deliberately **not** printed. Whether the latest committed value is still the live key is **unconfirmed**. Repository visibility was not checked here. | `git log --all -- .env`. |

**Treat the browser-exposed key as compromised.** It has been public since the front-end first shipped with it; there is no
way to know whether it was copied. The correct fix is to stop shipping it (done in code) and then rotate it (after consumers
are migrated, below).

## 2. Who uses the shared key (dependency map)

Confirmed = seen in code. Production configuration (which deployment actually holds which value) is **not** assumed.

| # | Consumer | How it authenticates to Media Studio | Confirmed? | Migration |
|---|---|---|---|---|
| 1 | **Media Studio front-end** (browser) | `x-api-key` from `VITE_API_KEY` (public) | Confirmed in code | **Done in code:** sign-in + `Authorization: Bearer <session token>`; no key in the bundle. |
| 2 | **Media Studio API** (`requireApiKey`, `schedulerGate`) | Verifies the key | Confirmed | **Done:** accepts a valid session token **or** `x-api-key` (key still works). |
| 3 | **Background pipeline / jobs** (`server/routes/jobs.cjs`, `server/services/pipeline/runtime.cjs`) | Calls the API's own routes over HTTP with `API_SECRET_KEY` from the server's environment | Confirmed in code | Unchanged. Server-side value, never in a browser. Keeps working. Rotates together with the key (same service env). |
| 4 | **Scheduler backend** | The pipeline sends the shared key to it (`/schedule/rows`) | Confirmed that Media Studio sends it; what the scheduler backend validates is **unconfirmed** (not inspected) | Unchanged. Before rotating, check whether that service holds a copy of the key. |
| 5 | **Scheduler front-end** (`strategic-honesty-scheduler`) | `x-api-key` from `REACT_APP_MEDIA_STUDIO_API_KEY` on `/api/buffer-queue*`, `/api/assets`, `/api/archive`, `/api/content/cards` | Confirmed in that repo's code | **Not migrated (out of scope: other repo).** This is the main compatibility risk: after rotation it would stop working. Needs the same sign-in change in that app. |
| 6 | **Strategic Honesty monitor** (Cloudflare Worker, cron every 15 min) | `BACKEND_API_KEY` as `x-api-key` for backend health and `/api/content?type=ideas`, plus scheduler `/schedule/links` | Confirmed in that repo's code; whether it is deployed/running is unconfirmed | Not changed. It is **existing automatic monitoring** that this work does not control. Needs the new key at rotation time. |
| 7 | **Strategic Honesty API / AI Council** | Uses a **separate** `X-Internal-Token` (`INTERNAL_SERVICE_TOKEN`); Media Studio's `mediaScan.cjs` sends `STRATEGIC_API_TOKEN`. **Not the shared key.** | Confirmed in code | Independent. Not affected by rotating `API_SECRET_KEY`. |
| 8 | **Application Intelligence** | Own owner sign-in (own password hash + signing secret, audience `app-intelligence`). Does **not** accept the shared key. | Confirmed | Independent. |
| 9 | **Ops scripts** (`server/scripts/testAuth*.sh`) | May use the key from your shell | Confirmed they exist | Update local env at rotation. |
| ? | SHIOS, PFOS, Travel, ProblemSignal, tts-worker, home-hunting-agent, chatbot, rag, job-alert, community-ops-hub | No reference to the shared key found in the repos inspected; the others were **not inspected** | **Unconfirmed** | Search each for `x-api-key` / the key name before rotating. |

Auth separation after this change (each secret is different and useless against the others):

| Credential | Protects | Where it lives |
|---|---|---|
| `API_SECRET_KEY` | server-to-server calls to Media Studio | server env only (after migration) |
| `MEDIA_STUDIO_OWNER_PASSWORD_HASH` + `MEDIA_STUDIO_SESSION_SECRET` | the Media Studio web app (sign-in, 8 h tokens) | server env only |
| `APP_INTELLIGENCE_OWNER_PASSWORD_HASH` + `APP_INTELLIGENCE_SESSION_SECRET` | the monitoring console | server env only |
| `INTERNAL_SERVICE_TOKEN` / `STRATEGIC_API_TOKEN` | Strategic Honesty API | those services |

## 3. What was changed in code (implemented + tested)

- `server/services/appIntelligence/ownerAuth.cjs`: generalised into `createOwnerAuth(profile)`; the console behaves exactly as before. Each profile has its own audience, token type, hash and secret, so tokens do not cross over.
- `server/services/studioAuth.cjs`, `server/routes/studioAuth.cjs`: `POST /api/auth/login`, `GET /api/auth/session`. scrypt password, HMAC-SHA256 token (8 h, revocable with `MEDIA_STUDIO_SESSION_VERSION`), brute-force limiter, constant failure delay, fails closed with 503 when unconfigured, never logs a password/token/secret.
- `server/middleware/auth.cjs` (`requireApiKey`): accepts a valid session token **or** the shared key (unchanged messages and status codes: no credentials 401, wrong key 403, rotation window via `API_SECRET_KEY_PREVIOUS`). `schedulerGate` uses it, so every `/scheduler/*` route is protected; only the four OAuth browser-redirect `GET` paths stay public (callbacks are protected by their one-time `state`).
- Front-end: no file reads `VITE_API_KEY`. `src/utils/session.js` keeps the token in `sessionStorage` (gone when the tab closes) and a one-time `fetch` wrapper signs the user out cleanly when the server reports an expired session. `src/components/StudioSignIn.jsx` gates the whole app.
- Tests (all dummy values): `test_studio_auth.cjs` (33 assertions: login, wrong/empty password, cross-use between the two token types, expiry, tampering, `alg=none`, revocation, key still accepted, rotation window, **end-state with the key removed**, OAuth redirects, anonymous callers get 401 with no side effect on paid/delete/publish routes, throttling, fail-closed, no secret in logs; mutation-checked), `test_security_gate_scheduler.cjs`, `test_appIntelligence_auth.cjs` (a real production build with a dummy `VITE_API_KEY`: **the dummy appears in none of the shipped files, and `x-api-key` appears in none**; no source file reads `VITE_API_KEY`), plus a headless-browser run (sign-in screen, wrong password message, success, no request carries `x-api-key`).

## 4. Ordered migration plan (nothing below has been done)

Each step is reversible until step 8. Do staging first.

1. **Choose two different passwords.** Run `node server/scripts/hashOwnerPassword.cjs --for media-studio` and `node server/scripts/hashOwnerPassword.cjs` on a trusted machine (password is typed hidden, never printed or stored).
2. **Staging:** set the four values on the staging API, keep `API_SECRET_KEY`. Deploy the branch. The API now accepts **both** the key and tokens, so nothing breaks.
3. **Staging tests** (deployment doc §5): keyless → 401, wrong key → 403, key → 200, token → 200, console token on Media Studio → 401, OAuth redirects 302, `/scheduler/*` anonymous 401.
4. **Staging front-end:** deploy to a staging Pages project; sign in; exercise generation, library, queue, voice, scheduler pages.
5. **Production API first** (set the four values, deploy). Old front-end still works because the key is still accepted.
6. **Production front-end** (deploy; remove `VITE_API_KEY` from the Pages build settings). Users now sign in. Confirm in the browser's network tab that no request carries `x-api-key`.
7. **Migrate every other consumer of the key** (rows 5, 6, 9 and anything found in the unconfirmed repos): scheduler front-end gets a sign-in change in its own repo; the Cloudflare monitor and scripts get the *new* key.
8. **Rotate (only now):** generate a new `API_SECRET_KEY`; put the **old** value in `API_SECRET_KEY_PREVIOUS`; set the new one on the API, the pipeline service env, and the Worker/scripts. The API logs once per hour which callers still use the old key (path, user agent, origin; never any part of the key). When that log is quiet for a few days, delete `API_SECRET_KEY_PREVIOUS`. The old (public) key is then dead.
9. **ElevenLabs:** rotate the key in the ElevenLabs dashboard (regardless of anything else), update the server's `ELEVENLABS_API_KEY`, and delete the old key there.

## 5. Containment before rotation (no deletion needed)

- The Media Studio API is protected by CORS but the key is bearer-style; anyone holding the old key can call it from a script. The strongest immediate containment that needs no key change is to complete steps 2–6: once the new front-end ships, **no new copy of the key is published**; the old public bundle still contains it until step 8, so copies already taken stay valid until then.
- Optional stop-gap with no code change: put Cloudflare Access (or similar) in front of the front-end and API hostnames. Not implemented here.
- Do **not** delete the production key before step 7: the scheduler front-end, the Cloudflare monitor and any script would stop working at once (no data would be lost; they would receive 401/403).
- Rate limits already exist on the API (`standardLimiter`, `generationLimiter`), which bounds abuse of paid generation while the key remains valid.

## 6. Remaining compatibility risks

1. **Scheduler front-end (row 5)** still sends a key; it will break at rotation unless migrated. Until then, keep `API_SECRET_KEY_PREVIOUS` set.
2. **Cloudflare monitor (row 6)** will report the backend as failing after rotation until its `BACKEND_API_KEY` is updated; it runs every 15 min on its own.
3. **Scheduler backend (row 4)** — whether it validates the key it receives is unconfirmed.
4. **Unconfirmed repos** (list above) might hold the key.
5. **Users must sign in** to Media Studio. If `MEDIA_STUDIO_*` variables are missing, the screen says sign-in is not set up and the app is unusable until they are set (deliberately fail-closed). Deploy the API variables **before** the front-end.
6. **Token in `sessionStorage`**: readable by any script running in the page, as with any browser-held credential; it is short-lived (8 h), revocable, and scoped to Media Studio only. An httpOnly-cookie design would be stronger but needs CSRF protection and same-site hosting; proposed, not built.
7. **Single shared password** (one owner). Multi-user accounts are out of scope.

## 7. Rollback

- Before step 8, rollback is "redeploy the previous front-end/API commit": the key is still valid everywhere, so the old front-end works. Sign-in variables can stay set.
- After step 8 (rotation), if something breaks: put the old key back into `API_SECRET_KEY_PREVIOUS` (it is a server variable; restart) — callers still holding it work again immediately. This restores the old exposure, so only as a short-term measure.
- Emergency sign-out of all browsers: bump `MEDIA_STUDIO_SESSION_VERSION`.
- Nothing in this change deletes data; the `mode` column and `ai_*` tables are additive.

## 8. Decisions needed from you

1. Approve staging deployment (API first, then front-end).
2. Whether to migrate the scheduler front-end's key (separate repo; I can prepare that change in its repo if you approve).
3. Rotation date for `API_SECRET_KEY` and the ElevenLabs key (recommended: ElevenLabs now).
4. Whether to inspect the remaining repos for key use (SHIOS, tts-worker, etc.).
