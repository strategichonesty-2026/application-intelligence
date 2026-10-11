> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Manual-first monitoring: behaviour, configuration, cost

Implemented and tested on branch `claude/funny-johnson-xw51bq`. Not deployed.

## 1. Behaviour (as built)

- **Nothing runs automatically by default.** No timer, no polling, no per-second or per-minute pass. `monitor.start()` returns without creating a timer unless `APP_INTELLIGENCE_SCHEDULE=daily` (tested: zero timers created).
- **Check now** (one application) and **Check all** (every enabled application except manual-only ones) in the console, or `POST /api/app-intelligence/applications/:id/check` and `POST /api/app-intelligence/check-all` (owner sign-in required; the shared key is not accepted).
- **Cooldowns:** 10 s per application; 30 s for Check all (a second click inside the window sends **no** requests and answers 429).
- **Reading is free:** the console loading summary / applications / config never triggers a check. Dashboard auto-refresh defaults to **Off** (it only re-reads stored results, never checks); the only alternative offered is every 5 minutes.
- **Last result stays visible:** each row shows status, "Last checked" and "Last successful check". Manual applications are never labelled stale (the time is shown instead); a daily application is stale after 36 h (a missed run); monitoring health shows **Manual** when the schedule is off (not "stalled").
- **No LLM, ever:** a check is one HTTP request and a fixed rule. `test_manual_monitoring.cjs` fails if any monitoring file imports anything outside Node built-ins, express, or other monitoring modules, or names an AI/paid-provider host.
- **Incidents:** open on one *confirmed* failure (each failure is retried once immediately, and a monitor with no internet is reported as a monitoring fault, not an outage); resolve on the next pass; degraded/slow never opens one. An unchanged condition queues no further email.
- **Reachable ≠ Verified healthy:** homepage checks show "Reachable"; only a health-endpoint check can show "Healthy" (and only as thorough as that endpoint).
- **A monitoring failure is not an app outage:** `monitor_error` / `monitor_no_egress` outcomes are shown as monitoring faults.

## 2. Modes (per application)

| Mode | Daily check (if enabled) | Check all | Check now |
|---|---|---|---|
| `daily` | yes | yes | yes |
| `manual` (default for any row without a choice, including every pre-existing row) | no | yes | yes |
| `manual_only` | **never** | **never** | yes, that one application only |

`manual_only` requires a health-endpoint check (a homepage check is rejected at create/edit), and registering one does **not** probe it.

## 3. Optional daily check

- Enable with `APP_INTELLIGENCE_SCHEDULE=daily` (+ optional `APP_INTELLIGENCE_DAILY_UTC_HOUR`, default 6). Not enabled by this work.
- Mechanism: one in-process `setTimeout` for the next occurrence of that hour (re-armed after each run), guarded by a Postgres advisory lock, a persisted "last completed" time, and a 12-hour minimum gap, so a restart, a second instance, or a catch-up can never repeat a pass. If the API was down at the hour, it catches up once ~30 s after the next start when the last pass is older than 25 h. It checks only `daily` applications (≤3 in parallel), sends due alert emails, prunes history, then pings the optional heartbeat.
- **Recommendation: leave it OFF for now.** It runs on infrastructure you already pay for (the Media Studio API process; no worker, no new service) and adds seven small HTTP requests and seven rows a day, which is negligible. But it only runs if that process is actually awake at the scheduled hour. I could not verify from the repository whether the Railway service ever sleeps or restarts at that hour (`railway.json` sets `restartPolicyType: ON_FAILURE`, no sleep setting). Enable it only after staging shows the API stays up, then watch the first week. If the process is not reliably always-on, leave the daily check off and use Check all.

## 4. Travel Intelligence Agent: manual only

- Seeded as `manual_only`, health endpoint `/health`. Excluded from the daily pass, Check all, `validateIntegrations.cjs` (needs `--include-manual-only`, then requests only `/health` with no discovery), and `measureLatency.cjs` (refuses unless `--allow-manual-only`). All verified in `test_manual_monitoring.cjs`.
- Monitoring never requests its homepage (the page that triggers 21 outbound link checks and possibly paid travel searches), never touches booking sites, flight/hotel search, or paid APIs. The Travel app's code is untouched.
- Limit: its `/health` returns a static `{"status":"ok"}`, so a pass proves the process is up, not that searches work.

## 5. Cost

| Item | Cost impact of this work | Notes |
|---|---|---|
| New services | **None.** The standalone worker (a second always-on Railway service) was removed. | |
| Compute | Effectively nil: no background loop. A Check all is ≤8 short HTTP requests. | Railway compute is billed by usage; I have not measured your bill, so no figure is claimed. |
| Database | A few rows per check; 30-day pruning. Tiny. | Postgres cost is unchanged in practice, not zero in principle. |
| AI / LLM | **$0**, none involved. | |
| Email (Resend) | Free tier is far above expected volume; optional. | Verify current pricing. |
| Heartbeat service | Optional; free tiers exist; only useful with the daily check on. | |

Remaining recurring costs that exist independently of this work: Railway (API + Postgres), Cloudflare Pages, any domain, ElevenLabs/Replicate/Runway etc. usage for generation, and the existing `strategic-honesty-monitor` Cloudflare Worker if deployed (cron every 15 min; it runs on its own, outside this repo, and is **automatic monitoring that remains active** if it is deployed — its status is unconfirmed).

## 6. Privacy

- PFOS: only operational metadata (outcome, status code, timing, fixed text) is stored; bodies, cookies, redirect query strings and headers are never stored or returned (`test_appIntelligence_pfos.cjs`, canary-based). No session recording, no user data collected.
- No secret value or detailed security finding is shown in any console screen; the console never receives the shared key.
