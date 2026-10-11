> **History note:** written while this console still lived inside the Media Studio repository. File paths, "Media Studio sign-in" and shared-key statements describe that setting. This repository is now a separate app: see README.md and docs/DEPLOYMENT.md for what is current.

# Local runbook: running the read-only validation commands on your own computer

All commands below are **read-only**: plain unauthenticated `GET` requests, no login, no cookies, no writes to any application, no response bodies printed or stored. They never change your system. Commands are for macOS/zsh; adapt paths if you cloned elsewhere.

## 0. Why two commands "were missing" (VERIFIED)
Your clone (`/Users/gopushrestha/ai-validate`) was made at about 02:26 UTC. The two scripts were added to the branch **after** that:

| Script | First commit on `claude/funny-johnson-xw51bq` | Time (UTC, 2026-10-11) |
|---|---|---|
| `server/scripts/measureLatency.cjs` | `3c5f99a` | 02:39 |
| `server/scripts/checkBundleKeyExposure.cjs` | `ad787cc` | 02:55 |

Both files exist at `server/scripts/` on the remote branch (checked with `git cat-file` against `origin/claude/funny-johnson-xw51bq`); nothing is at another path and nothing was left uncommitted. Your old checkout simply didn't have them yet. (They are not on `main`, which is expected: the work has not been merged.)

## 1. Update your clone and check it (always do this first)
```bash
cd /Users/gopushrestha/ai-validate           # the repository root: all commands below run from here
git pull origin claude/funny-johnson-xw51bq   # brings in the newer scripts
git log -1 --oneline                          # should show a commit at or after ad787cc
node server/scripts/aiDoctor.cjs              # read-only self-check
```
`aiDoctor` prints PASS/FAIL for: Node version, branch, commit, whether every required script file exists (and, if not, the exact `git pull` to run), and whether this machine has working internet. Fix any `FAIL` before continuing.

**These commands fail clearly instead of misbehaving.** Run from any other directory, they stop with exit code 3 and say `WRONG DIRECTORY`, name the repository root and the `cd` command to use (tested, including from an unrelated project). A missing script shows Node's own `Cannot find module`: that always means "pull the branch" (step 1). `INVALID RUN` (exit 2) means that machine has no internet access; no results are produced rather than misleading ones.

**No `npm install` is needed** for `validateIntegrations`, `measureLatency`, `checkBundleKeyExposure` and `aiDoctor`. They use only Node's built-in modules and the repository's own files (tested from a copy with no `node_modules`). `npm install` is only needed for the app, its servers and the full test suite.

## 2. Node.js
- Project requirement: **Node 20 or newer** (`nixpacks.toml` builds with Node 20; some dependencies declare `node >= 20`).
- You have Node 18.20.8. **The four commands above run correctly on 18.20.8** (VERIFIED: their tests were run on the real Node 18.20.8 here and passed), and print a one-line notice instead of failing. For anything else (running the server, the full test suite, `npm install` without `EBADENGINE` warnings) use Node 20.
- Use Node 20 **without changing your system installation**. Pick one; each affects only the terminal you run it in:
  - **nvm** (per-user, no admin rights): install from <https://github.com/nvm-sh/nvm>, open a new terminal, then `nvm install 20 && nvm use 20 && node -v`. `nvm use system` or a new terminal returns to your system Node.
  - **Homebrew, this shell only:** `brew install node@20` (adds a separate keg and does not replace your Node), then `export PATH="$(brew --prefix node@20)/bin:$PATH"; node -v`.
  - **fnm / Volta** work the same way if you already use them.
- I do not install or upgrade anything on your machine, and the scripts never do.

## 3. Commands (run from the repository root)
```bash
# A. Reachability for all eight applications + look for health endpoints (about 8 + up to 35 GETs)
node server/scripts/validateIntegrations.cjs --discover-health --json out.json --report report.md

# B. ProblemSignal only (registered path AND the site root "/", then candidate health paths)
node server/scripts/validateIntegrations.cjs --only problemsignal --discover-health --json ps.json --report ps.md

# C. Travel Intelligence Agent latency: see section 4

# D. Is the shared API key public in the Media Studio JavaScript? See section 5
node server/scripts/checkBundleKeyExposure.cjs --prompt https://media.strategichonesty.com/
```
`--only` matches a case-insensitive part of the name; a name that matches nothing fails loudly (it lists the valid names). Do **not** add `--include-unconfirmed` until application #7 has been identified.

**Sharing results:** paste the contents of `report.md` / `ps.md` (small Markdown tables) and the console output of C and D. They contain only names, URLs, UTC times, result words, status codes, timings, redirect counts and the redirect host (plus, for 4xx answers, a few allow-listed response *header* names such as `server` or `x-powered-by`). No bodies, cookies, tokens or keys.

## 4. Travel Intelligence Agent: six measurements, then again after ~15 minutes idle
```bash
# Run 1: six requests, 20 seconds apart (about 2 minutes)
node server/scripts/measureLatency.cjs https://travel-intelligence-agent-production.up.railway.app/ --count 6 --interval 20000 --json travel-1.json

# Leave the application untouched for at least 15 minutes (20 is safer). Do not open it, and do not run other checks against it.

# Run 2: the same again
node server/scripts/measureLatency.cjs https://travel-intelligence-agent-production.up.railway.app/ --count 6 --interval 20000 --json travel-2.json
```
Optional single command that does all three steps (keeps your Mac awake; leave the terminal open ~25 minutes):
```bash
caffeinate -i sh -c 'node server/scripts/measureLatency.cjs https://travel-intelligence-agent-production.up.railway.app/ --count 6 --interval 20000 --json travel-1.json; sleep 1200; node server/scripts/measureLatency.cjs https://travel-intelligence-agent-production.up.railway.app/ --count 6 --interval 20000 --json travel-2.json'
```
What it reports for **every request**: `status`, `total` time to the response headers, and the split from Node's socket events: **`dns`** (name lookup), **`connect`** (TCP), **`tls`** (secure handshake) and **`wait(server)`** (from request sent to first byte, i.e. the time the server takes). Each request opens a new connection, so connect and tls are paid every time; `dns` can read 0–2 ms after the first sample because your operating system caches lookups. The summary adds min / median / max / spread and compares the first sample with the median of the rest.

How to read it, **without assuming a cause**:
- It measures your connection to the application, including your own network. A large `wait(server)` with small dns/connect/tls means the server was slow to answer; large dns/connect/tls means the network path was slow.
- Comparing run 1 with run 2 shows *whether the first request after idle is slower than later ones*. It does **not** show why. A cold start, a sleeping instance, a slow database, a cold cache or network routing would all look similar; naming a cause needs the platform's own logs/metrics (for example Railway's deploy/instance logs for that service).
- "Idle" cannot be guaranteed from here: scheduled jobs inside the application or other monitors may be hitting it. I make no assumption either way.
- Please paste both console outputs. **I will record the numbers exactly as measured and have no real Travel results yet.**

## 5. Browser-key exposure check (safe use)
What it does: downloads the site's page and its **same-origin JavaScript files exactly as an anonymous visitor could** (plain GET, no cookies), and checks whether your server's key appears in them. It prints only **YES/no per file**, whether the files mention the `x-api-key` header name, and whether an anonymous request is redirected to Cloudflare Access. **It never prints, logs or writes the key or any part of it.**

**Recommended way: a hidden prompt (nothing in shell history, nothing in the process list):**
```bash
node server/scripts/checkBundleKeyExposure.cjs --prompt https://media.strategichonesty.com/
```
It asks for the server key (typing is hidden), then for an optional previous key (Enter to skip). Where to find the key: in your Railway service variables for `API_SECRET_KEY`, copied straight into the prompt.

**Rules the script enforces:** a key given as a command-line argument (`--key …`, `--api-key=…`) is **refused**, because arguments are saved in shell history and visible to other processes. `--prompt` needs an interactive terminal and says so if it has none.

**Alternative (environment variable), if you prefer:**
```bash
read -rs "API_SECRET_KEY?Server key (hidden): "; export API_SECRET_KEY; echo
node server/scripts/checkBundleKeyExposure.cjs https://media.strategichonesty.com/
unset API_SECRET_KEY
```
`read -rs` does not echo or store what you type. Do not write `API_SECRET_KEY=abc node …` on one line (that is saved in history).

**Reading the result.**
- **`contains key: YES`** establishes: the exact value you supplied is present in a JavaScript file that **anyone** can download without logging in, so anyone can read it. If you supplied the *current* production key, it is exposed.
- A YES does **not** establish: that anyone has actually used or copied it; that any abuse occurred; that other secrets are or aren't exposed; or what the key can do (see `docs/APPLICATION_INTELLIGENCE_SECURITY_GATE.md` §1.2). Any follow-up (for example rotating the key) is a production change that needs your approval.
- **`contains key: no`** establishes only: the value was not found in the files this tool could download. It does **not** prove the key is safe: the key might sit in a file the script didn't discover (it follows `<script>` tags and chunk references on the same origin, up to 40 files), be split or encoded so a plain comparison misses it, live on another domain/CDN, differ from what you typed (a typo, or an old key), or be delivered at run time rather than in a file.
- **`Cloudflare Access: NOT detected`** means an anonymous request was answered directly, with no redirect to a `*.cloudflareaccess.com` login. It does not rule out a policy that exempts the page, and it says nothing about the Railway API address.
- The output is safe to paste into chat: it contains no key material. (Your typed key lives only in this process's memory for a few seconds.)

## 6. ProblemSignal: what its repository says (VERIFIED from `strategichonesty-2026/Problem-Signal`, default branch `main`, commit `5f5d766`, 2026-08-30; read-only clone)
**Linking this repository to the Railway service `problemsignal-production.up.railway.app` is INFERRED from the name; I have not confirmed they are the same deployment.**

| Question | Answer from the code |
|---|---|
| What is it? | A Next.js 15 (App Router) app with Prisma/Postgres, Redis/BullMQ background workers, Better Auth sign-in. |
| Is `/dashboard` a real public path? | The route exists (`src/app/(app)/dashboard/page.tsx`; the `(app)` folder is a route group and is **not** part of the URL), but it sits behind `requireSession()`. An **unauthenticated visitor should be redirected (HTTP 307) to `/sign-in`**, not receive a 404. `/` redirects to `/dashboard` or `/sign-in`. |
| Public pages | `/sign-in`, `/sign-up`. Everything else requires a session. `docs/API_SPEC.md`: all routes except `/api/auth/*` require a session. |
| Existing health endpoint | **None.** No `/api/health`, no health route anywhere; `railway.toml` sets no `healthcheckPath`. (`docker-compose.yml` has health checks only for local Postgres/Redis.) |
| Deploy command | `npx prisma migrate deploy && npm run db:seed && npm run jobs:schedule && npm run start:all` (web + worker), restart on failure up to 3 times. |

**So the live `404` on `/dashboard` does not match what this code would do** (a 307 to `/sign-in`). It is *evidence of a mismatch, not of an outage and not of health*. Possible explanations, none established: the live deployment is a different/older build without that route; the service at that hostname is not this app; or the platform's edge answered 404 because nothing is currently serving the domain (for example the start command failed all 3 retries). The 174 ms answer time fits any of them. To discriminate safely, command **B** now also records a few allow-listed **response header names** for 4xx answers (for example `server`, `x-powered-by`, `x-railway-fallback`): a Next.js app's own 404 normally carries `x-powered-by: Next.js`, while a platform fallback may carry a platform header instead. **That reading is INFERRED**; I will report the headers as observed and will not treat the 404 as proof of either state.

**Correct public path to register today:** the privacy-safe choices are `/sign-in` (should answer 200; a login page = **Reachable**, never Healthy) or `/` (a redirect). Do not register `/dashboard` as a reachability target (it is session-gated by design). Run command B and use whichever of `/` or `/sign-in` the output shows answering sensibly.

**Recommended minimal health endpoint (a change in the ProblemSignal repo, which I have not touched and will not without your instruction):** add `src/app/api/health/route.ts` as specified in `docs/APPLICATION_INTELLIGENCE_HEALTH_ENDPOINT_SPEC.md`; it must not call `requireSession()`. **DRAFT: not compiled or run, and the ProblemSignal repository was not modified.** Written against the repo's own helpers (`prisma` from `@/lib/prisma`, the shared IORedis `connection` from `@/lib/jobs/queues`):
```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { connection } from "@/lib/jobs/queues";

export const dynamic = "force-dynamic";
const withTimeout = <T,>(p: Promise<T>, ms = 2000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

export async function GET() {
  const checks = { database: "down", redis: "down" } as Record<string, string>;
  try { await withTimeout(prisma.$queryRaw`SELECT 1`); checks.database = "ok"; } catch {}
  try { await withTimeout(connection.ping()); checks.redis = "ok"; } catch {}
  const ok = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ status: ok ? "ok" : "down", checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
```
It reads no tables, returns no data, no counts, no user information and no error text. Optionally add `healthcheckPath = "/api/health"` to `railway.toml`. Note it covers the web process's database and Redis only; it does not prove the background worker is running.
*Unrelated observation to verify yourself (not tested): that app has a `/sign-up` page and "the first account becomes ADMIN, later accounts are MEMBER". If registration is open on the public instance, confirm that is intended; a MEMBER can read everything except job control (`docs/SECURITY.md`).*

## 7. Troubleshooting
| You see | Meaning | Do this |
|---|---|---|
| `Cannot find module '…/server/scripts/<name>.cjs'` | Old checkout | `git pull origin claude/funny-johnson-xw51bq`, then `node server/scripts/aiDoctor.cjs` |
| `WRONG DIRECTORY` (exit 3) | Not in the repository root | `cd` to the path it prints |
| `INVALID RUN … no direct outbound internet access` (exit 2) | Control probe failed on this machine | Use another network/machine; no results are produced on purpose |
| `Note: Node 18.20.8 detected…` | Informational | Nothing required for these commands; use Node 20 for everything else (section 2) |
| `EBADENGINE` warnings from `npm install` | Dependencies want Node ≥ 20 | Use Node 20 for installs; irrelevant to these four commands |
| `REFUSED: never put a key on the command line` | You passed `--key …` | Use `--prompt` |


> **Travel is now manual-only.** `measureLatency.cjs` refuses Travel URLs unless you add `--allow-manual-only` (keep `--count` small and prefer `/health`), and `validateIntegrations.cjs` skips it unless you pass `--include-manual-only` (which requests only `/health`). The commands above that time Travel's homepage are deliberate owner-run diagnostics and need that flag.
