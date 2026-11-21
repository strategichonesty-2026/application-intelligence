# PIH importer (PR 1): local-only import of ChatGPT and Claude exports

Status: built, tested, **not merged, not deployed** (pull request #4; mission Objective 2, see `INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md`). It runs on your computer against a **local** PostgreSQL database. It sends nothing anywhere.

## What it does
Reads the `conversations.json` files of a ChatGPT or Claude export and stores, in your local database:
- each conversation's **original text, unchanged** (`pih_conversations.raw_text`, with its SHA-256),
- readable messages (role, text, timestamp, branch, attachment flag) in `pih_messages`,
- one record per imported file (`pih_imports`: platform, file name, file hash, counts, status, errors).

It does **not**: call an AI provider, use cloud or object storage, open a network connection other than to the local database, upload anything, or change the export files.

## Use
1. Request your exports and **unzip them** into a folder (the importer needs no ZIP library; see "Dependencies").
2. Set up the local database and the settings file exactly as in `docs/PIH_LOCAL_SETUP.md` (file outside Git, `chmod 600`).
3. Check size and readability first. This uses no database:
   `node server/pih/cli.cjs --dry-run ~/exports/chatgpt ~/exports/claude`
4. Import:
   `node server/pih/cli.cjs --env-file ~/.config/pih/local.env ~/exports/chatgpt ~/exports/claude`
   (or `npm run pih:import -- --env-file ... <folders>`)
   It prints `Target database: host=... port=... name=...` and asks you to type the database name. For scripts: `--confirm-db <name>`.

Give it a folder (it finds `conversations.json`, `conversations-000.json`, ... up to 3 levels deep, including `personal/conversations/`) or the files themselves. Other files in the export (images, `chat.html`, `user.json`) are ignored, never read.

Exit codes: `0` all good, `2` finished with some conversations skipped (see the error list), `1` refused or failed.

## Safety checks (all enforced in code and tested)
| Rule | How |
|---|---|
| Local database only | Host must be exactly `127.0.0.1`, `localhost` or `::1`. Everything else is refused **before any connection is attempted**: Railway hosts, private networks, `127.0.0.1.evil.com`, multiple hosts, `?host=` or `?hostaddr=` options, percent-encoded hosts, a URL with no host (no fallback to `PGHOST`). |
| Checked again after connecting | The server's real address must be loopback and the database name must match; a database that contains the console's tables (`ai_applications`, ...) is refused as a production marker; names containing `prod`, `railway` or `live` are refused. |
| No secrets in arguments | `--password`, `--database-url`, `--host` and similar are rejected. The URL comes only from `PIH_DATABASE_URL` or `--env-file`. `DATABASE_URL` (the console's) is never read as a fallback and a copy of it is refused. |
| Settings file | Refused if it sits inside a Git repository or is readable by other users. |
| Confirmation | You must type the database name (or pass `--confirm-db`). With no terminal and no flag, nothing runs. |
| Originals untouched | Export files are opened read-only; nothing is written beside them (tested: same hash, same modified time, same folder listing). |
| No content in messages | Error lists, summaries and stored errors contain counts, positions and ids, never titles or message text; database errors keep only the error code. |
| No outside calls | The test suite fails if any HTTP/fetch call is made or any socket connects somewhere other than this computer. A source scan fails the build if importer code imports HTTP, DNS, AI-provider, cloud or subprocess code. |

## Duplicates and changed conversations
- The same **file** (same SHA-256) that was fully imported is skipped.
- The same **conversation** (platform + conversation id) in any file is recognised. Identical text is skipped ("already present").
- A conversation that **changed** (for example it continued after the last export) is updated: its previous original is saved in `pih_conversation_history` first, so nothing is lost, and the update is counted.
- A conversation with **no id** gets an id made from its content hash, is flagged `id_synthetic`, and is still de-duplicated.
- One import at a time (database advisory lock).

## Malformed and unusual files
- One bad conversation never stops the others: it is listed (position and reason, no content) and the import finishes as `partial`.
- A truncated file imports every complete conversation before the cut, then reports the truncation.
- A conversation whose format differs from the rest of the file (the other platform) is refused, not mixed in.
- Missing or unreadable timestamps are stored as empty (NULL), counted in the summary, never guessed.
- ChatGPT: all branches are kept; the branch ending at `current_node` is marked active and numbered; others are stored, marked inactive. Hidden and tool messages are kept and labelled. Message content in a shape the importer does not know is kept in the original and flagged `unreadable`.
- A message containing a NUL character is stored without it in the readable copy only (PostgreSQL cannot store it); the original keeps it.

## Large exports
The file is read in pieces and one conversation is held in memory at a time, so memory use is about the size of the largest conversation, not of the file. Tested with 1,500 conversations / 18,000 messages (about 20 MB) and with 1-byte read chunks. One conversation larger than 200 MB is reported and skipped.

## Dependencies
**None added.** The importer uses Node built-ins and `pg` (already in the project). A ZIP library was not needed because you unzip the export first. If a future export is only available as a ZIP you do not want to unzip, one small library could be proposed then, with its reason.

## Checked against what? (honest status)
- The two parsers were tested against the synthetic examples in `docs/PIH_SAMPLE_EXPORTS.md` (the test reads them straight from that file, so docs and code cannot drift apart) and against edge cases built from public descriptions of the formats (branches, a missing `current_node`, hidden and tool messages, image parts, missing and bad timestamps).
- Public descriptions agree on: sharded `conversations-NNN.json`, an optional `personal/conversations/` location, `mapping` nodes with `parent`/`children`, a root node with no message, `current_node`, both `id` and `conversation_id` on conversations.
- **Not yet checked against your real files.** Field names change over time. Your sanitized samples are the real test; expect small adjustments.

## Deviations from the plan (please note)
1. The original is stored as exact **text** plus a hash, not as JSONB, because JSONB reorders keys and drops formatting, so it would not be "unchanged". JSON queries are still possible with `raw_text::jsonb`.
2. A `pih_conversation_history` table was added so a changed conversation never overwrites its earlier original.
3. The tables are created by the importer in the **local** database. The console's own startup schema is unchanged (tested).
4. Host rule is stricter than the setup guide's "allow-list file": loopback only, no allow-list.
5. Not in PR 1: search, the Library page, sensitivity flags, findings, AI. The data is ready for them.

## Look at your data (local `psql`)
```sql
select platform, count(*) from pih_conversations group by 1;
select id, platform, file_name, status, found, added, updated, skipped, failed, started_at from pih_imports order by id;
select title, created_at_src from pih_conversations order by created_at_src desc nulls last limit 20;
select role, left(text, 80) from pih_messages where conversation_id = 1 and active_branch order by position;
```
To start over, drop the local database (`dropdb pih_local`) and create it again. Nothing else holds a copy.

## Tests
`node test_pih_importer.cjs` (part A needs no database; part B needs `AI_TEST_DATABASE_URL` pointing at a local scratch Postgres and creates and drops its own throwaway database). Covers: both synthetic structures, duplicates (file, conversation, changed, no-id), malformed and truncated files, large export, missing/invalid timestamps, 21 remote-database rejections, confirmation, production marker, concurrent runs, and privacy boundaries (no content in output, no password in output, no non-local connection, no HTTP, no new dependency, console untouched).
