# Mission roadmap: prioritized sprints and acceptance criteria

Status: **plan only.** Nothing here is approved or started. Each sprint starts only after the owner approves it, and each ends in a pull request that is **not merged or deployed without approval**.
Charter: [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md) · Gaps and decisions D1 to D6: [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) · Overview: [MISSION_CONTROL_OVERVIEW_SPEC.md](MISSION_CONTROL_OVERVIEW_SPEC.md)

**Sizing is an estimate, not a promise.** S = a few focused hours, M = 1 to 3 days, L = about a week of focused work. Elapsed time is longer because many steps wait for the owner (samples, decisions, checks). No dates are given on purpose.

## 1. How the order was chosen
1. **Unblock before building** (a pile of unmerged PRs and an unverified backup is the biggest risk to everything else).
2. **Verify what already exists** (the importer on real files) before adding to it.
3. **Know our assets first** (Objective 1): matching opportunities to assets (Objective 4) is impossible without knowing what the assets do.
4. **A progress page that cannot lie** needs acceptance records first, so it comes right after repository intelligence and before the long tail.
5. **Anything involving AI or a provider is last in its chain**, needs its own approval, and is never a prerequisite for search.
6. **Income tracking is small** and goes last only because it needs the opportunities to track.

## 2. Sprint plan

### Sprint 0: Unblock (owner decisions and checks; almost no coding)
| | |
|---|---|
| Objective | Supports all; enables 1 and 2 |
| Reuse | Existing PRs #2, #3, #4 and this documentation PR; `BACKUP_AND_RESTORE.md` |
| Problem | Work is built but not safely landed; the backup is unverified; real export formats are unknown |
| Work | Owner: run the Railway backup check and local restore test; send sanitized ChatGPT and Claude samples; decide D1 to D6; review the 20 repository types in the console and confirm them; turn on GitHub secret scanning push protection. Claude: merge order plan (#2, then #3, then #4 or retarget), only on request. |
| Measurable result | 0 open decisions among D1 to D6; backup check recorded with a date; 20 of 20 repositories with a confirmed type; PRs merged in the agreed order |
| Verified by | Owner confirmation in chat; PR states on GitHub; the console's Applications page |
| Unknown | Whether the owner's Railway plan has backups at all |
| Size | S (owner time) |

### Sprint 1: Validate the importer on real exports (Objective 2)
| | |
|---|---|
| Reuse | **PR #4 importer unchanged in design**; `redact_sample.py` |
| Problem | The importer has only seen synthetic structures |
| Work | Run `--dry-run` on the real, unzipped exports; compare real structures with the parsers; fix differences found; add a test fixture built from the sanitized sample; import into the **local** database; report real totals (conversations, messages, characters). No search, no AI. |
| Measurable result | Real export imported with 0 unexplained failures; a list of every skipped or unreadable item with a reason; real size known (feeds any later AI cost estimate) |
| Verified by | Importer summary and exit code; a re-import that changes nothing; fixture tests; owner opens three known conversations in `psql` and confirms text and order |
| Unknown | Field changes since public documentation; export size |
| Size | S to M |

**Acceptance criteria**
- A1 Every conversation in the real exports is either stored or listed as an error with a reason (no silent loss): counts reconcile (found = added + skipped + failed).
- A2 For three conversations the owner chooses, stored text equals what the product shows.
- A3 The original file hash is unchanged after import.
- A4 No conversation text, password or connection string appears in any output.
- A5 Re-importing changes nothing.

### Sprint 2: Repository intelligence (Objective 1)
| | |
|---|---|
| Reuse | `ai_repos`, `repoSync`, `repoScan`, the existing detail page and the "verified needs evidence and date" rule; the GitHub token already has read access to Contents |
| Problem | The inventory cannot say what a repository actually does, how to run it, what depends on it, or what is unfinished; four repositories have no description |
| Work | (1) Add a rule-based **description quality flag** (empty, one-word, same as name) to the attention list. (2) Extend the repository record, additively, with owner-confirmed and **evidence-backed** fields: what it does, problem solved, implemented features (each with a file or route path and a date), how to configure and run, depends on, unfinished items, commercial note. (3) With owner approval per repository (D6), read the source read-only and fill the records for the six flagged repositories and for Problem-Signal and SHIOS first. |
| Measurable result | Repositories flagged for description: 5 now (verified by hand) → each reviewed; repositories with an evidence-backed features list: 0 → 8 initially; every listed feature has a source path and a date |
| Verified by | Tests (a feature cannot be saved without evidence and date; flag rule fixtures); owner reads the cards; spot check: owner picks two features and checks them in the code |
| Unknown | How large the private repositories are; whether the token covers every repository; feature detection stays **manual or session-assisted**, not automatic, because inferring features from code would invent them |
| Size | M to L |

**Acceptance criteria**
- B1 Each of the 20 repositories shows whether its GitHub description is missing, vague or acceptable, with the rule used.
- B2 A feature entry without evidence and date is rejected (same behaviour as Portfolio "verified").
- B3 For each completed repository, the plain-English answers to the nine questions in Objective 1 exist, or the field reads "unknown" (never blank, never guessed).
- B4 Updating a repository by sync never overwrites owner-confirmed fields (existing rule, kept).
- B5 No secret-like text can be stored (existing screening, kept).

### Sprint 3: Mission Control Overview v1 (all objectives; needs D2)
| | |
|---|---|
| Reuse | Existing Overview page, `attention.cjs`, `DataGate`, UI kit, the evidence-and-date validation pattern |
| Problem | There is no honest, single view of progress against the mission |
| Work | Build **only** panels A, B, C, H plus "unavailable / none recorded" placeholders for D, E, F, G, exactly as in the spec; acceptance-criteria, sprint and work-item records (tables approved first, additive); seed the criteria from this roadmap with state **Planned**; rule-based next three actions. The existing Overview content stays. |
| Measurable result | Six objective indicators show "n of m" from records, all starting at 0 verified of their real m; no hardcoded figure anywhere |
| Verified by | The 11 acceptance criteria in the spec, section 6; screenshots; existing 27 test files green |
| Unknown | Whether the owner will keep the records up to date (a stale record is flagged by the existing stale-evidence idea) |
| Size | L |

### Sprint 4: Hub search and where the Hub lives (Objective 2; needs D1)
| | |
|---|---|
| Reuse | PR #4 tables; the full-text pattern in `portfolio.cjs` (generated `tsvector`, GIN index, `websearch_to_tsquery`); owner gate and UI kit |
| Problem | Conversations are stored but cannot be found by keyword in a screen |
| Work | Local-only search (command line or a local copy of the console, per D1); keyword, platform and date filters; open the original conversation; counts-only snapshot for the Overview if D1 chooses it. |
| Measurable result | A known old conversation is found from one keyword in under 10 seconds (the Hub plan's own test) |
| Verified by | Tests with fixtures; owner finds two known conversations on real data |
| Unknown | Real data volume and the search quality of English-only stemming for mixed-language text |
| Size | M |

### Sprint 5: Open-source discovery (Objective 3)
| | |
|---|---|
| Reuse | Library table, `oss.cjs` rules, the GET-only GitHub client (`github.cjs`), the daily pass for scheduling |
| Problem | The Library is filled only by hand; states do not match the mission |
| Work | Agree and test the mapping of old to new states (discovered, evaluated, approved, adopted, rejected or postponed) **before** changing data; add GitHub **search** (read-only, public data), saved search definitions ("gap" queries) with weekly or biweekly interval, a run record with last scan date, new fields (purpose, relevance, which of our repositories, dependencies and compatibility, recommended action, last checked), a real reference from a candidate to a repository. Candidates arrive as **discovered** only. |
| Measurable result | Last scan date shown; candidates per state; for every candidate the evaluation fields are filled **with a source and date** or visibly "unknown" |
| Verified by | Tests with a fake GitHub (rate limit, empty result, duplicates, changed repository); a test that **nothing clones, installs or merges**; the job failing never blocks the health pass |
| Unknown | GitHub search rate limits for the token in use; licence data quality from the API (a licence shown by GitHub is evidence to record, not proof of safe use) |
| Size | L |

### Sprint 6: Opportunity matching and validation (Objectives 4 and 5)
| | |
|---|---|
| Reuse | Portfolio `opportunity` records and evidence rule; repository intelligence (Sprint 2); Library references (Sprint 5); Hub search (Sprint 4) |
| Problem | Opportunities are not checked against what we already own |
| Work | Six classifications; eight validation criteria each with an evidence level and date; **asset check** that lists matches from repositories (features), deployments, Library candidates and (where available) Hub conversations, by search plus owner confirmation, with each source marked checked or **unavailable**; rule that "build new" requires the criteria answered. SHIOS and Problem-Signal: read their repositories first (D6) and record exactly what can be read, **before** any integration. |
| Measurable result | Opportunities with a completed asset check; count per classification; "build new" opportunities without validation = 0 (enforced) |
| Verified by | Tests with fixtures; owner runs three real opportunities through the check and compares with their own judgement |
| Unknown | What SHIOS and Problem-Signal can provide; whether matches by text search are good enough (the Hub plan already says add vectors only if search is shown to miss real cases) |
| Size | L |

### Sprint 7: Hub extraction with AI (Objective 2; **separate approval**)
| | |
|---|---|
| Reuse | Hub plan sections 5 and 6; Portfolio as the single register (decision O1) |
| Problem | Finding ideas and decisions across thousands of messages by hand is not realistic |
| Work | Only after the owner approves provider, key, budget cap and the provider's retention terms (read and recorded): redaction module, held-back sensitivity default, dry-run token and cost estimate, provider-use log, review queue; findings are **suggestions with a source quote**; accepted ones create Portfolio items. This is an explicit exception to the console's "monitoring never calls an AI" rule and stays in its own module. |
| Measurable result | Findings per kind and certainty; accepted versus rejected rate; money spent versus the cap |
| Verified by | Fake-provider tests asserting what is sent; a held-back conversation is never sent; a finding without a quote is rejected; prompt-injection sample causes no action |
| Unknown | Provider terms, prices, quality on the owner's data |
| Size | L |

### Sprint 8: Business progress and the weekly review (Objective 6, and Overview panels F and G)
| | |
|---|---|
| Reuse | Overview panels; the rule engine (decision O2) |
| Problem | Nothing tracks customer validation or revenue; the review is manual |
| Work | Owner-entered records for customer validation, experiments, readiness, sales, revenue (no payment data, ever); rule-based weekly or biweekly review text with sources; optional email through the existing Resend setup |
| Measurable result | Panels F and G show real records or "none recorded"; the weekly review lists sources and names unavailable ones |
| Verified by | Tests; a review generated twice from the same data is identical |
| Unknown | None of this produces income by itself; it only makes progress visible |
| Size | M |

## 3. Governance answers per sprint (the six questions)
| Sprint | 1 Objective | 2 Reused | 3 Problem | 4 Result | 5 Verified by | 6 Unknown |
|---|---|---|---|---|---|---|
| 0 | all | PRs, guides | work not landed, backup unverified | decisions closed | owner, GitHub | backup plan |
| 1 | 2 | PR #4 | importer unproven | real import reconciles | counts, owner spot checks | real formats |
| 2 | 1 | inventory, scan, evidence rule | assets not understood | evidence-backed repository cards | tests, owner spot check | repository size |
| 3 | all | Overview, attention | no honest progress view | indicators from records | spec criteria 1 to 11 | record upkeep |
| 4 | 2 | PR #4, full-text pattern | cannot find conversations | known item found in under 10 s | tests, owner | data volume |
| 5 | 3 | Library, GitHub client, daily pass | Library is manual | recurring scans, four states | fake-GitHub tests | search limits |
| 6 | 4, 5 | Portfolio, Sprints 2, 4, 5 | opportunities not matched | checked opportunities | fixtures, owner | SHIOS access |
| 7 | 2 | Hub plan, Portfolio | manual extraction | reviewed findings | fake-provider tests | provider terms |
| 8 | 6 | Overview, rule engine | no income tracking | real records, weekly review | tests | income is not guaranteed |

## 4. Measurable success indicators (reported on the Overview once records exist)
Targets are for the owner to set; the ones below are derived from facts, not forecasts.
| Objective | Indicator | Source | Starting point (verified) |
|---|---|---|---|
| 1 | Repositories with a confirmed type | `ai_repos.kind` | not verified (owner has not confirmed in this review); total repositories 20 |
| 1 | Repositories with a missing or vague GitHub description | `gh_description` | 5 of 20 by hand: 4 empty, 1 vague (rule not yet built) |
| 1 | Repositories with an evidence-backed feature list | new field | 0 |
| 2 | Conversations imported from real exports | `pih_conversations` | 0 (importer unproven on real files) |
| 3 | Library candidates by state | `ai_oss_projects` | 0 records (starts empty; verified by design) |
| 3 | Days since last discovery scan | run record | no scan exists |
| 4 | Opportunities with a completed asset check | new | 0 |
| 5 | Opportunity criteria verified (not assumed) | new | 0 |
| 6 | Customer validations, sales, revenue | new, owner-entered | none recorded |
| Quality | Test files passing on GitHub (CI) | CI | no CI exists; 27 of 27 pass in the developer session |

## 5. Acceptance criteria by major capability (summary; detail lives in each sprint)
| Capability | Accepted when |
|---|---|
| Repository intelligence | B1 to B5 hold for every repository marked complete; owner spot-checks two features per repository |
| Hub import | A1 to A5 hold on real exports |
| Hub search | Known conversation found by keyword in under 10 seconds; hostile text is treated as data; every route needs sign-in |
| Open-source discovery | Scan runs on schedule and records its run; candidates enter only as "discovered"; nothing is cloned, installed or merged (tested); each evaluated candidate has licence, maintenance and security fields with source and date |
| Opportunity matching | Every opportunity shows each source as checked (with date) or unavailable; one of six classifications is chosen by the owner; "build new" needs validation |
| Validation | All eight criteria answered with an evidence level; verified requires source and date |
| Income tracking | Entries are owner-made and dated; no estimate appears as fact; revenue is "unavailable" until a real entry exists |
| Mission Control Overview | Spec section 6, criteria 1 to 11 |
| Weekly review | Same data gives the same text; every line names its source; unavailable sources are named |

## 6. Rules that apply to every sprint
No merge, deploy, credential change, production variable change or paid service without the owner's explicit approval (`CLAUDE.md`). No secrets in GitHub or chat. Personal conversations never go to production or to an AI provider without a separate approval. Unknown stays unknown. Every PR carries the six mission questions.
