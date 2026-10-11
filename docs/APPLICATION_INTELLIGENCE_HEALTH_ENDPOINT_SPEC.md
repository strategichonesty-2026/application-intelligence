> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Minimal health endpoint for monitored applications

Goal: let Application Intelligence verify **operational** health without receiving any private data.
Use this for PFOS (sensitive: financial data), ProblemSignal, and any application with no usable health route.

## Contract

`GET /api/health` (or `/healthz`): **public, unauthenticated, read-only**.

```json
{ "status": "ok", "checks": { "database": "ok" }, "build": "a1b2c3d", "time": "2026-10-11T12:00:00Z" }
```

| Rule | Why |
|---|---|
| `status` is exactly `"ok"`, `"degraded"` or `"down"`. HTTP **200** for ok/degraded, **503** for down. | Recognised by the monitor; 503 is a credible failure. |
| `checks` contains **fixed names** (`database`, `cache`…) each valued `"ok"` or `"down"`. Nothing else. | Lets a human see *what* is verified (the monitor records only field *names*). |
| **Never** include: transactions, balances, account numbers, documents, record counts, user ids/emails, session or token values, hostnames, connection strings, stack traces, error messages. | PFOS isolation. The monitor flags and discards any JSON with private-looking field names (`balance`, `account…`, `token`, `email`…). |
| Database check = `SELECT 1` (or the platform's ping) with a ≤2 s timeout. **Do not read application tables.** | Proves connectivity without touching data. |
| Exclude only this path from the sign-in middleware. Set `Cache-Control: no-store`. No cookies. Cheap, no side effects, no outbound calls except the dependency pings. | Safe to poll every minute. |
| On any internal error return `{"status":"down"}` with 503. No details. | No information leakage. |

## Reference sketch (framework-neutral)

```js
async function health(_req, res) {
  const checks = { database: 'down' };
  try { await withTimeout(db.query('SELECT 1'), 2000); checks.database = 'ok'; } catch { /* leave as down */ }
  const status = Object.values(checks).every((v) => v === 'ok') ? 'ok' : 'down';
  res.set('Cache-Control', 'no-store').status(status === 'ok' ? 200 : 503)
     .json({ status, checks, build: process.env.COMMIT_SHA || 'unknown', time: new Date().toISOString() });
}
```
Only if PFOS is a Next.js App Router app (**not confirmed**), the same logic goes in `app/api/health/route.ts` returning `NextResponse.json(...)`, and the path must be allowed through any auth middleware matcher.

## How the owner can verify it is safe before we monitor it
`node server/scripts/validateIntegrations.cjs --only pfos --discover-health --report pfos.md`. A safe endpoint shows `candidate`, "inferred: reports dependency checks", and field names like `status, checks, build, time`. If it prints **UNSAFE**, do not monitor that path.

## Existing Media Studio API
`GET /health` currently returns a static `{"status":"ok"}`. It proves the process is up, **not** that Postgres is reachable. Add the same `database` check (and keep it unauthenticated) so monitoring can verify the database, not just the process.
