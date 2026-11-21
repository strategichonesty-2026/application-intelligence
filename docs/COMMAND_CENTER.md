# Strategic Honesty Command Center (Phase 1)

The Command Center is built into this console. It adds four things on top of the monitoring you already have:
**Overview** (what needs attention), **Applications** (every GitHub repository, classified), **Portfolio** (decisions, risks,
opportunities, ideas) and **Open-source Library** (projects that could fill a gap).

Nothing here changes any application. GitHub is only ever **read**. All records live in this console's own database.

## Mission alignment
The Command Center supports **Objective 1 (Know our assets)** and **Objective 3 (Discover open-source technology)** of [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md).
Module boundaries: **Applications** = what we own; **Portfolio** = our own decisions, risks, ideas, opportunities, requirements; **Open-source Library** = outside GitHub projects we might reuse. A fact lives in one module and is linked from the others.
Today the Library is filled by hand, has no automatic discovery, and uses the states `to_evaluate / adopt / watch / reject`; the charter's four separate states (discovered, evaluated, approved, adopted) and weekly discovery are planned (Sprint 5 in `MISSION_ROADMAP.md`). The repository inventory does not yet record what a repository actually does (Sprint 2). The Overview is proposed to become a mission review page (`MISSION_CONTROL_OVERVIEW_SPEC.md`); it is **unchanged** by this documentation.

## Three separate signals (never merged)
| Signal | Where it comes from | Why it is separate |
|---|---|---|
| Repository activity | GitHub: last push, open pull requests | A quiet repository can be a finished one. |
| Deployment | A deploy config file in the repo root, or a GitHub deployment | "Has a config" is not "is running". |
| Application health | This console's own health checker, for repositories you link to a monitored application | Only a real check can say something is up. |

Unknown stays unknown: a repository nobody has linked shows **Not checked**, never "healthy".

## Set up the GitHub connection (you do this, not Claude)
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Resource owner: your account or organization. Repository access: **All repositories** (or pick them).
3. Permissions (all **Read-only**): **Metadata**, **Contents**, **Deployments**. Nothing else.
4. Copy the token **once** and set it as a service variable on the console: `GITHUB_TOKEN`. Never paste it in chat or commit it.
5. Optional: `GITHUB_OWNER` (default `strategichonesty-2026`).
6. Open **Overview** or **Applications** and click **Sync now**.

Why read-only: the console can look at your repositories but cannot change, delete or publish anything, so a leaked token
has a small blast radius. Rotate it from the same GitHub page if you ever doubt it.

## How a sync stays cheap and polite
- Only GET requests, only to the GitHub API host. Page 1..n of your repository list use `ETag` / `If-None-Match`; a "not modified" answer does not count against the rate limit.
- A repository is re-scanned only when its last-push time changed since the last scan.
- Repositories are matched by GitHub's numeric id, so renaming one does not create a duplicate.
- A failure is recorded and shown in plain words; the previous data is kept.

## Daily sync (optional, off by default)
The daily sync rides on the existing daily pass. It happens only if **both** are true:
`APP_INTELLIGENCE_SCHEDULE=daily` **and** `GITHUB_TOKEN` is set. To keep the daily health pass but skip GitHub, set
`APP_INTELLIGENCE_GITHUB_SYNC=off`. A failed GitHub sync never stops the health pass or its heartbeat. No AI is involved.
Without `APP_INTELLIGENCE_SCHEDULE=daily` nothing runs by itself: use the **Sync now** button.

## How repositories are classified
A suggestion only; you confirm the type. Each suggestion shows its evidence.
- archived on GitHub → **archive**
- front-end files and a deploy config in the repo root → **application**
- deploy config, no front end → **service**
- code only → **tool**; no code → **content**; front end without a deploy config → no suggestion

Then set a priority: **Invest / Maintain / Hold / Retire**.

## Portfolio and Open-source Library: honesty rules
- Both start **empty**. Nothing is pre-loaded and nothing is looked up for you.
- **Verified** needs evidence (or a source) **and** a date. Without both it stays inferred / unverified / to verify.
- A library project cannot be marked **Adopt** until its facts are checked and its licence is known and not strong copyleft (GPL/AGPL need a decision from you first).
- No secrets: every text field is screened and anything that looks like a key or token is refused.
- Portfolio can import up to 100 records you paste as JSON. The import **previews first** and skips duplicates.

## API (all behind the owner sign-in)
`GET /repos`, `GET|PATCH /repos/:id`, `POST /sync`, `GET /sync/status`, `GET /attention`,
`GET|POST /portfolio`, `PATCH|DELETE /portfolio/:id`, `POST /portfolio/import`,
`GET|POST /oss`, `PATCH|DELETE /oss/:id`. Mounted under `/api/app-intelligence`.

## Not in this phase
The Personal Intelligence Hub (importing your chat history from account exports) is a future initiative and is not built.
There is no chat-sync button: AI chat tools offer no live read access, only exports.

## Not verified
It has not been run against the real GitHub API or deployed (tests use a fake GitHub), and the screens have not been checked in a browser.
