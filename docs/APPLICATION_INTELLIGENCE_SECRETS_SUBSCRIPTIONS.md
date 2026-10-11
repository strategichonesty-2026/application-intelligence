> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Secrets & Subscriptions (Application Intelligence page)

Console route: `/#/intelligence/secrets` (owner sign-in required, same as every console page). Implemented on branch
`claude/funny-johnson-xw51bq`; **not deployed, not seeded anywhere**.

## What it is, and is not

A **hand-maintained register**. It records which credentials exist, which applications depend on them, in what state they are,
and what paid services cost. It is **not** connected to any provider, bank or billing system, so it never says a credential is
valid, rotated or revoked on its own, and every price is whatever you typed. The page says this at the top and in each form.

It stores **no secret value**. Fields hold names, environment-variable *names*, and *references* to where a value is kept
("password-manager entry …"). Anything that looks like a secret (hex keys, `sk-`/`ghp_`/`AKIA`-style keys, bearer tokens, JWTs,
private-key headers, our own `scrypt$` hashes, Telegram tokens, long random-looking runs, credentials or key-like query strings in URLs)
is refused by the server with a message that names the field and never repeats the content. Nothing is imported from `.env` files or Git history.

## Features (implemented and tested)

- **Credentials:** name, provider, applications, environment, variable name, purpose, permissions, storage reference, status
  (Active, Rotation required, Exposed, Pending migration, Revoked, Unknown), evidence level (Verified / Inferred / Unknown), last verified,
  last rotated, next review, evidence text, migration notes, revocation impact, rotation order, rollback notes, and a list of consumers
  (name, environment, authentication method, evidence level, migration status, impact).
- **Honesty rules enforced by the server:** "Verified", "Revoked", or a rotation date are refused without evidence text and a verification date; rotated/verified dates cannot be in the future.
- **Subscriptions:** provider, service, applications, plan, price, currency, billing frequency, price basis (Verified / Estimate / Unknown), renewal date, trial end, usage limits, spending cap text and cap status (Verified / Unverified / Not supported / Unknown), status (Active / Cancelled / Unknown), billing page (https only, no query string), notes, last verified.
- **Costs:** monthly and annual totals per currency from *active, periodic, priced* subscriptions only; verified and estimated amounts are shown separately; usage-based, unknown-status, cancelled and unpriced rows are counted but left out; currencies are never added together; with no data the page shows no figure.
- **Dependencies:** per credential, the consumers with evidence level, authentication, migration state and impact; a "do not rotate yet" call-out listing consumers not yet migrated or unconfirmed; rotation order, impact if revoked, rollback notes; readiness = Ready / Verify consumers first / Blocked / Consumers unknown / Already revoked.
- **Dashboard:** counts by status and evidence level, items needing review (exposed, rotation-required, pending migration, review overdue), subscription count, known costs, upcoming renewals and trial ends (45 days, overdue dates flagged, not hidden).
- **Usability:** search, filters (status, provider, application, evidence level), sortable columns (missing dates always last), add/edit/delete, responsive layout using the console's existing design, keyboard-accessible tabs/dialogs. Checked at 1280 px and 390 px wide: no horizontal overflow.

## API (all under `/api/app-intelligence`, owner token only)

`GET /inventory`, `POST /credentials`, `PATCH|DELETE /credentials/:id`, `POST /subscriptions`, `PATCH|DELETE /subscriptions/:id`.
The shared API key and a Media Studio session are rejected (401). Tables `ai_credentials` and `ai_subscriptions` are created additively with the existing schema step (`CREATE TABLE IF NOT EXISTS`).

## Starting records

`node server/scripts/seedInventory.cjs` (dry run). `--apply --confirm-host <db host>` writes 24 credential and 16 subscription records
from `server/scripts/inventoryTargets.cjs`; existing records are skipped, nothing is updated or deleted. The seed contains names and
statuses only, taken from the code review: nothing is pre-marked verified, rotated or revoked, no price is invented, and every
subscription starts with an unknown plan, price and cap for you to fill in from the provider's billing page. It marks the shared key and the Scheduler bundle
keys *Exposed*, ElevenLabs and Postiz *Rotation required*, the sign-in secrets *Pending migration*, and everything else *Unknown*.

## Tests

`test_inventory.cjs` (44 assertions incl. a Postgres round trip when `AI_TEST_DATABASE_URL` is set; mutation-checked): secret rejection across 11 secret shapes and 5 fields plus nested and URL cases;
evidence rules; cost arithmetic (monthly/quarterly/annual, verified vs estimate, currencies, excluded rows); renewal windows; status summaries; dependency readiness;
seed validity; authorization (anonymous, shared key, Media Studio token and a forged token are all refused on every endpoint, nothing written); create/edit/revoke-without-evidence/delete; no secret in any response;
filtering, searching, sorting and money formatting; built bundles contain no 64-hex key, Anthropic-style key or `x-api-key`. A headless-browser run drove the page with mocked data on desktop and phone widths, including the refusal message for a secret-looking input.

## Deployment prerequisites and remaining work

- Deploy the API before the front-end (the page calls new routes). No new variables are required; the console sign-in pair must already be set.
- Seeding is a separate, approval-gated step; the page is usable empty.
- Not built: export/import, audit history of edits, reminders by email, per-field edit history, currency conversion, links from a credential to a specific monitored application record. The page does not and must not fetch anything from providers.
- Data lives in your Postgres database. It is metadata, but "which key is exposed and who depends on it" is sensitive: protect database access and backups accordingly, and keep the console sign-in separate from Media Studio's.
