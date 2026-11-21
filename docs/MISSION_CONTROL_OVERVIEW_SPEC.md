# Mission Control: visual Overview specification (v2)

Status: **proposal only. Nothing here is built.** The current Overview stays exactly as it is until the owner approves a build sprint. This version (v2) adds the visual dashboard, Agile management, KPI definitions and click-through behavior the owner requested on 21 November 2026.
Charter: [INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md](INTEGRATED_APPLICATION_INTELLIGENCE_MISSION.md) · Decisions: [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md) · Build order: [MISSION_ROADMAP.md](MISSION_ROADMAP.md)

> Mission (unchanged): **Understand what we own, remember what we discussed, discover useful open-source technology, match opportunities with existing assets, validate market demand and turn valuable opportunities into income.**

**Legend used throughout.** **[Exists]** = in the code today (verified by reading it). **[New]** = proposed, not built. **[Not verified]** = depends on something not yet checked.

## 1. Principles
1. **Every figure comes from a stored record, a count of records, or a stored acceptance criterion.** No hardcoded numbers, no percentages typed in, no estimates, no projections.
2. **Three different empty states, never confused with zero:**
   - **Unavailable**: the source cannot be reached or is not connected (grey dashed outline, with the reason). Example: the Hub database is local. The number is **not shown**.
   - **None recorded**: the source answered and holds no records. Shown as `0` or "none recorded".
   - **Not verified**: a record exists but lacks the evidence or date the rule requires (amber outline). It is **excluded** from every "verified" count and listed separately.
3. **Documentation is not functionality.** A criterion counts as done only with a state, evidence and a date. Editing a document moves no indicator.
4. **Read-only roll-up.** The Overview reads other modules and owns only the Agile and acceptance records (section 6).
5. **No new dependency.** Charts are small hand-built SVG components, the same technique the console already uses for response-time and uptime charts. No chart library, no drag-and-drop library, no paid service, no monitoring platform, no new database or job scheduler.
6. **Reuse before building**: every component in section 4 marks what it reuses.
7. **Plain English, compact cards**: dense but readable; no large empty panels; one column on a phone.

## 2. Existing versus proposed (so nothing is rebuilt)

| Area | Exists today **[Exists]** | Proposed **[New]** |
|---|---|---|
| Overview page | Monitoring summary cards (registered, healthy, attention, incidents), "needs attention" list, GitHub sync bar, "Ask" panel (What's wrong?), application health table, recent incidents, activity feed | Mission header, six objective bars, sprint and Kanban panels, repository, Hub, open-source, opportunity and business panels, filters. The existing blocks are **kept and moved down**, unchanged |
| Charts | Hand-built SVG: response-time chart and uptime view | Progress bars, stacked bars, trend line, sparkline (same technique) |
| Status colors | Tokens: ok (green), warn (amber), bad (red), neutral (grey), info (blue) | Two proposed tokens for "Tested" and "Live" shades; everything else reuses these |
| Routing and filters | Hash routing with query parameters (`useRoute`), filters already used on Applications | Same mechanism for Overview filters |
| Data | `/summary`, `/applications`, `/incidents`, `/activity`, `/alerts`, `/inventory`, `/repos`, `/sync/status`, `/attention`, `/portfolio`, `/oss` | One new read-only aggregate route (`/mission`) for the new records; **no other new route** |
| Recommendations | `attention.cjs` (attention list) and `briefing.cjs` (What's wrong?) are **two separate rule sets** | **One shared recommendation engine** feeding the attention list, What's wrong?, the next three actions and the weekly report (owner decision A3) |
| Agile and acceptance records | None | Criteria, epics, sprints, work items, links, state history (design in section 6) |
| Open-source discovery | Library records entered by hand | Last scan, new candidates, four states, matches |
| Hub figures | None (importer is built in PR #4, local only) | **Unavailable** until a secure, approved counts-only integration exists (decision D1) |
| Business records | Portfolio `opportunity` items | Classification, validation criteria, customer validation, revenue entries |

## 3. Wireframes

### 3.1 Desktop (1440 px, three columns on the 12-column grid)
```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ MISSION  Understand what we own · remember what we discussed · discover open source ·        │
│          match opportunities to assets · validate demand · turn it into income               │
│ Filters:  Objective [All▾]  Sprint [Current▾]  Project [All▾]  Status [All▾]   as of 14:45   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ OVERALL  ███████░░░░░░░░░░░░░  7 of 31 criteria verified   (+ 4 awaiting validation, 1 blocked)│
│ 1 Know assets  ████░░░░░░  3/8 │ 2 Remember ██░░░░░░░░ 1/6 │ 3 Open source ░░░░░░░░░░ 0/5    │
│ 4 Match        ░░░░░░░░░░ 0/4  │ 5 Validate ░░░░░░░░░░ 0/4 │ 6 Income      ░░░░░░░░░░ 0/4    │
│ (each bar: ■ accepted/live  ■ tested  ■ awaiting validation  ■ in development  □ planned  ■ blocked) │
├───────────────────────────────────────────────┬──────────────────────────────────────────────┤
│ SPRINT 3 · "Mission Control v1"   day 6 of 10 │ NEXT THREE ACTIONS                          │
│ Planned 12  Done 5  Blocked 1                  │ 1 Owner: confirm backup check  (blocks 4)  → │
│ ▁▃▅▆ completion trend (closed sprints)         │ 2 Confirm 6 repository types              → │
│ ┌ Planned ┬ In dev ┬ Awaiting ┬ Tested ┬ Done ┐│ 3 Add Hub sample for Sprint 2              → │
│ │ card    │ card   │ card     │        │ card ││ each shows the rule and evidence that chose it│
│ │ card    │        │ ⚠ blocked│        │      ││                                              │
│ └─────────┴────────┴──────────┴────────┴──────┘│ DEPENDENCIES / BLOCKERS                      │
│ (click a card: details, evidence, dependencies)│ #14 blocked by #9 (owner decision D2)       → │
├───────────────────────┬────────────────────────┴───────┬──────────────────────────────────────┤
│ REPOSITORIES   [20]   │ PERSONAL INTELLIGENCE          │ OPEN-SOURCE DISCOVERY                │
│ confirmed type 6/20   │ Unavailable: Hub data is local │ last scan  3 days ago  ✓             │
│ described 15/20 ⚠5    │ (counts-only link not approved)│ discovered 14 · evaluated 6          │
│ capability-verified   │                                │ approved 2 · adopted 1               │
│  2/20  (source read)  │                                │ ⚠ 3 licence · 2 maintenance warnings │
│ deployed 9 · healthy 7│                                │ matches with our apps: 4          →  │
├───────────────────────┴────────────────┬───────────────┴──────────────────────────────────────┤
│ OPPORTUNITIES & BUSINESS                │ OPERATIONS                                          │
│ discovered 9 · matched 3 · validated 1  │ apps healthy 7/9 · incidents 1 · deploys ok 8       │
│ commercialization candidates 2          │ GitHub sync ✓ 2h ago · last scan ✓ · failed jobs 0  │
│ customer validation: none recorded      │ ⚠ security: 1 credential needs rotation · alerts: 0 │
│ revenue: unavailable (no entry yet)     │ (existing "needs attention" list sits below)        │
├─────────────────────────────────────────┴─────────────────────────────────────────────────────┤
│ Existing blocks, unchanged: needs attention · Ask · application health table · incidents ·     │
│ activity                                                                                        │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```
Numbers in the wireframe are **illustrative layout placeholders only**. The real page shows only stored values, and unavailable states where there are none.

### 3.2 Mobile (390 px, one column, same order)
```
┌──────────────────────┐
│ Mission (collapsible)│
│ Filters  [⌄ 4 active]│
│ OVERALL  ███░░  7/31 │
│ ▸ Objectives (6 bars)│
│ SPRINT 3  day 6/10   │
│ Next 3 actions   [1] │
│ Board: [Planned ▾]   │  one state column at a time,
│  card / card / card  │  chosen by a selector
│ Blockers & dependenc.│
│ Operations           │
│ Repositories         │
│ Open source          │
│ Opportunities        │
│ Hub: unavailable     │
│ Existing blocks      │
└──────────────────────┘
```
Panels are collapsible cards; the six objective bars sit in one accordion row so the first screen shows the overall bar, the sprint and the three actions.

## 4. Dashboard component inventory

**Reuse key:** E = exists and is reused as is; X = exists and is extended; N = new, hand-built, no dependency.

| # | Component | Purpose | E / X / N | Built from / reuses |
|---|---|---|---|---|
| 1 | `Card`, `Button`, `Select`, `SearchBox`, `Tip`, `Skeleton`, `Dialog`, `Toast`, `Accordion`, `Icon` | Layout and controls | E | `ui/primitives`, `ui/*` |
| 2 | `DataGate`, `StateMessage`, `ApiErrorState`, `Banner` | Loading, empty and error states per panel | E | Existing |
| 3 | `StatusBadge` / `Badge` | Status with text and icon, never color alone | E | Existing tones |
| 4 | `SummaryCards` (`Stat`) | KPI tile with label, value, note, link | X | Add: source chip, trend slot, three empty states |
| 5 | `AttentionList` | Needs-attention list | E | Fed later by the shared recommendation engine |
| 6 | `SyncBar` | GitHub sync status and "Sync now" | E | Existing |
| 7 | `HealthTable`, `Feeds` (incidents, activity) | Application health, incidents, activity | E | Existing, moved down |
| 8 | `AskPanel` | "What's wrong?" | X | Same rule engine as the attention list |
| 9 | `ResponseChart`, `UptimeView` (SVG) | Existing chart techniques | E | Pattern copied for new charts |
| 10 | `MissionHeader` | Mission text and as-of time | N | Static text from the charter |
| 11 | `FilterBar` | Objective, sprint, project, status filters | N | `Select` + `useRoute` query parameters; filters scope figures but never change their definitions |
| 12 | `ProgressBar` (stacked) | Overall and per-objective progress; per-epic; per-sprint | N | Plain SVG or CSS segments; segment text and counts always visible (no color-only meaning) |
| 13 | `ObjectiveCard` | One bar, "n of m", newest evidence date, link | N | Uses 12 |
| 14 | `KpiTile` | A figure with source chip, as-of time, three empty states, click-through | X of 4 | |
| 15 | `SourceChip` | Names the record kind and read time behind a figure; links to the records | N | |
| 16 | `TrendChart` | Sprint completion trend; capped at closed sprints; text table alternative | N | Same scaling approach as `ResponseChart`; shows "not enough history" until 2 closed sprints |
| 17 | `Sparkline` | Tiny history in a tile (only where real history exists) | N | |
| 18 | `KanbanBoard` + `KanbanColumn` | Visual board by state | N | Columns from the charter states; state changes through the card dialog (select + evidence + date), **not** drag-and-drop in v1 (works on a phone, no library). Drag can be added later only if wanted |
| 19 | `WorkCard` | Story or task card: title, objective tag, state, blocker flag, owner | N | |
| 20 | `DetailDrawer` | Click-through detail for a card, objective, criterion or KPI: evidence, dependencies, history | N | Built on `Dialog` |
| 21 | `SprintHeader` | Current sprint, goal, dates, day n of m, planned vs done | N | |
| 22 | `DependencyList` | Blocked-by and blocking relations | N | |
| 23 | `NextActions` | Next three actions with the rule and evidence that chose each | N | Shared recommendation engine |
| 24 | `UnavailableState`, `NoneRecordedState`, `NotVerifiedState` | The three empty states in section 1 | X of `StateMessage` | |
| 25 | `Recommendation engine` (server) | One rule set for attention list, What's wrong?, next three actions, weekly report | X | Merge the rules of `attention.cjs` and `briefing.cjs`; no AI |
| 26 | `GET /mission` (server) | One read-only aggregate of the new records | N | Same owner gate and conventions as the existing routes |

## 5. Panels, KPI definitions and exact data sources

All figures are read at request time. "Source" names the record or route. An **[Exists]** source can be built first; a **[New]** source needs the records in section 6.

### A. Mission progress
| KPI | Exact definition | Source | Status | Unavailable / empty when |
|---|---|---|---|---|
| A1 Overall mission progress | `criteria in state Accepted or Live with an evidence date` ÷ `all criteria`, shown as "n of m". Not an average of percentages. Criteria differ in size; the tile says "counts criteria, not effort" | acceptance criteria records | New | No criteria recorded → "Acceptance criteria not recorded" |
| A2 Six objective progress bars | Per objective: the same count; the bar is **segmented** by state: accepted or live, tested, awaiting validation, in development, planned or not started, blocked | criteria records | New | same |
| A3 Progress by epic | Per epic: work items by state | epic and work item records | New | No epics → none recorded |
| A4 Planned versus completed (selected sprint) | Planned = items added to the sprint **before its start date**; completed = those now Accepted or Live. Items added later are shown separately as "added mid-sprint" | sprint, work item, state history | New | No sprint → "No sprint recorded" |
| A5 Sprint completion trend | For each **closed** sprint: completed ÷ planned. Line plus a text table | sprint and state history | New | Fewer than 2 closed sprints → "Not enough history (n of 2 closed sprints)" |
| A6 Accepted versus blocked | Counts of work items and criteria in Accepted/Live versus Blocked | work items, criteria | New | No records → none recorded |
- The state of an objective is **derived by rule** from its criteria, never typed: none → Not started; all Planned → Planned; any In development → In development; any Built awaiting validation and none In development → Built, awaiting validation; all Tested → Tested; all Accepted → Accepted; all Live → Live; any Blocked → Blocked is flagged beside it.

### B. Agile management
| KPI / element | Exact definition | Source | Status |
|---|---|---|---|
| B1 Kanban board | Work items grouped by state (Not started, Planned, In development, Built awaiting validation, Tested, Accepted, Live); **Blocked** is a flag shown on the card and a filter, not a column that hides the item's real state | work items | New |
| B2 Current sprint and goal | The sprint whose dates contain today, else the most recent open one | sprints | New |
| B3 Active stories and tasks | Work items of kind story or task in state In development, in the selected sprint | work items | New |
| B4 Dependencies and blockers | `blocked_by` and `depends_on` links; a blocker has a note and an owner (owner or Claude) | work item links | New |
| B5 Next three actions | Chosen by the shared recommendation engine by fixed rules: (1) a blocked item that only the owner can unblock; (2) the unblocked item with the largest gap in its objective whose prerequisites are done; (3) the oldest stale item. Each action shows its rule and evidence. Same data gives the same three | work items, criteria, engine | New (the engine merges existing rules) |
| B6 Clickable detail | Every card, bar and action opens the detail drawer | n/a | New |

### C. Operational monitoring (mostly existing; this panel gathers it)
| KPI | Exact definition | Source | Status |
|---|---|---|---|
| C1 Application health | Counts: registered, healthy (verified), requiring attention, active incidents, reachable-only | `GET /summary` | Exists |
| C2 Deployment status | Among repositories with a confirmed type of application or service: counts by `deploy_state` (deployed, configured, failed, none, unknown) | `ai_repos.deploy_state` via `/repos` | Exists |
| C3 GitHub sync status | Configured yes or no; last sync ok or failed; finished time; complete (full list read) | `GET /sync/status` | Exists |
| C4 Last successful scans | Latest successful sync finish; latest repository scan (`scanned_at`); latest successful health check; latest daily-pass heartbeat; (later) latest discovery scan | `/sync/status`, `ai_repos`, `ai_checks`, `heartbeat.cjs` state | Exists, except discovery scan (New) |
| C5 Failed jobs and errors | Last sync errors; alerts with status failed or with a `last_error`; applications whose last check could not run (monitoring fault); (later) failed discovery runs | `/sync/status`, `GET /alerts`, `/applications` | Exists, discovery runs New |
| C6 Security risks and unresolved alerts | Credentials recorded as exposed or needing rotation; open incidents; alerts still pending or failed; pending migrations | `/inventory` summary, `/summary`, `GET /alerts` | Exists |
- If `GITHUB_TOKEN` is not set or the daily pass is off, these say so in words (existing behavior) and are **not** shown as healthy.

### D. Open-source intelligence
| KPI | Exact definition | Source | Status |
|---|---|---|---|
| D1 Latest discovery date | Finish time of the last **successful** discovery run | discovery run record | New |
| D2 New GitHub candidates | Candidates in state discovered created since the previous scan | Library records | New (Library exists) |
| D3 Evaluated, approved, adopted | Counts per state. **Evaluated** requires licence, maintenance, security note and effort filled **and** a source and date; otherwise the candidate stays discovered | Library records | New states; fields exist |
| D4 Licence and maintenance warnings | Candidates with licence class strong copyleft, source available or unknown; maintenance stale or unknown; adopted components whose facts are older than a set number of days | `ai_oss_projects.license_class`, `maintenance`, `verified_at` | Fields exist; list New |
| D5 Existing application matches | Candidates linked to a repository they could improve (a real reference, not a typed name) | Library link records | New |

### E. Business intelligence
| KPI | Exact definition | Source | Status |
|---|---|---|---|
| E1 Opportunities discovered | Portfolio items of type opportunity | `ai_portfolio_items` | Exists |
| E2 Existing assets matched | Opportunities with a completed asset check **and** one of the six classifications; each checked source shows checked (date) or unavailable | opportunity extension records | New |
| E3 Opportunities validated | Opportunities with all eight criteria answered; the tile also shows how many criteria are **verified** (source and date) versus assumed | opportunity extension records | New |
| E4 Commercialization candidates | Classification 1 (already built) or 2 (partially built) | opportunity extension records | New |
| E5 Customer validation status | Entries of kind customer validation, newest first, by opportunity | business entries (owner-entered) | New |
| E6 Actual revenue | Sum of owner-entered revenue entries with amount and date; **never projected**; no payment or bank data is ever stored | business entries | New; "unavailable" until a real entry exists |

### F. Repository intelligence and Personal Intelligence
| KPI | Exact definition | Source | Status |
|---|---|---|---|
| F1 Total repositories | Rows read from GitHub | `ai_repos` | Exists |
| F2 Confirmed type | Repositories with an owner-confirmed type | `ai_repos.kind` | Exists |
| F3 Description missing or vague | GitHub description empty, one word, or equal to the name | `ai_repos.gh_description` | Field exists; rule New |
| F4 **Discovered** (metadata) | Repositories read by the sync | `ai_repos` | Exists |
| F5 **Capability-verified** (source read) | Repositories whose features were verified by reading the source, each feature with file path, date and reader. **Kept separate from F4** (owner decision A5): being listed never counts as verified | repository intelligence records | New |
| F6 Deployed and healthy | Confirmed applications by deploy state, and health only where linked to a monitored application | `/repos`, `/summary` | Exists |
| F7 Unfinished work | Recorded unfinished items; plus Invest repositories with no push in 60+ days (existing rule) | new records, `attention.cjs` | Rule exists; records New |
| P1 Hub figures (imports, conversations, messages, findings, commitments) | n/a in the deployed console | local Hub database | **Always "Unavailable" in the deployed Overview** until a secure, approved counts-only integration exists (decision D1). Never zero, never estimated |

## 6. Records the dashboard needs (design only; **no table is created by this document**)
Per decision D2 these reuse the **existing PostgreSQL database**, created additively with the same `CREATE TABLE IF NOT EXISTS` and advisory-lock pattern, **only after** the Railway backup check is complete and a schema review has been approved.

| Record | Key fields (proposal) |
|---|---|
| Objective | Fixed six, held in code from the charter (no table) |
| Acceptance criterion | id, objective, text, state (eight states), evidence note or link, evidence date, confirmed by |
| Epic | id, objective, title |
| Sprint | id, name, goal, start, end, closed flag |
| Work item | id, kind (story or task), epic, sprint, title, state, owner, blocker note, linked PR |
| Work item link | from, to, type (blocked_by, depends_on) |
| State history | item or criterion, from, to, evidence, date. **Trends are computed from this**; it also proves nothing changed silently |
| Business entry | id, kind (customer validation, experiment, sale, revenue), opportunity, date, text, amount (revenue only), source |
| Repository intelligence | extra owner-confirmed, evidence-backed fields on repositories (features with source, run note, depends on, unfinished, commercial note), with discovery and capability verification stored separately |
| Opportunity extension | classification (six), eight criteria each with evidence level and date |

## 7. Click-through behavior
Every figure links to the records behind it. Filters travel in the URL so a view can be bookmarked.

| Element | Click goes to | Notes |
|---|---|---|
| Overall bar or an objective bar | Detail drawer: that objective's criteria with state, evidence, date; a segment click filters to that state | **[New]** |
| Epic or sprint progress bar | The board filtered to that epic or sprint | |
| Kanban card or next action | Detail drawer: description, objective, state history, evidence, dependencies, linked PR; actions: change state (needs evidence and date), add blocker | |
| Blocker or dependency | The blocking item | |
| Application health, incidents, healthy, attention | Applications or System Health with the existing status filter | **[Exists]** |
| Deployment status counts | Applications filtered by deploy state | Filter **[New]**; page exists |
| GitHub sync, last scans, failed jobs | Settings or the sync detail; error text shown in words | Exists |
| Security risk, credential, alert | Secrets and Subscriptions or the alert list | Exists |
| Repository counts (confirmed, described, verified) | Applications filtered by that condition | Filters New |
| Discovery date, candidate counts, warnings, matches | Open-source Library filtered by state, warning or linked repository | Page exists; filters New |
| Opportunities and business counts | Portfolio filtered by type and classification | Page exists; filters New |
| A KPI's source chip | The record list the figure was computed from | **[New]** |
| Hub tile | Explains why it is unavailable and what would enable it | |
| Filters (objective, sprint, project, status) | Re-scope every panel; a panel that does not support a filter says so ("not filtered by sprint") | |

## 8. Responsive design acceptance criteria
| # | Criterion | How verified |
|---|---|---|
| R1 | Layouts at 1440, 1024, 768, 390 and 320 px wide: three columns, then two, then one (reusing the existing breakpoints 1100, 860, 720 and 420 px) | Screenshots at each width, reviewed by the owner |
| R2 | No horizontal scrolling of the page at any width; the Kanban scrolls inside its own region on desktop, and shows **one state column at a time** with a selector below 860 px | Screenshots, automated width check |
| R3 | First mobile screen shows the overall bar, the sprint line and the next three actions | Screenshot |
| R4 | Tap targets are at least 44 px; every control works by keyboard; visible focus | Manual keyboard pass |
| R5 | Color is never the only signal: every status has text and an icon; consistent status colors across the page | Review against the status map |
| R6 | Text contrast meets WCAG 2.1 AA using the existing tokens; the two new shades are checked | Contrast calculation recorded |
| R7 | Each chart has a text alternative (a table or sentence with the same numbers) | Review |
| R8 | Reduced-motion setting is respected; no required animation | CSS check (existing rule kept) |
| R9 | A panel whose source fails shows its own error and the rest of the page still works | Test with each source failing |
| R10 | The page renders with every source empty, and with every source unavailable, without errors | Tests and screenshots |
| R11 | No browser console errors or warnings at any width | Headless browser run |
| R12 | Filters for objective, sprint, project and status work together, are reflected in the URL, and reset | Test |

## 9. Functional acceptance criteria (all must hold)
| # | Criterion | How verified |
|---|---|---|
| 1 | Every figure is traceable to a stored record or a count of records, via its source chip | A test lists each figure's source query; review |
| 2 | No hardcoded percentage, count or progress value exists in the code | A test scans the Overview code; owner review |
| 3 | Unavailable, none recorded and not verified are three visibly different states, and none shows a fabricated number | Tests with each state; screenshots |
| 4 | An objective's state can be derived from its criteria by the stated rule | Unit test of the rule with every state |
| 5 | A criterion or work item cannot become Accepted or Live without evidence and a date; every change is written to the state history | Validation test |
| 6 | Editing documentation changes no indicator | Test |
| 7 | The next three actions are reproducible, and each shows its rule and evidence | Test with fixtures |
| 8 | The sprint trend appears only with 2 or more closed sprints, computed from state history | Test |
| 9 | Existing Overview content works and all existing test files still pass | Existing 27 test files green |
| 10 | Every new route is behind the owner sign-in | Existing "401 without a token" test extended |
| 11 | No AI or paid service is called to build the page | Source scan, like the existing monitoring allow-list test |
| 12 | Hub tile shows **Unavailable** and no Hub number reaches the deployed console | Test that the aggregate route has no Hub query; review |
| 13 | **Capability-verified** counts only repositories with source-read evidence, never those only discovered | Test |
| 14 | A new dependency in `package.json` fails the build unless approved | CI check (see roadmap) |

## 10. Decisions this specification depends on
Approved: A1 to A9 (architecture) and D1 to D6 in [CAPABILITY_GAP_ASSESSMENT.md](CAPABILITY_GAP_ASSESSMENT.md). Still open for the build sprint: whether to add drag-and-drop to the board later (recommendation: no in v1) and the exact warning thresholds for stale licence or maintenance facts (proposal: owner sets them in Settings; defaults are documented, not hidden).
