# PIH: configuring database credentials locally, safely

Rule: **no secret ever goes into GitHub, into chat, or into a file inside a Git repository.** The first Hub importer runs on your computer against a **local or staging database**, never production.

## 1. Default: a local database (no cloud credentials at all)
This is the recommended first setup. Nothing leaves your computer.
1. Run a throwaway local PostgreSQL 16, for example with Docker:
   `docker run --name pih-local -e POSTGRES_PASSWORD=choose-a-long-random-one -p 5434:5432 -v pih_data:/var/lib/postgresql/data -d postgres:16`
   (or your normal local Postgres). Use a **different** password from every other system.
2. Create the database: `createdb -h 127.0.0.1 -p 5434 -U postgres pih_local`
3. Disk encryption: confirm FileVault (Mac) or BitLocker (Windows) is on, because the database holds your private conversations.

## 2. Keep the connection string out of Git and out of history
- Create a settings file **outside** any repository, for example `~/.config/pih/local.env`, readable only by you:
  ```bash
  mkdir -p ~/.config/pih && chmod 700 ~/.config/pih
  read -rs -p "Local DB password: " PW; echo
  printf 'PIH_DATABASE_URL=postgresql://postgres:%s@127.0.0.1:5434/pih_local\n' "$PW" > ~/.config/pih/local.env
  unset PW; chmod 600 ~/.config/pih/local.env
  ```
  (`read -rs` hides what you type and keeps it out of your shell history.)
- The importer will read `PIH_DATABASE_URL` from the environment or from a file path you pass (`--env-file ~/.config/pih/local.env`). It will not accept the password as a command-line argument (arguments appear in process lists and history).
- Inside any repository, `.env` and `.env.*` are already git-ignored; still keep this file elsewhere.
- Turn on GitHub **secret scanning push protection** for your repositories (Settings → Code security) as a safety net. It cannot be verified from here; please confirm the setting.

## 3. Guard rails the importer has (built; see PIH_IMPORTER.md)
1. Refuses to run unless the database host is `127.0.0.1`, `localhost` or `::1` (no allow-list: loopback only).
2. Refuses if the database has the console's production marker (a setting row) or if the name looks like production.
3. Never prints the connection string or any password; shows only host and database name.
4. Reads export files read-only and never writes next to them.
5. Prints a summary at the end (conversations found/added/skipped/failed, messages, total characters) and writes an import record.

## 4. Staging database (later, only if you want it)
A separate Railway Postgres or database used only for the Hub. It needs your approval first (possible cost). Use `DATABASE_PUBLIC_URL` only from your terminal, remove Public Access when done, and never reuse the production credentials.

## 5. If a secret is ever exposed
Change the password (local: `ALTER USER postgres PASSWORD '...'`; Railway: rotate in the dashboard), then check the place it leaked (history, a file, a screenshot). Tell me what leaked, not its value.
