# Command Center Phase 1: acceptance review

Date: 21 November 2026. Scope: review only, plus fixes for what the review found. No new infrastructure; no other application touched.
Environment: a scratch database with made-up data and a fake GitHub (no real GitHub, no production data).

## Result
Accepted, with the limitations listed at the end. Two real defects were found and fixed; one layout problem was found and fixed.

## 1. Screens (desktop 1440 px and mobile 390 px)
Ten views were captured on each size: sign-in, Overview, Applications, repository detail, Portfolio, Open-source Library, System Health, Secrets & Subscriptions, Settings, and the Portfolio add and import dialogs.
- No browser console errors or warnings; no horizontal scrolling on any view.
- **Fixed:** the mobile bottom menu grew to seven items, so "Open-source Library" wrapped onto three lines and "Settings" was cut off. The bottom bar now uses short labels (Apps, Library, Health, Secrets); the full names stay as accessible labels.

## 2. GitHub sync (fake GitHub; repeated and changing)
Passed: first sync stores every repository the account owns and excludes other owners'; a repeat sync with nothing changed costs one request (the list answers "not modified"); a push rescans only that repository; a rename keeps one row; confirmed type and priority survive re-syncs; a rate-limit or bad-token failure reports a plain error and keeps the previous data; the next sync recovers; the token appears nowhere in the database or responses.
**Defects found and fixed:**
1. A repository archived on GitHub kept its old suggested type, because archiving does not change the last-push date that triggers a rescan. A mismatch between the archived flag and the stored suggestion now forces a rescan.
2. A repository deleted on GitHub stayed in the list with no warning. Each sync now records which repositories it saw (also for pages answered "not modified"); after a complete sync, an unseen repository is shown as "Not found on GitHub" (table, detail page and the attention list). It is never deleted automatically.
Not done: a sync against the real GitHub API from this environment (the token must stay on the server). The first real sync on the deployed console returned 20 repositories.

## 3. Classification and health
The suggestion rules were exercised by tests with fixtures (application, service, tool, content, archive, empty repository, missing permission). Health appears only for repositories linked to a monitored application; unlinked ones show "Not checked", and tools, content and archives show "Not applicable". Whether the suggested types are right for the real 20 repositories is the owner's confirmation step.

## 4. Lint
ESLint was run (the config needs packages that are not in package.json; they were installed temporarily and not saved).
- Fixed in new code: unused imports, two hook-dependency warnings, one display-name warning; one unused import in an existing page.
- Remaining (about 750, already present before this work): `react/prop-types` (the project does not use PropTypes), `react-hooks/set-state-in-effect` and `react-refresh/only-export-components` style rules, and four unescaped quotes in one existing component. None changes behaviour. Recommended: decide whether to turn off the prop-types rule rather than fix 738 instances.

## 5. Authentication, token handling, secrets, backup
- Every endpoint, including the new ones, answers 401 without the owner token (checked on the running server and by tests); a forged token is 401.
- Sign-in is limited: the sixth wrong attempt in a row is answered 429.
- The GitHub token is a server variable, used only on GET requests to the GitHub API host, and never stored, logged or returned (checked in the database dump, API responses and the server log). Errors never include it.
- Secret screening: portfolio and library text is checked; secret-looking values are refused and not echoed. Text read from GitHub is dropped if it looks like a secret.
- Library links must be http(s); other links are neither stored nor shown as links.
- **Backup: not verified.** This repository has no backup mechanism; it relies on the database host. The owner should confirm in Railway that backups exist for the console's database and test one restore. This is the main open item.

## 6. Remaining limitations
1. Database backup and restore not verified (see above).
2. Not run against the real GitHub API from the review environment; classification of the real repositories not yet confirmed by the owner.
3. About 750 pre-existing lint findings remain (style rules).
4. Portfolio and Library are empty until the owner fills them; nothing is looked up automatically.
5. Fine-grained tokens expire; a renewal reminder is the owner's job.
6. Screens were checked in headless Chrome only (desktop and a 390 px phone size), not on a real phone.
