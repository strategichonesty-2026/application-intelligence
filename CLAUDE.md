# Application Intelligence: project notes

Separate monitoring/operations console (own server, DB, sign-in). Read README.md first, then docs/DEPLOYMENT.md.

- Never store, print, log, commit or return secret values. Tests use dummy values only. The Secrets & Subscriptions page holds metadata only.
- Monitoring is manual-first and must never call an AI or paid service. `APP_INTELLIGENCE_SCHEDULE=daily` is the only automatic mode and is off by default.
- Do not deploy, merge, rotate credentials, change production variables or create paid services without the owner's explicit approval.
- Run `npm test` (Node 20) after any change; database tests need `AI_TEST_DATABASE_URL` (a scratch database).
- Unknown stays unknown: never mark something verified, rotated or revoked unless that actually happened.
- Command Center (docs/COMMAND_CENTER.md): GitHub access is read-only (GET only, token from the `GITHUB_TOKEN` server variable, never asked for in chat). Portfolio and Open-source Library start empty; never pre-load them with unverified claims. "Verified" needs a source/evidence AND a date.
- The daily GitHub sync only runs inside the daily pass (`APP_INTELLIGENCE_SCHEDULE=daily` plus a token); it must never block or fail the health pass.
