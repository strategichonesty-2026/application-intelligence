# Security design and remaining risks

**Design.** One origin; no CORS; no shared API key; owner sign-in only (scrypt N=2^16 r=8 p=2, 16+ character passphrase, at most two hashes at once, 8-hour HMAC-signed token, revocable by changing `APP_INTELLIGENCE_SESSION_VERSION`); fail closed (503) when sign-in is not configured; per-client sign-in throttle on `req.ip` with an explicit proxy-hop count (a spoofed `X-Forwarded-For` is ignored) and a global *slow-down* (never a lock-out); 4 kB sign-in and 32 kB API bodies; strict CSP (`default-src 'none'`, own-origin scripts and connections, no framing); the token is in `sessionStorage`; secret values are refused by the Secrets & Subscriptions API; monitoring stores operational metadata only (no response bodies) and refuses private-network targets (SSRF guard).

**Verified by tests** (`npm test`): the properties above, including a real-browser run with the enforced CSP (0 violations; every request to the app's own origin).

**Remaining risks.**
- The token is readable by a script that does run on the page. The CSP makes injection and exfiltration much harder (no inline scripts, `connect-src 'self'`), but is not a guarantee.
- One owner passphrase, no MFA; no per-session revocation (only a global version bump); no audit trail of successful sign-ins.
- `TRUST_PROXY_HOPS` is a deployment assumption (Railway: 1).
- The in-memory throttle and rate limit are per instance (single instance assumed).
- The database holds "which credentials are exposed and who depends on them": protect database access and backups accordingly.
- Not deployed or load-tested; staging checks are in `docs/DEPLOYMENT.md`.
