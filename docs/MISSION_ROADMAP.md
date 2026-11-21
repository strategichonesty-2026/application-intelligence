# Mission roadmap (v2): implementation sequence and acceptance criteria

Status: **plan only.** Nothing here is started. Each sprint starts only after the owner approves it, and ends in a pull request that is **not merged or deployed without approval**.
Charter: [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md) · Decisions A1 to A9 and D1 to D6: [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) · Overview (layout, components, KPIs, click-through, responsive criteria): [MISSION_CONTROL_OVERVIEW_SPEC.md](MISSION_CONTROL_OVERVIEW_SPEC.md)

**Sizing is an estimate, not a promise.** S = a few focused hours, M = 1 to 3 days, L = about a week of focused work. Elapsed time is longer because many steps wait for the owner. No dates are given on purpose.

## 1. Changes in v2
- The owner approved decisions A1 to A9 and D1 to D6, so the "decide" items are now **scheduled work**.
- **Sprint order changed:** repository review first (A6/D6), then the shared recommendation engine (A3), then the Agile and acceptance records (D2, after the backup check), then the visual Overview.
- **The Overview is delivered in slices**: a panel is switched on in the sprint that creates its data. Until then it shows "unavailable" or "none recorded". Nothing is faked to fill the page.
- **Hub tile stays "unavailable"** in the deployed console (A9, D1); no sprint here changes that.

## 2. Implementation sequence at a glance
| # | Sprint | Objective | Reuses (exists) | New | Needs first | Approval gate |
|---|---|---|---|---|---|---|
| 0 | Unblock: land PRs in a verified order; PR template; GitHub tests | all | PRs #2 to #5; existing test suite | `.github/pull_request_template.md`; one CI workflow file | Owner backup check | Merge approvals |
| 1 | Read-only review of all 20 repositories | 1 | Sync data; GitHub read access | A written review per repository (documents only) | Read access to private repositories for the session | D6 given; per-repository access |
| 2 | Validate the importer on real exports | 2 | PR #4 importer | Parser fixes found on real files | Owner's sanitized samples | None beyond sprint start |
| 3 | Shared recommendation engine | all (A3) | `attention.cjs`, `briefing.cjs`, their tests | One engine module used by both; behavior kept | CI green (Sprint 0) | Sprint start |
| 4 | Mission records (criteria, epics, sprints, work items, state history) and `GET /mission` | all (D2) | PostgreSQL conventions, `initSchema` pattern, evidence-and-date rule | Tables and one read-only route | **Backup verified + schema review approved** | Schema review (D2) |
| 5 | Repository intelligence records (capability verification kept separate from discovery) | 1 (A5) | `ai_repos`, Sprint 1 reviews | Evidence-backed fields; description-quality flag | Sprints 1 and 4 | Sprint start |
| 6 | **Mission Control Overview v1 (visual)** | all | Overview page, UI kit, status tokens, SVG chart technique, existing routes | Panels A, B, C, F; filters; empty states | Sprints 3, 4, 5 | Design review of screenshots |
| 7 | Hub search (local only) | 2 | PR #4 tables; full-text pattern in `portfolio.cjs` | Local search tool | Sprint 2 | Sprint start |
| 8 | Open-source discovery (extend the Library) | 3 (A4) | Library, GET-only GitHub client, daily pass | Four states, discovery run, fields, repository links; panel D | Sprints 4 and 6 | Sprint start |
| 9 | Opportunity matching and validation | 4, 5 | Portfolio (A1), Sprints 5, 7, 8 | Six classifications, eight criteria, asset check; panel E | Sprints 5 to 8 | Sprint start |
| 10 | Hub extraction with AI | 2 | Hub plan sections 5 and 6 | Redaction, review queue, run log | **Separate approval:** provider, key, budget, retention terms | Separate approval |
| 11 | Business progress and weekly intelligence report | 6 | Overview, shared engine (A3), existing Resend email | Entries for validation, sales, revenue; rule-based report | Sprints 3, 6, 9 | Sprint start |

```
0 ──► 1 ──► 5 ──► 6 ──► 8 ──► 9 ──► 11
 │          ▲     ▲      ▲     ▲
 ├──► 2 ──► 7 ─────┼──────┼─────┘          (7 also feeds 9)
 └──► 3 ───────────┘      │
      4 (needs backup) ───┴──► 5, 6
 10 stands apart: only after its own approval, after 2 and 7
```
Why this order: unblocking and CI come first so everything after is tested on GitHub. The repository review is read-only, cheap and tells every later sprint what we really own. The shared engine is a refactor with no new data, safest to do before the Overview depends on it. Records come only after the backup check, because they would be hard to recreate. The Overview is built after its first data sources exist, so it never needs invented numbers.

## 3. Sprint details

### Sprint 0: Unblock (mostly owner steps and small text files)
| | |
|---|---|
| Objective | Supports all |
| Reuse | PRs #2 to #5; `BACKUP_AND_RESTORE.md`; the existing `npm test` runner |
| Problem | Work is built but not safely landed; merge order has a real conflict; "tested" currently means "tested by the developer session" |
| Work | **Owner:** run the Railway backup check and restore test; send the sanitized ChatGPT and Claude samples; confirm the 20 repository types in the console; turn on GitHub secret scanning push protection. **Merge plan (each step needs the owner's yes):** merge #2; merge #3; retarget #4 to `main`, update it from `main` and keep **both** `.gitignore` blocks (the one conflict found), re-run tests; merge #4; merge #5. **Claude, as separate small pull requests:** (a) `.github/pull_request_template.md` with the six questions (A7); (b) one GitHub Actions workflow that runs `npm test` on Node 20 with a Postgres service container for the database tests, adds no package, and fails if `package.json` dependencies change without approval (A8). |
| Measurable result | Backup check recorded with a date; 4 of 4 PRs merged in order with tests green after each; every new PR shows the six questions; the test suite runs on GitHub for each push |
| Verified by | Owner confirmation; PR states on GitHub; the first green Actions run |
| Unknown | Whether Railway backups exist on the plan; the GitHub Actions free allowance for the private repositories (the repository for this console is public) |
| Size | S to M |

**Acceptance criteria:** S0-1 Backup and restore test completed and recorded. S0-2 Merge order executed with the conflict resolved by keeping both ignore blocks; full tests pass after each merge. S0-3 Template appears on a new PR. S0-4 CI runs the same 27 test files plus database tests and is green on `main`. S0-5 No new runtime dependency was added.

### Sprint 1: Read-only review of all 20 repositories (Objective 1; A6, D6)
| | |
|---|---|
| Reuse | The sync's repository data; GitHub read access; the existing classification suggestions |
| Problem | We know the names, types and last-push dates of 20 repositories, but not what each does, what is reusable, what duplicates what, or what could be sold |
| Work | For each repository, **read only**: README, configuration, dependency files, route and entry-point files, deployment files. Produce `docs/REPOSITORY_REVIEW.md`, one section per repository: what it is and why it exists in plain English; **features actually implemented, each with a file path** (capability verification); how to configure and run; what depends on what; deployment evidence; unfinished work; duplicates and overlaps (starting with the open questions O3 to O5); reusable code; potential commercial value labelled as **opinion, not evidence**; a proposed GitHub description for the five that lack one. **No repository code, setting or data is changed.** Anything not read is marked "not reviewed". |
| Measurable result | 20 of 20 repositories reviewed or explicitly marked "not reviewed" with a reason; every feature claim has a file path; list of confirmed duplicates; list of reusable components; list of candidate commercial assets |
| Verified by | Owner spot-checks two features per repository against the code; a second read of any claim the owner doubts |
| Unknown | Repository sizes; whether every private repository can be read in one session |
| Size | L |

**Acceptance criteria:** RV-1 Each feature listed has a source path. RV-2 No repository received any commit, branch, setting or issue. RV-3 Discovery (listed) and capability verification (source read) are reported as separate columns. RV-4 Duplicates and reusable code are listed with the evidence that makes them duplicates or reusable. RV-5 Commercial value statements are labelled as hypotheses.

### Sprint 2: Validate the importer on real exports (Objective 2)
| | |
|---|---|
| Reuse | **PR #4 importer, unchanged in design**; `redact_sample.py` |
| Problem | The importer has only seen synthetic structures |
| Work | `--dry-run` on the unzipped real exports; fix real differences; add a fixture from the sanitized sample; import into the **local** database; report real totals. No search, no AI, nothing leaves the computer. |
| Measurable result | Every conversation is stored or listed as an error with a reason; found = added + skipped + failed |
| Verified by | Importer summary; a re-import that changes nothing; owner opens three known conversations and confirms text and order |
| Unknown | Format changes since public documentation; export size |
| Size | S to M |

**Acceptance criteria:** A1 counts reconcile. A2 three owner-chosen conversations match the product's display. A3 export file hash unchanged. A4 no conversation text, password or connection string in any output. A5 re-import changes nothing.

### Sprint 3: Shared recommendation engine (A3)
| | |
|---|---|
| Reuse | `attention.cjs`, `briefing.cjs`, the Ask panel and their existing tests |
| Problem | Two rule sets answer "what needs attention" separately; a third (weekly report) and a fourth (next three actions) are planned |
| Work | One engine module with one rule list and one item format; the attention list and What's wrong? become views of it. **Behavior is preserved**: the existing tests pass unchanged first, then the engine's own tests are added. No AI, no new route. |
| Measurable result | One rule list instead of two; the same fixtures give the same items as before |
| Verified by | Existing tests green and unchanged; a fixture test comparing old and new outputs |
| Unknown | None significant |
| Size | M |

**Acceptance criteria:** E1 existing attention and briefing tests pass without edits. E2 identical input gives identical, ordered output. E3 every item carries its rule and evidence. E4 no AI or network call (the existing allow-list test stays green).

### Sprint 4: Mission records and `GET /mission` (D2)
| | |
|---|---|
| Reuse | Existing PostgreSQL, `initSchema` with advisory lock, the evidence-and-date validation pattern, owner gate |
| Problem | There is nothing the Overview can honestly count for progress |
| Work | **Gate first:** backup check done (Sprint 0) and a **schema review** document approved by the owner. Then: criteria, epics, sprints, work items, links, state history and business entries as additive tables; validation (no Accepted or Live without evidence and date; every state change writes history); one read-only aggregate route behind the owner sign-in; the criteria seeded from this roadmap with state **Planned**; the route contains **no Hub query**. |
| Measurable result | Six objectives show "n of m" computed from the records; trend data derivable from history |
| Verified by | Tests for validation, history, derivation rules, 401 without token; the tables count test updated deliberately |
| Unknown | Whether the owner will keep records current; a stale-record flag is part of the work |
| Size | L |

**Acceptance criteria:** M1 a criterion cannot be Accepted or Live without evidence and date. M2 history is written on every change and cannot be edited silently. M3 the objective state derivation matches the spec for every state. M4 editing a document changes no count. M5 the route has no Hub data. M6 all routes need sign-in.

### Sprint 5: Repository intelligence records (Objective 1; A5)
| | |
|---|---|
| Reuse | `ai_repos` and its sync (the sync still never overwrites owner fields); Sprint 1's review |
| Problem | The inventory cannot say what a repository does, how to run it, what depends on it, or what is unfinished |
| Work | Additive, owner-confirmed, **evidence-backed** fields (features with file path, date and reader; run note; depends on; unfinished; commercial note) stored **separately from discovery data**; a rule-based description-quality flag feeding the shared engine; the Sprint 1 findings entered for the repositories the owner confirms. |
| Measurable result | Repositories with a capability-verified feature list: 0 now, then the number the owner confirms; description flags visible for the 5 known cases |
| Verified by | Tests (evidence required; sync never overwrites; secret screening kept); owner spot check |
| Unknown | How much of the review the owner wants stored versus kept as a document |
| Size | M |

**Acceptance criteria:** B1 the description flag names its rule. B2 a feature without evidence and date is rejected. B3 unknown stays "unknown". B4 "listed" is never counted as "capability-verified". B5 a re-sync never changes owner-confirmed fields.

### Sprint 6: Mission Control Overview v1, visual (all objectives)
| | |
|---|---|
| Reuse | Existing Overview page and all existing blocks; UI kit; status tokens; the SVG chart technique; `useRoute` filters; existing routes |
| Problem | There is no single, honest, visual view of the mission |
| Work | Build, per the spec: mission header, six objective bars, overall bar, sprint header, Kanban board (state changes through the card dialog, no new library), next three actions (shared engine), dependency list, operations panel gathering the existing monitoring figures, repository intelligence panel, filters (objective, sprint, project, status), click-through drawers, three empty states. Panels D, E and G show "unavailable" or "none recorded" until their sprints. Hub tile: **unavailable**. Existing blocks stay below, unchanged. |
| Measurable result | The page renders from stored records only; each figure links to its records |
| Verified by | Spec functional criteria 1 to 14 and responsive criteria R1 to R12; screenshots at 1440, 1024, 768, 390 and 320 px reviewed by the owner |
| Unknown | How the board feels with real work items |
| Size | L |

**Acceptance criteria:** the Overview specification, sections 8 and 9, in full.

### Sprint 7: Hub search, local only (Objective 2)
| | |
|---|---|
| Reuse | PR #4 tables; the full-text pattern in `portfolio.cjs` (generated `tsvector`, GIN index, `websearch_to_tsquery`) |
| Problem | Conversations are stored but cannot be searched |
| Work | Local-only search (command line or a local copy of the console); keyword, platform, date filters; open the original. The deployed console is unchanged and the deployed Overview still shows **unavailable** (A9). |
| Measurable result | A known old conversation is found from one keyword in under 10 seconds |
| Verified by | Tests with fixtures; owner finds two known conversations on real data |
| Unknown | Data volume; stemming quality for mixed-language text |
| Size | M |

### Sprint 8: Open-source discovery by extending the Library (Objective 3; A4)
| | |
|---|---|
| Reuse | Library table and rules, the GET-only GitHub client, the daily pass, the shared engine for warnings |
| Problem | The Library is filled by hand; its states do not match the mission |
| Work | Migration plan old to new states **before** any data change; GitHub **search** (read-only public data) with saved queries and a weekly or biweekly interval; a discovery run record; fields for purpose, relevance, dependencies and compatibility, recommended action and last checked; a real reference from a candidate to a repository; warnings for licence and maintenance; Overview panel D switched on. Candidates arrive as **discovered** only; **nothing is cloned, installed or merged.** |
| Measurable result | Last scan date; counts per state; every evaluated candidate has its fields with source and date |
| Verified by | Fake-GitHub tests (rate limit, empty, duplicates, changes); a test that nothing clones, installs or merges; job failure never blocks the health pass |
| Unknown | GitHub search limits for the token; licence data from the API is evidence to record, not permission to use |
| Size | L |

### Sprint 9: Opportunity matching and validation (Objectives 4 and 5)
| | |
|---|---|
| Reuse | Portfolio opportunities (A1), repository intelligence, Library links, local Hub search (as an owner-run lookup, not a cloud feed) |
| Problem | Opportunities are not checked against what we own |
| Work | Six classifications; eight criteria with evidence levels; asset check listing matches from each source as checked (date) or **unavailable**; "build new" requires validation; SHIOS and Problem-Signal roles settled by the Sprint 1 review before any integration; Overview panel E on. |
| Measurable result | Opportunities with a completed asset check; classification counts; "build new" without validation = 0 (enforced) |
| Verified by | Fixtures; owner runs three real opportunities through it |
| Unknown | What SHIOS and Problem-Signal can provide; whether text search is enough |
| Size | L |

### Sprint 10: Hub extraction with AI (**separate approval required**)
Unchanged from the Hub plan: only after the owner approves provider, key, budget cap and recorded retention terms. Redaction, held-back default, dry-run cost estimate, provider-use log, review queue; findings are suggestions with a source quote and become Portfolio items only when accepted (A1). Explicit exception to the console's "monitoring never calls an AI" rule, kept in its own module. Size L.

### Sprint 11: Business progress and the weekly intelligence report (Objective 6)
Owner-entered customer validation, experiments, readiness, sales and revenue (no payment data, ever); Overview panels E and G complete; weekly or biweekly report **rendered from the shared engine (A3)**, rule-based, naming every source and every unavailable source; optional email through the existing Resend setup. The report never invents or projects revenue. Size M.

## 4. Governance answers per sprint (the six questions)
| Sprint | 1 Objective | 2 Reused | 3 Problem | 4 Result | 5 Verified by | 6 Unknown |
|---|---|---|---|---|---|---|
| 0 | all | PRs, guides, test suite | work not landed; tests not on GitHub | ordered merges, CI green | owner, GitHub | backup plan, Actions allowance |
| 1 | 1 | sync data | assets not understood | 20 reviewed repositories | owner spot checks | repository size |
| 2 | 2 | PR #4 | importer unproven | real import reconciles | counts, owner | real formats |
| 3 | all | attention, briefing | duplicate rule sets | one engine | existing tests unchanged | none significant |
| 4 | all | Postgres, evidence rule | no honest progress source | records and route | tests, schema review | record upkeep |
| 5 | 1 | `ai_repos`, Sprint 1 | repository facts missing | evidence-backed cards | tests, owner | how much to store |
| 6 | all | Overview, UI kit | no visual mission view | dashboard from records | spec criteria, screenshots | real-data feel |
| 7 | 2 | PR #4, full-text pattern | cannot find conversations | known item in under 10 s | tests, owner | volume |
| 8 | 3 | Library, GitHub client | manual Library | recurring discovery | fake-GitHub tests | search limits |
| 9 | 4, 5 | Portfolio, Sprints 5 to 8 | opportunities unmatched | checked opportunities | fixtures, owner | SHIOS access |
| 10 | 2 | Hub plan, Portfolio | manual extraction | reviewed findings | fake-provider tests | provider terms |
| 11 | 6 | Overview, engine | no income tracking | real records, report | tests | income not guaranteed |

## 5. Success indicators (shown on the Overview once records exist)
Targets are for the owner to set; the starting points are facts, not forecasts.
| Objective | Indicator | Source | Starting point (verified 21 November 2026) |
|---|---|---|---|
| 1 | Repositories discovered | `ai_repos` | 20 |
| 1 | Repositories with a confirmed type | `ai_repos.kind` | Not verified (owner confirmation pending) |
| 1 | Missing or vague GitHub descriptions | `gh_description` | 5 of 20 by hand: 4 empty, 1 vague |
| 1 | Repositories **capability-verified** (source read) | new records | 0 |
| 2 | Conversations imported from real exports | local Hub database | 0 (importer unproven); deployed Overview: unavailable by design |
| 3 | Library candidates by state | `ai_oss_projects` | 0 records |
| 3 | Days since last discovery scan | run record | no scan exists |
| 4 | Opportunities with a completed asset check | new | 0 |
| 5 | Opportunity criteria verified (not assumed) | new | 0 |
| 6 | Customer validations, sales, revenue | new, owner-entered | none recorded |
| Quality | Test files passing on GitHub (CI) | CI | none yet (27 of 27 pass in the developer session) |

## 6. Acceptance criteria by capability
| Capability | Accepted when |
|---|---|
| PR governance and CI | S0-1 to S0-5 |
| Repository review | RV-1 to RV-5 |
| Hub import | A1 to A5 on real exports |
| Shared engine | E1 to E4 |
| Mission records | M1 to M6 |
| Repository intelligence | B1 to B5 |
| Mission Control Overview | Overview spec sections 8 (R1 to R12) and 9 (1 to 14) |
| Hub search | Known conversation found by keyword in under 10 seconds; hostile text is data; every route needs sign-in |
| Open-source discovery | Scheduled run recorded; candidates enter only as "discovered"; nothing cloned, installed or merged (tested); evaluated candidates have licence, maintenance and security fields with source and date |
| Opportunity matching | Every source shown as checked (date) or unavailable; one of six classifications chosen by the owner; "build new" needs validation |
| Validation | All eight criteria answered with an evidence level; verified requires source and date |
| Income tracking | Owner-made, dated entries; no estimate shown as fact; revenue "unavailable" until a real entry |
| Weekly intelligence report | Same data gives the same text; every line names its source; unavailable sources named |

## 7. Rules that apply to every sprint
No merge, deploy, credential change, production variable change or paid service without the owner's explicit approval (`CLAUDE.md`). No secrets in GitHub or chat. Personal conversations never go to production or to an AI provider without a separate approval. Repository reviews change nothing in the repositories. No new dependency or infrastructure for visualization. Unknown stays unknown. Every PR carries the six mission questions.
