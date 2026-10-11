# Application Intelligence

A small, **separate** monitoring and operations console for the Strategic Honesty applications. It has its own server, its own
database, its own sign-in and its own address. It does not share code, secrets or a process with Media Studio.

- **Monitoring, manual first.** Register applications, then click *Check now* / *Check all*. Nothing runs automatically unless you set
  `APP_INTELLIGENCE_SCHEDULE=daily` (one check a day). No AI is ever involved in a check. Applications marked *manual only*
  (Travel Intelligence Agent) are never in Check all or any schedule.
- **Secrets & Subscriptions.** A hand-kept register of credentials (names, variable names, where each is stored, status, who depends on it,
  rotation order) and paid subscriptions (price, renewal, caps). It stores **no secret values** and rejects anything that looks like one.
- **Honest status.** "Reachable" is not "Healthy"; a monitoring failure is not an application outage; unknown stays unknown.

## How it is built

One Node service (`server/index.cjs`, Express) serves the console's static files and its API from the same origin:

```
browser  --HTTPS-->  application-intelligence service  --SQL-->  its own Postgres database
                      |  /healthz                 public, static
                      |  /api/app-intelligence/*  owner sign-in required (scrypt password, signed 8 h token)
                      |  everything else          the React console (Vite build in ./dist)
```

Same origin means **no CORS and no shared API key**. A strict Content-Security-Policy lets the page talk only to itself.
Dependencies: express, pg, dotenv, react, react-dom (no media, AI or provider SDKs).

## Run locally

```bash
nvm use 20
npm install
node server/scripts/hashOwnerPassword.cjs      # prompts (hidden) for a 16+ character passphrase; prints two variable lines
cp .env.example .env                           # add DATABASE_URL and the two printed lines (never commit .env)
npm run build
npm start                                      # http://localhost:3002
```
For front-end work: `npm start` in one tab and `npm run dev` in another (Vite proxies `/api` to port 3002).
`APP_INTELLIGENCE_DB_SSL=off` is for a local database only.

## Tests

`npm test` runs every `test_*.cjs` (offline; `test_appIntelligence_db.cjs` and the database part of `test_inventory.cjs` run only when `AI_TEST_DATABASE_URL` points at a scratch database).

## Deploying

See `docs/DEPLOYMENT.md` (separate Railway service + separate database, staging first, rollback, cost). Nothing is deployed by this repository's code.

## Docs

`docs/DEPLOYMENT.md` current deployment guide · `docs/EXTRACTION.md` what moved out of Media Studio and what did not ·
`docs/SECURITY.md` design and remaining risks · the other files are the earlier design records (see their history note).
