// server/middleware/securityHeaders.cjs
//
// This app talks ONLY to itself (same origin, no third-party scripts, fonts, images or APIs), so the browser can be
// told to refuse everything else. That matters here because the sign-in token lives in sessionStorage: with
// connect-src 'self' an injected script could not send it to another site, and script-src 'self' stops injected
// inline/remote scripts running at all. style-src keeps 'unsafe-inline' because the React UI sets inline styles.
'use strict';

const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store', // API answers and the HTML shell are never cached; hashed assets override this below
  });
  next();
}
module.exports = { securityHeaders, CSP };
