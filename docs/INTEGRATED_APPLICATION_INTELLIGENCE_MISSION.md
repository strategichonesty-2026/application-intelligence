# Strategic Honesty: Integrated Application Intelligence
## Mission Charter

Status: **charter and plan only.** Written 21 November 2026. No application code, database table, deployment or merge was changed to produce it.
Companion documents: [MISSION_CONTROL_OVERVIEW_SPEC.md](MISSION_CONTROL_OVERVIEW_SPEC.md) · [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) · [MISSION_ROADMAP.md](MISSION_ROADMAP.md) · [PERSONAL_INTELLIGENCE_HUB_PLAN.md](PERSONAL_INTELLIGENCE_HUB_PLAN.md) · [COMMAND_CENTER.md](COMMAND_CENTER.md)

## 1. Mission

> **Understand what we own, remember what we discussed, discover useful open-source technology, match opportunities with existing assets, validate market demand and turn valuable opportunities into income.**
>
> **BUILD LESS FROM SCRATCH. CREATE MORE VALUE FROM WHAT WE ALREADY OWN.**
>
> Before building anything new: check what we already own, what open-source code we can reuse, and whether the business opportunity is real.

One integrated system that understands our repositories and applications, our projects and intellectual property, our ChatGPT and Claude conversations, external open-source software, and external market research. It helps us decide what to **reuse, improve, integrate, commercialize or build**. The end goal is sustainable business opportunities and additional income.

## 1a. Approved decisions (owner, 21 November 2026)
Full wording and status are in the decision register of [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md), section 5.
- **A1** One **Portfolio** is the central register of ideas, decisions, opportunities, risks and actions; Hub findings are suggestions linked to their conversations.
- **A2** Reuse the existing monitoring, alerts and health checks.
- **A3** One shared recommendation engine for the attention list, What's wrong? and the weekly report.
- **A4** Extend the existing Open-source Library with recurring discovery; no second library.
- **A5** Repository discovery and source-code capability verification stay separate.
- **A6 / D6** Read-only review of all 20 repositories (approved, not started).
- **A7 / D3** Standard PR template with the six questions. **A8 / D4** Automated GitHub tests using the existing suite, no new package.
- **A9 / D1** Local Hub data stays private; the deployed Overview shows "unavailable" until a secure, approved counts-only integration exists.
- **D2** Agile and acceptance records reuse the existing PostgreSQL database, after backup verification and schema review. **D5** Branch dependencies verified before merging (finding: #4 conflicts with #2 in `.gitignore`).

## 2. State of the work today (verified 21 November 2026)

Checked against GitHub (`strategichonesty-2026/application-intelligence`) and the code, not copied from reports.

| Item | Verified state | Charter statement | Correction |
|---|---|---|---|
| Command Center Phase 1 | **Built and live.** PR #1 merged to `main` and deployed. The first real sync returned 20 repositories. | "built, live and accepted" | **Partly.** The acceptance review was done and the owner approved it, but its fixes sit in **PR #2, not merged**. The live site is the version from before those fixes. Accepted: yes. Fully live: not yet. |
| PR #2 acceptance fixes and backup/restore guide | Open, not merged, 15 files, base `main`. | same | None. |
| PR #3 PIH design and four documents | Open, not merged, 4 files, documentation only, base `main`. | same | None. |
| PR #4 local-only importer | Open, not merged, 11 files, base **`claude/pih-plan`** (PR #3's branch). | same | None. Merge #3 first, or retarget #4 to `main`. |
| Tests | 27 of 27 test files pass; the importer test has 88 checks (run with a local scratch PostgreSQL). | same | **Run by the developer session only.** The repository has no automated CI, so nothing re-runs them on GitHub. |
| Real ChatGPT/Claude exports | Not validated. The importer was tested against synthetic structures only. | same | None. |
| Search, AI extraction, opportunity analysis | Not implemented. | same | None. |
| Railway database backups | **Not verified.** The owner is checking. | not mentioned | Added. |
| Repositories on GitHub | 20 (list read from GitHub). | 20 | None. |

Everything not stated above as verified is **not verified**. The full assessment is in [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md).

## 3. The six permanent objectives

Each objective has **measures that come from real records**. No percentage is typed in by hand. The Overview shows "n of m acceptance criteria verified", where each criterion has a state, evidence and a date (details in [MISSION_CONTROL_OVERVIEW_SPEC.md](MISSION_CONTROL_OVERVIEW_SPEC.md)).

### Objective 1: KNOW OUR ASSETS
Keep an accurate inventory of every repository, application, service and product. For each one, in plain English: what it is, why it exists, the problem it solves, the features **actually implemented**, how to configure, run and use it, what depends on it, its deployment and health, what is unfinished, and its potential commercial value. Missing, incomplete or misleading descriptions are flagged.
- Rule: never invent a feature. Facts come from source code, README files, configuration, routes and deployment information, each with a source and a date.
- **Two separate things (owner decision A5):** *discovery* (the repository was found and its metadata read: this exists today) and *capability verification* (someone read the source and confirmed what is actually implemented: not built). A repository that is only discovered is never counted as verified.
- Measures: repositories total; repositories with a confirmed type; repositories with an owner-confirmed purpose; repositories whose features list is evidence-backed; repositories with a missing or generic GitHub description (today, verified: `strategic-honesty-rag`, `personal-ai-studio`, `strategic-honesty-API` and `pfos-extractor` have none; `tts-worker` has only "wire video generation"); applications with a deployment state; applications with a real health check; repositories with unfinished work recorded.

### Objective 2: REMEMBER OUR KNOWLEDGE (Personal Intelligence Hub)
Import ChatGPT and Claude conversations, preserve the originals, search them, extract ideas, decisions, requirements, projects and commitments, connect related discussions over time, and surface forgotten or unfinished ideas. The importer is **PR #4 and must not be rebuilt**.
- Measures: imports completed; conversations and messages stored; searchable (yes/no, tested); findings extracted by kind and certainty; findings accepted by the owner; open commitments with no later mention.

### Objective 3: DISCOVER OPEN-SOURCE TECHNOLOGY
Turn the Open-source Library into a recurring discovery and evaluation capability: configurable weekly or biweekly GitHub searches; for each candidate record the repository and link, plain-English purpose, why it is relevant, which of our projects it could improve, licence and commercial-use implications, maintenance and security evidence, dependencies and compatibility, estimated integration effort, recommended action and last-checked date.
- Four **separate** states: **discovered, evaluated, approved, adopted** (plus rejected/postponed). Moving between states is always an owner action.
- Hard rule: **never automatically clone, install or merge external code.** Discovery only reads GitHub's public search and repository metadata.
- Measures: last scan date; candidates per state; candidates with every evaluation field filled and sourced; approved but not yet adopted; adopted components linked to the application that uses them.

### Objective 4: MATCH OPPORTUNITIES WITH OUR ASSETS
Every opportunity is checked against existing repositories, implemented features, deployed services, Hub findings, open-source candidates, books and intellectual property, and SHIOS market evidence. Each gets exactly one classification:
1. Already built: commercialize.
2. Partially built: complete.
3. Extend an existing product.
4. Integrate external open-source software.
5. Build new, **only after validation**.
6. Reject or postpone.
- Measures: opportunities recorded; opportunities with a completed asset check (each source checked, with date); count per classification; "build new" opportunities that skipped validation (must be zero).

### Objective 5: VALIDATE BUSINESS OPPORTUNITIES
Evaluate customer demand, competition, revenue potential, startup cost, time to first revenue, technical effort, legal and operational risk, and fit with existing assets. **Verified market evidence is kept apart from AI assumptions**, using the same rule as the rest of the console: "verified" needs a source and a date.
- Measures: opportunities with all eight criteria answered; criteria verified versus assumed; opportunities with at least one verified demand signal.

### Objective 6: TURN OPPORTUNITIES INTO INCOME
Recommend practical commercial experiments: consulting and coaching, paid workshops and training, SaaS products, APIs and integrations, open-source-based commercial solutions, knowledge products and books. Track four things **separately**: customer validation, commercial readiness, actual sales, revenue.
- Measures (all owner-entered, none estimated): experiments running; customers who confirmed a need; products ready to sell; sales count; revenue received. Revenue shows "unavailable" until a real entry exists.

## 4. The modules and their boundaries

| Module | Answers | Holds | Must not become |
|---|---|---|---|
| **Repository Inventory** (Applications page) | What do we own and have built? | Repository facts from GitHub, owner-confirmed type, purpose, priority, deploy and health | A place for ideas or decisions |
| **Portfolio** | What have we decided, risked, wanted or planned? | The internal decision register: ideas, decisions, risks, opportunities, requirements, issues, with evidence level | A copy of the Hub's findings or of the inventory |
| **Open-source Library** | What outside code could we reuse? | External GitHub projects, evaluated | A list of our own repositories |
| **Personal Intelligence Hub** | What have we already discussed and decided? | Imported conversations (originals) and findings extracted from them | A second Portfolio |
| **SHIOS** | What does the outside world say? | External research, trends, market signals | A place for our own decisions |
| **Opportunity-to-Asset Matching** | What do we already have for this opportunity? | **No records of its own.** It reads the five modules above and writes only the owner's classification and the evidence behind it | A sixth data silo |

Boundary rule: a fact lives in exactly one module and is **linked**, not copied, from the others. Where two modules overlap today, [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) section 4 lists the decision needed.

## 5. Honest progress

### States
Not started · Planned · In development · Built, awaiting validation · Tested · Accepted · Live · Blocked.

A state may be shown only with its evidence (a PR, a test run, an owner decision, a deploy) and the date of that evidence. "Documented" is never "built".

### Four different things that must never be merged in one word
| Term | Means | Evidence required |
|---|---|---|
| **Working repository** | The code runs in tests or locally | Passing tests or a recorded run |
| **Deployed application** | It is running at a public address | A deploy record or a successful response from the live URL |
| **Healthy application** | It is deployed **and** the console's own checker is passing now | A recent health check |
| **Commercially ready product** | It can be sold: works, is deployed, has an owner-confirmed offer and price, and at least one customer-validation entry | All of the above plus owner confirmation |

Today (verified): of 20 repositories, the Command Center is the only one this work has deployed or checked. The health status of the other applications depends on what the owner has linked in the console, and was **not** verified for this charter.

## 6. Governance: the six questions

**Every sprint and every pull request must answer these six questions in its description.** A PR that cannot answer them is not ready for review.

```
## Mission check
1. Which mission objective (1 to 6) does this support?
2. What existing capability (repository, module, library) can be reused, and what did you reuse?
3. What business problem does it solve, in one sentence?
4. What measurable result is expected (which Overview figure changes, from what to what)?
5. How will completion be verified (test, owner check, real data)?
6. What remains unknown or unverified?
```
Home: `.github/pull_request_template.md`. The owner approved it (decision D3/A7). It is a text file, not code. It is **not added in this documentation PR** (documentation updates only); it is the first item of roadmap Sprint 0, as its own small PR.

Existing standing rules still apply and are not weakened by this charter: GitHub-first, reuse over rebuild (`CLAUDE.md`); no production change without owner approval; no secrets in GitHub or chat; honest evidence ("unknown stays unknown"); conversations never leave the owner's computer without a separate approval.

## 7. Review rhythm
- **Weekly (15 minutes):** the Overview's mission panel, the three recommended actions, blockers, anything stale.
- **Every second week (sprint review):** move work between states with evidence, accept or reject opportunities, choose the next sprint.
- The weekly review text is **rule-based from recorded data** (counts, stale items, blocked items), produced by the **same shared recommendation engine** as the attention list and What's wrong? (decision A3). It names its sources and says plainly when a source is unavailable. AI-written summaries are a later, separately approved step.

## 8. The Overview as the permanent mission review page
The Overview becomes a visual Mission Control dashboard: mission progress with six objective bars, Agile management (sprint, Kanban board, dependencies, next three actions), operational monitoring, repository, open-source and opportunity intelligence, and business progress. Every figure links to its records and evidence; unavailable and not-verified states are shown plainly; nothing is fabricated. The layout, component inventory, KPI definitions, data sources, click-through behavior and responsive criteria are in [MISSION_CONTROL_OVERVIEW_SPEC.md](MISSION_CONTROL_OVERVIEW_SPEC.md). It uses only existing libraries and small hand-built components: no new paid service, monitoring platform, database or scheduler.

## 9. What this charter does not do
It does not implement the Overview, create tables, change code, merge any PR, deploy, or add infrastructure. Those happen in later sprints, each approved first ([MISSION_ROADMAP.md](MISSION_ROADMAP.md)).
