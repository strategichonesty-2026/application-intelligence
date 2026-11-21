# Capability and gap assessment

Status: assessment, 21 November 2026. Read-only inspection: GitHub PR state, the `application-intelligence` code on its branches, and GitHub repository metadata. No code, table or deployment was changed.
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
| Hub data visible in the deployed console | **Blocked by a decision (D1 below)** | importer writes to a local database by design | n/a |

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
2. **Hub data and the console are disconnected by design.** The importer is local-only; the console is deployed. Nothing can show Hub numbers on the Overview until D1 is decided.
3. **No place to record "what a repository actually does".** The inventory knows type, stack, deploy and one README sentence, but not features, run instructions, dependencies or unfinished work, so Objective 4 cannot be answered from it.
4. **No state history or acceptance records.** There is nothing the Overview can honestly count for progress. Without acceptance criteria records, any progress bar would be invented.
5. **No automated outside discovery.** Everything in the Library is typed in by the owner.
6. **No automated tests on GitHub.** Test results are only as fresh as the last developer-session run.
7. **Unreviewed repositories.** 19 repositories have not been read beyond their GitHub metadata.

## 4. Duplicated or overlapping capabilities (decisions needed; none was acted on)
| # | Overlap | Evidence | Risk if left | Proposed decision |
|---|---|---|---|---|
| O1 | **Hub findings vs Portfolio.** The plan's finding kinds (idea, opportunity, project, decision, requirement, action, problem, research question, preference) overlap Portfolio types (decision, risk, opportunity, idea, requirement, issue). | plan section 3; `portfolio.cjs` | Two registers of the same ideas | One register: Portfolio. Findings stay in the Hub as **suggestions with source quotes**; accepting one **creates a Portfolio item that links back** (already the plan's intent). Keep a single list of kinds. |
| O2 | **Three "what should I do next" generators:** `attention.cjs` (Overview list), `briefing.cjs` (the Ask panel) and the planned PIH weekly report and Mission "next three actions". | code; plan | Three different answers to the same question | One rule engine feeds all of them; the weekly review is a rendering of the same items. |
| O3 | **`strategic-honesty-monitor` vs this console.** The former is described on GitHub as a "credential + frontend-key monitor … Cloudflare Worker, cron every 15 min, alerts via ntfy". This console has Secrets & Subscriptions, a health checker and email alerts. | GitHub description; code | Two monitors, two alert channels, double maintenance | **Not verified in depth.** Read that repository, then decide: retire, keep as the 15-minute watchdog, or merge. |
| O4 | **`Problem-Signal` vs SHIOS vs this console's Portfolio opportunities** for market evidence and opportunity validation. | GitHub description (Problem-Signal); SHIOS repository not read | Three places that claim to hold market evidence | **Not verified.** Read both, then assign one role each (collector of evidence vs register of decisions). |
| O5 | **`shios-tracker` vs `SHIOS---Ai-Intelligence-Software`**, and **`personal-ai-studio` vs the media-studio repositories.** | names only; no description for `personal-ai-studio` | Possible duplicates | **Not verified.** Names suggest overlap; do not act until the inventory records what each does. |
| O6 | **Open-source states vs Portfolio decisions**: Library `decision` (`to_evaluate/adopt/watch/reject`) vs Portfolio `status` (`open/decided/done/dropped`). | code | Same idea tracked in two vocabularies | Keep both modules; define the charter's four library states and map the old values (`to_evaluate`→discovered/evaluated, `adopt`→approved/adopted, `watch`→postponed, `reject`→rejected) in a migration plan before any change. |
| O7 | **Importer's `raw_text` vs Hub plan's JSONB.** Documented deviation in `PIH_IMPORTER.md`; the plan document is updated in this PR. | docs | Plan says one thing, code another | Resolved by documentation (plan updated). |

## 5. Decisions needed from the owner
| ID | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | How do Hub figures reach the Overview, given the importer is local-only? | (a) Show Hub panel as "unavailable" in production; run a **local copy** of the console for the Hub. (b) Importer also writes a **counts-only snapshot** (numbers, no titles, no text) that the owner pastes or uploads into the console. (c) A staging database used only by the Hub (cost; needs approval). | (b) later; (a) until then. Never conversation text in production without a separate approval. |
| D2 | Where do acceptance criteria, sprints and business entries live? | (a) console tables; (b) a file in the repository | (a) after the backup check is done |
| D3 | Add `.github/pull_request_template.md` with the six governance questions? | yes / no | yes (text only) |
| D4 | Add a GitHub Actions test run (needs a Postgres service for the DB tests; free for this use) | yes / no | yes, as its own small PR; it makes "Tested" mean something |
| D5 | Order of merges | #2 → #3 → #4 (or retarget #4) | After the owner's Railway backup check |
| D6 | Allow a read-only look at the other 19 repositories (source, README, routes) to fill Objective 1 | yes / no, per repository (private repositories need access granted for the session) | yes, starting with the five flagged for descriptions plus Problem-Signal and SHIOS |

## 6. Final status summary

**Already built (live):** Command Center Phase 1: repository inventory with classification, deploy state and linked health; Portfolio; Open-source Library (empty until filled); attention list; rule-based "What's wrong?"; owner sign-in; first real sync of 20 repositories.
**Built, awaiting approval:** PR #2 (acceptance fixes, backup/restore guide, acceptance report); PR #3 (Hub design, documentation); PR #4 (local importer). None merged or deployed. This PR (mission documents, documentation only).
**Planned:** Hub search; Hub extraction and weekly review (AI needs separate approval); Mission Control Overview; repository intelligence fields; open-source discovery with four states; opportunity matching and validation; income tracking.
**Not started:** everything under "Not started" in section 2.
**Verified:** PR states and bases on GitHub; the list of 20 repositories and six repository descriptions; the code facts cited above; 27 of 27 test files and 88 importer checks passing in the developer session.
**Not verified:** real export formats; Railway backups and whether the daily job and email alerts are on in production; contents, features and health of the other 19 repositories; what SHIOS and Problem-Signal expose; every overlap in O3 to O5; model and provider terms for any AI step; test results on a clean machine (no CI).
