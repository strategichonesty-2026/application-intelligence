# Mission Control: proposed Overview specification

Status: **proposal only. Nothing here is built.** The current Overview (monitoring summary, attention list, GitHub sync bar, "Ask" panel, application health table, incidents, activity) stays exactly as it is until the owner approves a sprint to change it.
Charter: [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md).

## 1. Principles
1. **Every figure comes from a record, a count of records, or a stored acceptance criterion.** No hardcoded numbers, no percentages typed in, no estimates.
2. **Unknown stays unknown.** A figure whose source is missing, empty, off, or unreachable shows the word **unavailable** with the reason ("Hub not connected to this console") and never `0`. A true zero is shown as `0` only when the source answered.
3. **Documentation is not functionality.** A criterion counts as met only with a recorded state and evidence (test run, PR, owner decision, deploy) and a date. A written plan moves nothing.
4. **Read-only roll-up.** The Overview reads other modules; it owns almost no data (see section 5).
5. **Reuse the existing page.** It is built by extending the current Overview, `attention.cjs` (the "needs attention" rule engine) and the existing UI kit. No new app, service or infrastructure.
6. **Plain English.** Same style as the rest of the console. One column on a phone; numbers link to the screen that holds the records behind them.

## 2. Layout (top to bottom, desktop; one column on mobile in the same order)

```
A  MISSION            "Build less from scratch. Create more value from what we already own."
B  SIX OBJECTIVES     [1 Know assets][2 Remember][3 Open source][4 Match][5 Validate][6 Income]
                      each: state label + "n of m criteria verified" + date of the newest evidence
H  THIS SPRINT        current sprint, done / outstanding, blockers, NEXT THREE ACTIONS
-- needs attention (existing list, unchanged) -------------------------------------------
C  REPOSITORY INTELLIGENCE        D  PERSONAL INTELLIGENCE
E  OPEN-SOURCE DISCOVERY          F  OPPORTUNITY INTELLIGENCE
G  BUSINESS PROGRESS
-- existing monitoring: application health, incidents, activity (unchanged) -------------
```
Why this order: the mission and the honest progress come first; the next actions come before the detail; the existing monitoring remains available and unchanged below.

## 3. Panels: figures, sources, and what is shown when the source is missing

"Source" is the record or API the figure is computed from. **Exists** means the source exists in the code today (verified); **New** means it needs work in a later sprint.

### A. Mission
Static text from the charter. No data.

### B. Six objective indicators
For each objective: the state (one of the eight states in the charter), "**n of m** criteria verified", and "newest evidence: date".
- Source: the **acceptance criteria records** (section 5): each criterion has `objective`, `text`, `state`, `evidence` (link or note) and `evidence_date`. n = criteria with state Accepted or Live **and** an evidence date; m = all criteria of that objective.
- The objective's state is derived by rule, not typed: no criteria → "Not started"; all criteria Planned → "Planned"; any In development → "In development"; and so on up to "Live" only when every criterion is Live. Blocked if any criterion is Blocked.
- If criteria records are not yet created: the panel says "Acceptance criteria not recorded yet" for each objective (not 0%).
- Source status: **New.**

### C. Repository intelligence
| Figure | Source | Status |
|---|---|---|
| Total repositories | `ai_repos` row count (GitHub sync) | Exists |
| Repositories with a confirmed type | `ai_repos.kind` not null | Exists |
| Repositories documented | repositories whose owner-confirmed purpose is filled **and** have a recorded evidence date for it | Purpose field exists; evidence-backed features and dates are **New** |
| Missing or incomplete GitHub descriptions | `gh_description` empty, or shorter than a set length, or equal to the repository name | Field exists; the flag is **New** (today, verified by hand: 4 empty, 1 vague) |
| Application deployment and health | `deploy_state`, and `health` only when linked to a monitored application | Exists |
| Unfinished projects | repositories with at least one recorded "unfinished" item, plus Invest repositories with no push in 60+ days (existing rule) | Dormant rule exists; "unfinished items" are **New** |
- Never shown as healthy unless a real check says so (existing rule): an unlinked repository shows "Not checked".

### D. Personal intelligence
| Figure | Source | Status |
|---|---|---|
| Conversation imports | `pih_imports` count by status | Importer built (PR #4, not merged), **in a local database** |
| Conversations and messages indexed | `pih_conversations`, `pih_messages` counts | same |
| Search capability | a recorded acceptance criterion (not a guess): "search returns a known conversation from a keyword" with evidence | **New** |
| Extracted ideas and decisions | `pih_findings` by kind and certainty | **New** (needs AI approval, PR 3 of the PIH plan) |
| Unfinished commitments | findings of kind "action" or "decision" with no later mention | **New** |
- **Open decision (blocks this panel):** the importer writes to a **local** database by owner decision, so the deployed console **cannot read it**. Until decided, this panel shows "unavailable: the Hub database is local and not connected to this console", never zeros. Options are in [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) section 5, decision D1.

### E. Open-source discovery
| Figure | Source | Status |
|---|---|---|
| Last scan date | the discovery job's own run record | **New** |
| Discovered / evaluated / approved / adopted counts | the library's state field | Library exists with `to_evaluate / adopt / watch / reject`; the four-state model is **New** |
| Potential matches with existing products | links from a candidate to a repository it could improve | Free-text `gap` and `repo_name` exist; a real link is **New** |
- A candidate is "evaluated" only when licence, maintenance, security note and effort are filled and verified with a source and date (existing honesty rule).

### F. Opportunity intelligence
| Figure | Source | Status |
|---|---|---|
| Opportunities discovered | Portfolio items of type `opportunity` | Exists |
| Validated | opportunities whose eight criteria are answered, each with evidence level | Evidence level exists; the eight criteria are **New** |
| Matched to existing assets | opportunities with a completed asset check and one of the six classifications | **New** |
| Commercialization candidates | classification 1 (already built) or 2 (partially built) | **New** |
| Rejected or postponed | `status = dropped` today; classification 6 later | Partly exists |

### G. Business progress
Customer validation entries, commercial experiments, products ready to sell, actual revenue. Source: owner-entered records (section 5). Status: **New.** Until an entry exists it shows "none recorded", and revenue shows "unavailable". It never shows a projected figure.

### H. Sprint management
Current sprint, completed and outstanding items, blockers, **next three recommended actions**.
- Source: sprint and work-item records (section 5). The three actions are chosen by **fixed rules** (existing `attention.cjs` pattern): a blocked item that only the owner can unblock; then the highest-objective-gap item whose prerequisites are done; then the oldest stale item. Each action shows the rule and the evidence that selected it. No AI, no randomness.
- If no sprint is recorded: "No sprint recorded".

## 4. Accessibility, mobile and performance
- Same UI kit and tokens; badges carry text, never color alone; numbers are links.
- Panels load independently (the existing `DataGate` pattern): one failed source shows its own error and does not blank the page.
- No new network calls from the browser: all figures come from one new read-only API route that aggregates stored records.
- Acceptance (owner can check): desktop and 390 px phone screenshots; no horizontal scroll; every figure has a visible source or tooltip naming its table or record kind.

## 5. Records the Overview would need (design only; **no table is created by this document**)
| Record | Fields (proposal) | Why |
|---|---|---|
| Acceptance criterion | id, objective 1 to 6, text, state (eight states), evidence note or link, evidence date, owner-confirmed flag | The only honest source for B |
| Sprint | id, name, start, end, goal, objective(s) | H |
| Work item | id, sprint, title, state, blocker note, objective, linked PR | H, and the "next three actions" |
| Business entry | id, kind (customer validation / experiment / sale / revenue), date, description, amount for revenue only, source | G |
| Repository intelligence fields | extra owner-confirmed and evidence-backed fields on the existing repository record (features with source, run/config note, unfinished items, depends-on, commercial note) | C |
| Opportunity extensions | classification (six values), eight criteria each with evidence level and date | F |

Storage options for the first three (decide in Sprint 0): **(a)** console database tables (consistent with the Portfolio, editable on screen, backed up with it); **(b)** a version-controlled file in the repository read by the console (no tables, but edits need a commit). Recommendation: (a), but **only after PR #2's backup check is complete**, because these records would be the first to be hard to recreate.

## 6. Acceptance criteria for the Mission Control Overview (all must hold)
| # | Criterion | How it is verified |
|---|---|---|
| 1 | Every figure is traceable to a stored record or a count of records | A test lists each figure's source query; a review reads them |
| 2 | No hardcoded percentage or count exists in the code | A test scans the Overview code and fails on numeric literals used as data; owner review |
| 3 | A missing, empty, or unreachable source shows "unavailable" with a reason, never `0` | Tests with each source empty and each source failing |
| 4 | The state shown for an objective can be derived from its criteria by the stated rule | Unit test of the rule with every state |
| 5 | A criterion cannot become Accepted or Live without evidence and a date | Validation test (same pattern as Portfolio's "verified needs evidence and a date") |
| 6 | Documentation changes alone change no indicator | Test: adding a document or editing a plan record leaves criteria counts unchanged |
| 7 | The "next three actions" are reproducible: same data gives the same three, each with its rule and evidence | Test with fixtures |
| 8 | The existing Overview content (health, incidents, attention, sync) still works and its tests still pass | Existing 27 test files green |
| 9 | Every route stays behind the owner sign-in | Existing "every endpoint 401 without a token" test extended |
| 10 | Works on a 390 px phone and at 1440 px with no console errors | Screenshots reviewed by the owner |
| 11 | No AI or paid service is called to build the page | Source scan, same as the existing monitoring allow-list test |

## 7. Not decided yet (needs the owner)
D1 where Hub figures come from; D2 where the criteria and sprint records are stored; D3 whether the existing "Ask" panel stays as is (it is rule-based, not AI) or becomes the entry point to the mission review. See [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) section 5.
