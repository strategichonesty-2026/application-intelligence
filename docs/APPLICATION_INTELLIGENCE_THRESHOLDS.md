> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

> **Update:** with manual/daily checks the old "3 failures to open / 2 passes to close / stale after 3 intervals" rules (designed for a check every few minutes) were replaced: an incident opens on **one confirmed failure** (failures are retried once immediately), closes on **one pass**, degraded never opens one, a daily application is stale after 36 h and manual applications are never stale. See `APPLICATION_INTELLIGENCE_MANUAL_MONITORING.md`. The table below is the original proposal and is kept for history.

# Monitoring thresholds: status and proposals for your approval

**Principle:** no threshold decides an application's status unless it is agreed. The one latency threshold that existed (a default 2000 ms slow-response limit, and a 3000 ms limit in the validation script) was an arbitrary choice and has been **removed**: the default is now "no limit".

## Currently in force (provisional; each is a safety or noise-control choice, not a measured performance standard)

| Setting | Value | Purpose | Approve / change? |
|---|---|---|---|
| Failures to call it **Unavailable** / open an incident | 3 consecutive credible failures | Avoid alerting on one blip | **Needs your approval** |
| Passes to close an incident | 2 consecutive | Avoid flapping | **Needs your approval** |
| Check interval (default) | 5 min | Cost/noise balance; detection ≈ 10–15 min | **Needs your approval** (per-app) |
| Request timeout | 8 s (1–30 s per app) | A request must end | Needs your approval |
| Retry | 1 retry after 2 s, **network-level failures only** | Ride out a dropped packet | Needs your approval |
| "Stale" | no check for 3 intervals (min 2 min) | Do not show old results as current | Needs your approval |
| "Monitoring stalled" | no completed cycle for 3 min | Detect a stopped monitor | Needs your approval |
| Manual-check cooldown / test-email cooldown | 10 s / 30 s | Abuse limiting | Low stakes |

## Proposed: response-time limits (NOT enabled)

Do not pick a number first; measure first.
1. Run `measureLatency.cjs` per application (≥6 samples, at different times) and let the scheduler collect ~7 days of checks.
2. Propose a per-application limit **from that application's own baseline**, for example "slower than 3× its observed 95th-percentile for 3 checks in a row" with a floor you consider acceptable to a user (for example 2 s for an interactive page).
3. Only after you approve the number for an application is it entered in that application's "Slow-response limit" (blank by default). Until then slow answers are *recorded and charted* but never change status.
4. Travel Intelligence Agent (one 5467 ms sample, VERIFIED) is the first candidate; do **not** set a limit until its repeated timings are in.

## Decisions requested
(a) Approve or change the provisional values above. (b) Choose the process for response-time limits (baseline-then-approve, as proposed).
