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
   - **Database (easiest: reuse your existing Postgres login, with this app's own database name).** Set `DATABASE_URL` to a *reference* to the existing connection URL (in the value box type `${{`, wait for the dropdown, pick the service that already has `DATABASE_URL` (your Postgres service, or the Media Studio service) and choose `DATABASE_URL`). Then set `APP_INTELLIGENCE_DB_NAME` = `application_intelligence_staging` (the app swaps this name into the URL, so it never touches the existing database) and `APP_INTELLIGENCE_CREATE_DATABASE` = `true` (the app creates that database itself on first start if it is missing; remove this variable afterwards if you like). Note that this reuses the same database login as the other app: a separate database name isolates the data, but the login itself can still reach the other databases on that server. A dedicated database user is stronger and is a later improvement.
   - Alternatives: the five separate variables `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (no URL to get wrong), or a full URL with no `APP_INTELLIGENCE_DB_NAME`. At start-up the app names the problem in plain words if the settings are wrong; it never prints a value.
   - **Sign-in, easy:** `APP_INTELLIGENCE_OWNER_PASSWORD` = a passphrase of 16 or more characters (letters, spaces and digits are fine; four unrelated words plus a number works well). The app makes the hash and signing secret itself at start-up. Use a passphrase you use nowhere else: it is stored as a service variable. The start-up log says `sign-in: ready` (or names what is wrong; it never prints a value).
   - **Sign-in, stronger:** `APP_INTELLIGENCE_OWNER_PASSWORD_HASH` and `APP_INTELLIGENCE_SESSION_SECRET` from `node server/scripts/hashOwnerPassword.cjs`, so no passphrase is stored as text. If both styles are set the hash wins. Railway can alter `$` signs in a pasted hash; a damaged hash is reported at start-up.
   - Optional: `APP_INTELLIGENCE_ENV=production`, `TRUST_PROXY_HOPS=1` (set 2 if Cloudflare also proxies the hostname), Resend and heartbeat variables.
   - Leave `APP_INTELLIGENCE_SCHEDULE` unset (monitoring stays manual).
4. **Deploy**, then open the service address. You should see the sign-in screen. Check `GET /healthz` returns `{"status":"ok"}`.
5. **Load the starting records**: sign in, open **Settings → Suggested starting records**, check the preview and click **Load missing records**. It adds only what is missing (applications are matched by web address, so ones you registered yourself are skipped), runs no check, and changes or deletes nothing. (The command-line seed scripts below do the same and are optional.)
5b. **Seed from the command line** (optional, approval-gated), from your computer against the new database only:
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

## Optional: view-only sign-in (for showing friends)

Set one more variable on the service: `APP_INTELLIGENCE_VIEWER_PASSWORD` (16 or more characters, and different from the owner passphrase), then Deploy.

- Same sign-in page. The viewer passphrase opens a simple "App status" page: app names, Up / Slow / Down / Not sure, and when each was last checked.
- It never shows web addresses, error text, incidents, settings, or the Secrets & Subscriptions register, and it cannot run checks. The server refuses a viewer session on every other route (`test_viewer.cjs`).
- To switch it off, delete the variable and Deploy. To end viewer sessions early, change `APP_INTELLIGENCE_SESSION_VERSION` (this also ends the owner session).
- Anyone you give the passphrase to can see app names and status until you change or remove it.

## Sign-in reminders (hints)

Settings → **Sign-in reminders** lets the owner type a short reminder for the owner passphrase and, if view-only sign-in is on, one for the viewer passphrase. They appear under the sign-in box ("Forgot it? Reminders"). They are stored in the database, take effect immediately, and need no redeploy. They are public: the server refuses a reminder that contains, or equals, either passphrase or looks like a key. The `APP_INTELLIGENCE_PASSWORD_HINT` and `APP_INTELLIGENCE_VIEWER_PASSWORD_HINT` variables still work as a fallback until a reminder is saved.

There is no "reset by email". If a passphrase is forgotten, set a new value for `APP_INTELLIGENCE_OWNER_PASSWORD` (or `APP_INTELLIGENCE_VIEWER_PASSWORD`) in Railway Variables and Deploy.

## Telegram alerts (optional, free)

Telegram is a second alert channel next to email. It sends the same two messages (incident opened, recovered) and the test message. Nothing is sent unless both variables are set.

1. In Telegram, open **@BotFather**, send `/newbot`, follow the two questions. It gives you a **token** (looks like `123456789:AA...`). Treat it like a password.
2. Open your new bot and press **Start**, then send it any message.
3. Find your chat number: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser (replace `<TOKEN>`), and look for `"chat":{"id":123456789`. That number is the chat id. (Do not paste the token into chat or tickets.)
4. In Railway Variables add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`, then Deploy.
5. Settings → "Alerts: email and Telegram" → **Send test alert**. "Accepted" means Telegram took the message; confirm it on your phone.

If both email and Telegram are set, a message counts as sent when either accepts it. A channel that failed while the other worked is not retried (a retry would send the other copy twice).

## Ask: what is wrong? (no AI)

The Overview page has an **Ask** box. It reads your own records (checks, credential register, subscription register) and applies fixed rules: Critical (app confirmed down, key recorded as exposed), Needs attention (slow or never-checked apps, keys due for rotation or review, renewals within 7 days or past), Good to know (gaps in your records). It never calls an AI or any outside service and costs nothing. It only knows what is recorded, so empty records give "nothing wrong" together with a note that this is not proof.

## Uptime graph

System Health → **Uptime graph**: one bar per day per app, from recorded checks only (7 or 30 days; records are kept 30 days). A day with no checks is dotted, never counted as up. Visitor, login and watch counts are Phase 2 and not included.
