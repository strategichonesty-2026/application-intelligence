# Deployment (separate service, separate database)

Nothing here has been done. Every step that creates a service, a database or a DNS record needs the owner's approval.

## What gets created
| Item | Detail | Cost note |
|---|---|---|
| Railway service | One small always-on Node service built from this repo (`railway.json`: build `npm run build`, start `node server/index.cjs`, health check `/healthz`). | A new always-on service: Railway bills by usage; the amount is **not measured**. The service is idle most of the time (no timers by default). |
| Database | A **separate database** (`application_intelligence`) inside your existing Railway Postgres server. | No new Postgres service. It shares that server: if the server is down, both apps are affected. |
| Address | Railway gives a `*.up.railway.app` address; optionally a custom domain such as `intelligence.strategichonesty.com` (a DNS record). | Domain already owned. |

## One-time setup (staging first, then production the same way)
1. **Create the database.** Open your Railway Postgres → Data/Query (or `psql` through Railway) and run: `CREATE DATABASE application_intelligence;` (use `application_intelligence_staging` for staging).
2. **Create the service.** Railway → New → GitHub repo → this repository. It picks up `railway.json`.
3. **Set variables** (service → Variables; never paste values in chat or commit them):
   - `DATABASE_URL`: the existing Postgres connection URL with the database name changed to `application_intelligence` (use Railway's variable reference to the Postgres host/credentials, then change only the database name).
   - `APP_INTELLIGENCE_OWNER_PASSWORD_HASH`, `APP_INTELLIGENCE_SESSION_SECRET`: from `node server/scripts/hashOwnerPassword.cjs` run on your own computer. Use a **new** passphrase, not one used elsewhere.
   - Optional: `APP_INTELLIGENCE_ENV=production`, `TRUST_PROXY_HOPS=1` (set 2 if Cloudflare also proxies the hostname), Resend and heartbeat variables.
   - Leave `APP_INTELLIGENCE_SCHEDULE` unset (monitoring stays manual).
4. **Deploy**, then open the service address. You should see the sign-in screen. Check `GET /healthz` returns `{"status":"ok"}`.
5. **Seed the starting records** (optional, approval-gated), from your computer against the new database only:
   `DATABASE_URL=<this app's database url> node server/scripts/seedApplications.cjs --apply --confirm-host <db host>` and the same for `seedInventory.cjs`. Both are dry runs without `--apply`, skip existing rows and never delete.
6. **Custom domain** (optional): Railway → Settings → Networking → add the domain, create the DNS record Railway shows. Then, if Cloudflare proxies it, set `TRUST_PROXY_HOPS=2`.

## Staging test plan
- Anonymous request to `/api/app-intelligence/summary` → 401; to a made-up `/api/x` → JSON 404; `/healthz` → ok.
- Wrong passphrase 6 times from one machine → the sixth is refused (429); the right passphrase from another network still works.
- Sign in; open every page; register an application as *manual only*; **Check now** once on a real test URL; **Check all** (manual-only apps must not appear).
- Add a credential record with a secret-looking value → refused with a message that does not repeat it.
- Leave it 24 hours: the database should show no new check rows (monitoring is manual).
- Open the browser console: no Content-Security-Policy violations.

## Rollback
Redeploy the previous Railway deployment, or delete the service; nothing else depends on it. The database holds only this app's data; dropping it removes only that. Bump `APP_INTELLIGENCE_SESSION_VERSION` to sign everyone out.

## Not verified here
The Railway setup itself (nothing was deployed), `TRUST_PROXY_HOPS`, outbound internet from the service (needed for checks), and whether your Postgres plan allows creating a second database. These are staging checks.
