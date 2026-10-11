# Application Intelligence: project notes

Separate monitoring/operations console (own server, DB, sign-in). Read README.md first, then docs/DEPLOYMENT.md.

- Never store, print, log, commit or return secret values. Tests use dummy values only. The Secrets & Subscriptions page holds metadata only.
- Monitoring is manual-first and must never call an AI or paid service. `APP_INTELLIGENCE_SCHEDULE=daily` is the only automatic mode and is off by default.
- Do not deploy, merge, rotate credentials, change production variables or create paid services without the owner's explicit approval.
- Run `npm test` (Node 20) after any change; database tests need `AI_TEST_DATABASE_URL` (a scratch database).
- Unknown stays unknown: never mark something verified, rotated or revoked unless that actually happened.
