# Capability and gap assessment

Status: assessment, 21 November 2026; **updated the same day with the owner's approved decisions** (section 5). The decisions are recorded here; none has been implemented. Read-only inspection: GitHub PR state, the `application-intelligence` code on its branches, and GitHub repository metadata. No code, table or deployment was changed.
Charter: [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md).

**How to read the tables.** *State* uses the charter's vocabulary. *Verified how* names the evidence. "Code" means the file was read; "tests" means a test covers it and was run by the development session (there is no automated CI); "owner" means the owner confirmed it. Anything without evidence says **not verified**.

## 1. What was and was not inspected
| Inspected | Not inspected (and therefore not claimed) |
|---|---|
| This repository's code on `main`, PR #2, #3 and #4 branches; PR state through GitHub | The source, README, routes or deployment of the other 19 repositories (only their GitHub description, privacy and last push were read) |
| GitHub descriptions of 6 named repositories | Whether any other application is deployed or healthy right now |
| Importer tests against synthetic samples | Real ChatGPT or Claude export files |
| | SHIOS data and how it could be read from this console |
| | Railway backup settings |

## 2. Capability map by objective

### Objective 1: Know our assets
| Capability asked for | State | Where / evidence | Verified how |
|---|---|---|---|
| Inventory of every repository | **Live** (pre-acceptance version) | GitHub sync, `ai_repos`; first real sync found 20 | owner screenshot; code; tests |
| What it is: type | Live | Suggested from file list with evidence; owner confirms (`application / service / tool / content / archive`) | code, tests |
| Why it exists: purpose | Partly | `suggested_purpose` = first sentence of README; owner `purpose` field | code |
| Deployment status | Live | Root deploy-config file or GitHub deployment → `deployed / configured / failed / none / unknown` | code, tests |
| Health | Live, **only when linked** | Existing health checker; unlinked repositories show "Not checked" | code, tests |
| Priority | Live | Invest / Maintain / Hold / Retire (owner) | code |
| **Discovery versus capability verification** (owner decision A5) | **Discovery exists** (the sync). **Capability verification does not**: nothing records that someone read the source and confirmed a feature. The two must be stored and counted separately, so that a repository being listed never counts as "verified". | `repoSync.cjs`, `repoScan.cjs` | code |
| Flag missing or generic descriptions | **Not started** (the data is stored: `gh_description`) | None | By hand: `strategic-honesty-rag`, `personal-ai-studio`, `strategic-honesty-API`, `pfos-extractor` have no GitHub description; `tts-worker` has "wire video generation" |
| Features **actually implemented** (from source, routes, config) | **Not started.** The scan reads the file list, `package.json`, `requirements.txt` and one README sentence. It does not read routes or features. | `repoScan.cjs` | code |
| How to configure, run and use | Not started | none stored | n/a |
| Which applications depend on which | Not started | none stored; `app_id` links a repository to a monitored application, not repository to repository | code |
| What remains unfinished | Not started (an "Invest but dormant" rule exists) | `attention.cjs` | code |
| Potential commercial value | Not started | `priority_note` free text only | code |
| Repository with misleading description (e.g. README says one thing, code does another) | Not started; needs source reading and owner judgement | none | n/a |

### Objective 2: Remember our knowledge (Hub)
| Capability | State | Evidence | Verified how |
|---|---|---|---|
| Design and security documents | **Built, awaiting approval** (PR #3, documentation) | 4 documents | read |
| Importer for ChatGPT and Claude exports, originals preserved, duplicate protection, local-only | **Built, awaiting approval / tested** (PR #4, not merged) | `server/pih/`, 88 checks | tests run by the developer session on a local scratch database; **no CI** |
| Importer works on the owner's real exports | **Not verified** | waiting for sanitized samples | n/a |
| Search | Not started (the full-text pattern exists in Portfolio and can be reused) | `portfolio.cjs` | code |
| Extraction of ideas, decisions, requirements, projects, commitments | Planned (PIH plan, PR 3) and **needs a separate approval** (AI provider, key, budget, retention terms) | plan | n/a |
| Connect related discussions; find forgotten ideas | Planned (rule-based first, PIH plan section 6) | plan | n/a |
| Hub data visible in the deployed console | **Deliberately unavailable (decisions D1 and A9).** The deployed Overview shows "unavailable" until a secure, approved counts-only integration exists. | importer writes to a local database by design | n/a |

### Objective 3: Open-source discovery
| Capability | State | Evidence | Verified how |
|---|---|---|---|
| Library with licence class, maintenance, security note, effort, decision, source and date; rule "adopt needs checked facts and a known, non-strong-copyleft licence" | **Live** (pre-acceptance version), starts empty | `oss.cjs`, tests | code, tests |
| Recurring GitHub search (weekly / biweekly, configurable) | **Not started.** The GitHub client is **GET-only** and has only repository-list and file-read calls; no search call exists | `github.cjs` | code |
| Separate states discovered / evaluated / approved / adopted | **Not started.** Today: `to_evaluate / adopt / watch / reject` | `oss.cjs` | code |
| Fields: purpose, relevance, which of our projects it could improve, dependencies and compatibility, last-checked date, recommended action | Partly: `gap` and `repo_name` are free text; `verified_at` exists; no dependency or compatibility field; no link to a repository record | `oss.cjs` | code |
| "Never automatically clone, install or merge" | **Holds today** (nothing in the code clones or installs). Must be kept as a tested rule | code | code |
| Scheduling | The daily pass exists and already hosts the GitHub sync; a weekly/biweekly gap is a small "has it run in N days" check | `monitor.cjs` | code |

### Objective 4: Match opportunities with assets
| Capability | State | Evidence |
|---|---|---|
| Opportunity records | Live: Portfolio `opportunity` type with evidence level and a free-text repository name | `portfolio.cjs` |
| Six classifications | Not started | none |
| Asset check across repositories, features, deployments, Hub findings, open-source, books/IP, SHIOS | Not started. Connections that exist today: Portfolio `repo_name` (text) and Library `repo_name` (text). **No link in any direction is a real reference.** | code |
| Books and intellectual property as assets | Not started; there is no record type for a book or IP | code |
| SHIOS evidence | **Not verified**: how SHIOS data could be read read-only from this console is unknown | n/a |

### Objective 5: Validate opportunities
| Capability | State | Evidence |
|---|---|---|
| Verified vs assumed evidence | Live as a rule: verified needs a source/evidence **and** a date | `portfolio.cjs` |
| Eight validation criteria, each with its own evidence | Not started (one evidence field per item exists) | none |
| Market evidence source | Candidate: `Problem-Signal` ("evidence-based SaaS opportunity intelligence platform", from its GitHub description) and SHIOS. **What either actually does and exposes is not verified.** | GitHub description only |

### Objective 6: Income
| Capability | State |
|---|---|
| Customer validation, experiments, readiness, sales, revenue records | Not started. Nothing stores money or customers today (and nothing should store payment data) |

### Cross-cutting
| Capability | State | Evidence |
|---|---|---|
| Owner sign-in, all routes protected, rate-limited | Live | code, tests |
| Secret screening on all text fields | Live | code, tests |
| Rule-based "what needs attention" and "What's wrong?" | Live | `attention.cjs`, `briefing.cjs` (no AI) |
| Daily job with lock, catch-up and heartbeat | Live, **off unless `APP_INTELLIGENCE_SCHEDULE=daily`** | code; whether it is on in production is **not verified** |
| Email alerts | Live if Resend is configured; production setting **not verified** | `alerts.cjs` |
| Automated CI on GitHub | **None** (no `.github` folder) | repository listing |
| Database backups | **Not verified** (owner checking; guide is in PR #2) | n/a |
| Lint | About 750 style findings remain, documented; relevant ones fixed | PR #2 |

## 3. Missing connections (the real gaps)
1. **No real references between records.** Repository, Portfolio, Library and (later) Hub findings are linked only by free-text names. A rename breaks the link silently. Needed: record-to-record references (by id) in a small, additive way.
2. **Hub data and the console are disconnected by design.** The importer is local-only; the console is deployed. By decision D1 the Overview shows Hub figures as **unavailable** until a secure, approved counts-only integration exists.
3. **No place to record "what a repository actually does".** The inventory knows type, stack, deploy and one README sentence, but not features, run instructions, dependencies or unfinished work, so Objective 4 cannot be answered from it.
4. **No state history or acceptance records.** There is nothing the Overview can honestly count for progress. Without acceptance criteria records, any progress bar would be invented.
5. **No automated outside discovery.** Everything in the Library is typed in by the owner.
6. **No automated tests on GitHub.** Test results are only as fresh as the last developer-session run.
7. **Unreviewed repositories.** 19 repositories have not been read beyond their GitHub metadata.

## 4. Duplicated or overlapping capabilities (outcome of the owner's review shown in the last column; none has been acted on in code)
| # | Overlap | Evidence | Risk if left | Proposed decision → **Owner outcome** |
|---|---|---|---|---|
| O1 | **Hub findings vs Portfolio.** The plan's finding kinds (idea, opportunity, project, decision, requirement, action, problem, research question, preference) overlap Portfolio types (decision, risk, opportunity, idea, requirement, issue). | plan section 3; `portfolio.cjs` | Two registers of the same ideas | One register: Portfolio. Findings stay in the Hub as **suggestions with source quotes**; accepting one **creates a Portfolio item that links back** (already the plan's intent). Keep a single list of kinds. → **Approved (A1).** |
| O2 | **Three "what should I do next" generators:** `attention.cjs` (Overview list), `briefing.cjs` (the Ask panel) and the planned PIH weekly report and Mission "next three actions". | code; plan | Three different answers to the same question | One rule engine feeds all of them; the weekly review is a rendering of the same items. → **Approved (A3).** |
| O3 | **`strategic-honesty-monitor` vs this console.** The former is described on GitHub as a "credential + frontend-key monitor … Cloudflare Worker, cron every 15 min, alerts via ntfy". This console has Secrets & Subscriptions, a health checker and email alerts. | GitHub description; code | Two monitors, two alert channels, double maintenance | **Not verified in depth.** Read that repository, then decide: retire, keep as the 15-minute watchdog, or merge. → **Read-only review approved (A6, D6);** the decision follows the review. Existing monitoring, alerts and health checks are reused (A2). |
| O4 | **`Problem-Signal` vs SHIOS vs this console's Portfolio opportunities** for market evidence and opportunity validation. | GitHub description (Problem-Signal); SHIOS repository not read | Three places that claim to hold market evidence | **Not verified.** Read both, then assign one role each (collector of evidence vs register of decisions). → **Review approved (A6, D6);** roles assigned afterwards. |
| O5 | **`shios-tracker` vs `SHIOS---Ai-Intelligence-Software`**, and **`personal-ai-studio` vs the media-studio repositories.** | names only; no description for `personal-ai-studio` | Possible duplicates | **Not verified.** Names suggest overlap; do not act until the inventory records what each does. → **Review approved (A6, D6).** |
| O6 | **Open-source states vs Portfolio decisions**: Library `decision` (`to_evaluate/adopt/watch/reject`) vs Portfolio `status` (`open/decided/done/dropped`). | code | Same idea tracked in two vocabularies | Keep both modules; define the charter's four library states and map the old values (`to_evaluate`→discovered/evaluated, `adopt`→approved/adopted, `watch`→postponed, `reject`→rejected) in a migration plan before any change. → **Approved (A4):** extend the existing Library; do not create another. |
| O7 | **Importer's `raw_text` vs Hub plan's JSONB.** Documented deviation in `PIH_IMPORTER.md`; the plan document is updated in this PR. | docs | Plan says one thing, code another | Resolved by documentation (plan updated). |

## 5. Decision register (owner decisions of 21 November 2026)

### Architectural decisions (approved after reviewing PR #5)
| ID | Decision | What it means in practice | Status |
|---|---|---|---|
| A1 | One **Portfolio** is the central register for ideas, decisions, opportunities, risks and actions. PIH findings are **suggestions linked to their original conversations**. | The Hub gets no second register; accepting a finding creates a Portfolio item that links back. Finding kinds are reduced to the Portfolio types plus project, action and research question. | Approved; not built |
| A2 | **Reuse the existing application monitoring, alerts and health-check infrastructure.** | No second monitor. The Overview's operations panel reads the existing routes. | Approved |
| A3 | **One shared recommendation engine** for the attention list, the What's wrong? panel and the future weekly intelligence report. | `attention.cjs` and `briefing.cjs` rules merge into one engine; the next three actions use it too. Rule-based, no AI. | Approved; not built |
| A4 | **Extend the existing Open-source Library** with recurring discovery; no second library. | Four states and the discovery run are added to the existing table and screen. | Approved; not built |
| A5 | **Keep repository discovery and source-code capability verification separate.** | Two separate fields and counts; "listed" never counts as "verified". | Approved; not built |
| A6 | **Review all 20 repositories read-only** for duplicate projects, reusable code, missing descriptions and potential commercial assets. | Reading only: no repository code, settings or data is changed. Done as its own roadmap step, **not performed in this documentation update**. | Approved; **not started** |
| A7 | **Add a standard PR template** with the six mission governance questions. | One text file, `.github/pull_request_template.md`. | Approved; **not added yet** (this PR is documentation only; roadmap Sprint 0) |
| A8 | **Add automated GitHub tests** using the existing test suite, without unnecessary dependencies. | A GitHub Actions workflow that runs `npm test` on Node 20 with a Postgres service container for the database tests. Adds no package. Free-minute allowance for this account is **not verified** (the repository is public; the others are private). | Approved; **not added yet** |
| A9 | **Local PIH conversation data stays private.** The deployed Overview shows **unavailable** until a secure, approved counts-only integration exists. | The aggregate route contains no Hub query; test enforces it. | Approved |

### Decisions D1 to D6
| ID | Decision | Detail | Status |
|---|---|---|---|
| D1 | The cloud Overview shows PIH as **unavailable** until a secure counts-only integration is approved. | Replaces the earlier options (a)/(b)/(c). A counts-only snapshot, if ever built, is a separate proposal with its own approval. | **Approved** |
| D2 | Sprint and acceptance records **reuse the existing PostgreSQL database**, after **backup verification and schema review**. | Order: owner completes the Railway backup check and restore test (`BACKUP_AND_RESTORE.md`), then a schema review of the tables in the Overview spec section 6, then approval, then creation. | **Approved; blocked on the backup check** |
| D3 | Standard PR governance template. | See A7. | **Approved** |
| D4 | Automated GitHub testing. | See A8. | **Approved** |
| D5 | **Verify PR branch dependencies before merging.** Intended sequence: #2, #3, #4, #5, with #4 retargeted to `main` if needed. | **Verified 21 November 2026 by rehearsal in a throwaway worktree (nothing was merged):** #2 merges into `main` cleanly. #3 merges cleanly after #2. **#4 conflicts after #2 in one file, `.gitignore`**, because both add lines at the end of it. #4 is based on #3's branch; once #2 and #3 are merged, #4 must be retargeted to `main` and updated, keeping **both** sets of ignore rules (additive, one file). #5 sits on #4 and inherits the same conflict until #4 is resolved. GitHub currently reports #4 and #5 as clean only against their own base branches. | **Approved; finding recorded; no merge done** |
| D6 | **Read-only review of all 20 repositories is approved.** Do not change repository code, settings or data. | Same as A6. Private repositories need read access granted for the session; the review changes nothing in them. | **Approved; not started** |

Suggested merge steps for the owner's approval (none is done): 1. complete the backup check; 2. merge #2; 3. merge #3; 4. retarget #4 to `main`, update it from `main` and keep both `.gitignore` blocks, re-run the tests, merge it; 5. retarget and merge #5; 6. then the small PR for the template and CI (A7, A8).

## 6. Final status summary

**Already built (live):** Command Center Phase 1: repository inventory with classification, deploy state and linked health; Portfolio; Open-source Library (empty until filled); attention list; rule-based "What's wrong?"; owner sign-in; first real sync of 20 repositories.
**Built, awaiting approval:** PR #2 (acceptance fixes, backup/restore guide, acceptance report); PR #3 (Hub design, documentation); PR #4 (local importer). None merged or deployed. PR #5 (mission documents and the visual Overview specification, documentation only).
**Approved but not yet built:** PR template and automated tests on GitHub (A7, A8); shared recommendation engine (A3); read-only review of the 20 repositories (A6, D6); separate discovery and capability verification (A5).
**Planned:** Hub search; Hub extraction and weekly review (AI needs separate approval); Mission Control Overview; repository intelligence fields; open-source discovery with four states; opportunity matching and validation; income tracking.
**Not started:** everything under "Not started" in section 2.
**Verified:** PR states and bases on GitHub; the list of 20 repositories and six repository descriptions; the code facts cited above; 27 of 27 test files and 88 importer checks passing in the developer session.
**Not verified:** real export formats; whether the free GitHub Actions allowance covers the private repositories; Railway backups and whether the daily job and email alerts are on in production; contents, features and health of the other 19 repositories; what SHIOS and Problem-Signal expose; every overlap in O3 to O5; model and provider terms for any AI step; test results on a clean machine (no CI).
