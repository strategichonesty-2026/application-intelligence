# Extraction from Media Studio

This app was first built inside the Media Studio repository (as a hidden `#/intelligence` section sharing its server and database).
It was extracted to be fully separate. **Nothing has been removed from Media Studio yet** (it keeps working as it is; it should drop the console only after this app is staged and accepted).

## Moved here (copied unchanged unless noted)
- `server/services/appIntelligence/*` (status rules, checker, store, monitor, alerts, heartbeat, egress, owner auth, inventory).
- `server/routes/appIntelligence.cjs` (API, same paths `/api/app-intelligence/*`).
- `src/intelligence/*` (the console). Changed: routes are now `#/…` instead of `#/intelligence/…`; the API base is the same origin; the "Back to Media Studio" link is gone.
- Scripts: seed, hash, validate, latency, doctor, bundle-key check, target lists. Tests for all of the above (`test_*.cjs`).

## New in this repo
`server/index.cjs` (serves API and console, `/healthz`, graceful shutdown), `server/db.cjs`, strict security headers (CSP), per-client rate limit, `railway.json`, `scripts-test.cjs`, `test_server.cjs`, `test_hardening.cjs`.

## Deliberately NOT carried over
Media Studio's shared API key and `requireApiKey`, its sign-in routes and session secrets, its CORS policy, its scheduler gate, the Anthropic proxy limits, and everything about publishing, generation and story production. This app has no shared key, no CORS and no knowledge of Media Studio's secrets.

## Data
Nothing needs migrating: the console was never deployed, so there is no production monitoring data. Starting records come from the seed scripts.

## Still to do in Media Studio (separate, approval-gated)
Remove `/#/intelligence`, the `appIntelligence` routes and the `ai_*` tables' creation from its server once this app is accepted; the `ai_*` tables there are unused and can be dropped later (destructive; only on your instruction).
