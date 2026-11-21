# Backups and a safe restore test (Railway PostgreSQL)

Purpose: confirm that the console's data can be recovered, **without ever overwriting production**.
Nothing here changes production. Do the steps yourself in your own terminal; never paste a connection string into chat or into any file in this repository.

## Why this matters (plain words)
The console's database holds your repository list, portfolio, library and the credential/subscription register ("which key is exposed and who depends on it"). If the database is lost and no backup exists, that is gone. A backup you have never restored is only a hope, so we test one.

## Important warning: do NOT use Railway's "Restore" button as the test
Railway's volume backups are a **volume-level** feature. Restoring one creates a new volume, unmounts the original and redeploys the service on the restored data, and Railway states that backups can only be restored into the same project and environment ([Railway: Volume backups](https://docs.railway.com/volumes/backups)). If your console's database lives on the same Postgres server as other apps, a restore there affects **every database on that server**. So use Railway's backups as your safety net, and use the **logical dump test below** to prove recovery.

## Part 1: verify that backups exist (read-only, 5 minutes)
1. Railway → your project → the **Postgres service** (the one the console's `DATABASE_URL` points to).
2. Open the service **Settings** and find the **Backups** tab (Railway's docs place it in the service settings). Write down: is a schedule on (daily / weekly / monthly), and the date of the newest backup.
   - Railway's documented schedules are daily (kept 6 days), weekly (kept 27 days) and monthly (kept 89 days); you can enable several ([Railway: Volume backups](https://docs.railway.com/volumes/backups)).
   - Railway's page does not say which plans include backups. If the tab is missing or empty, your plan or setup may not provide them: that is the finding to record.
3. Check that the Postgres service has a **volume** attached (backups need one).
4. Record the result in the table at the end of this page. **If no schedule is on, tell me and we decide together** (turning one on may add a small usage cost; Railway bills backups per GB, only for data unique to each backup).

## Part 2: prove you can restore (into a separate database, on your computer)
This copies the console's database to a file and loads it into a **local** throwaway database. Production is only ever read.

### What you need
- A local PostgreSQL (version 16 or newer, matching the server or newer). Quickest: Docker (`docker run --name restore-test -e POSTGRES_PASSWORD=choose-a-throwaway-one -p 5433:5432 -d postgres:16`) or your usual local install.
- `pg_dump`, `pg_restore`, `psql` on your PATH.

### Step A: get read access to the production database safely
Railway databases are private by default. To dump from your computer you must temporarily add **Public Access** (a TCP proxy) in the Postgres service's **Settings → Networking**, which fills `DATABASE_PUBLIC_URL`; Railway bills network egress for traffic through it, including the dump ([Railway: PostgreSQL](https://docs.railway.com/databases/postgresql)). A console dump is small, so the cost should be negligible, but it is not measured here.
**Remove Public Access again when you are finished** (Step E).

### Step B: dump (read-only)
In a terminal (the `read -rs` line hides what you type and keeps it out of your shell history; paste `DATABASE_PUBLIC_URL` from Railway **into the terminal only**):
```bash
read -rs SRC_URL && export SRC_URL      # paste DATABASE_PUBLIC_URL, press Enter (nothing is shown)
# The console's data is in its OWN database name (the value of APP_INTELLIGENCE_DB_NAME on the console service,
# or the database in its DATABASE_URL). List databases, then edit SRC_URL's last path segment to that name:
psql "$SRC_URL" -Atc "select datname from pg_database where not datistemplate"
pg_dump --format=custom --no-owner --no-privileges --file=console_backup_test.dump "$SRC_URL"
ls -l console_backup_test.dump
```
`pg_dump` only reads. If it complains about a version mismatch, install a newer client.

### Step C: restore into a local, separate database
```bash
export RESTORE_URL="postgresql://postgres:YOUR-LOCAL-PASSWORD@127.0.0.1:5433/postgres"   # LOCAL only
case "$RESTORE_URL" in *127.0.0.1*|*localhost*) echo "ok: local" ;; *) echo "STOP: not local"; false ;; esac
createdb -h 127.0.0.1 -p 5433 -U postgres restore_test
pg_restore --no-owner --no-privileges -h 127.0.0.1 -p 5433 -U postgres -d restore_test console_backup_test.dump
```
Never set `RESTORE_URL` to a Railway address.

### Step D: check that the data really came back
Run the same counts on production (read-only) and on the restored copy and compare:
```bash
Q="select 'ai_applications', count(*) from ai_applications union all select 'ai_checks', count(*) from ai_checks union all select 'ai_credentials', count(*) from ai_credentials union all select 'ai_repos', count(*) from ai_repos union all select 'ai_portfolio_items', count(*) from ai_portfolio_items union all select 'ai_oss_projects', count(*) from ai_oss_projects"
psql "$SRC_URL" -Atc "$Q"
psql -h 127.0.0.1 -p 5433 -U postgres -d restore_test -Atc "$Q"
```
(If a table name errors, list tables with `\dt ai_*` and adjust.) The numbers should match, allowing for changes made between the two commands. Optionally start the console locally against `restore_test` and open the Overview.

### Step E: clean up (important)
1. Railway → Postgres service → Settings → Networking → **remove Public Access**.
2. `unset SRC_URL RESTORE_URL`; close the terminal.
3. Delete `console_backup_test.dump` (it contains your credential register's metadata). Never commit it; `*.dump` and `*.sql` are git-ignored here as a safety net.
4. Drop the local test database or stop the container (`docker rm -f restore-test`).

## Record the result
| Date | Backup schedule found | Newest backup | Restore test done? | Row counts matched? | Notes |
|---|---|---|---|---|---|
| | | | | | |

## How often
Repeat the restore test after any big change and at least once a quarter. A scheduled dump to a private, encrypted location is a possible later improvement; it is not proposed here.

## Not verified
Your Railway plan's backup features, whether the Backups tab shows a schedule today, and which database name the console uses on the shared server.
