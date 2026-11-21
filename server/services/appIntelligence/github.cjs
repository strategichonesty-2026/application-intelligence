// server/services/appIntelligence/github.cjs
//
// Thin READ-ONLY GitHub client (Command Center). Built on the platform's own `fetch`; no SDK is added because the
// whole surface is a handful of GET calls.
//
//   * GET only: the client has no way to send any other method, so it cannot change anything on GitHub.
//   * The token is read from the server environment (GITHUB_TOKEN) by the caller and passed in. It is sent only to the
//     configured API host, never returned, never logged, never included in an error.
//   * Conditional requests: callers pass the ETag they stored; a 304 answer costs no rate-limit quota.
//   * Pagination follows `Link: rel="next"` only when it points at the same API host (so the token cannot be sent elsewhere).
'use strict';

const API = 'https://api.github.com';

class GithubError extends Error {
  constructor(code, message, status) { super(message); this.name = 'GithubError'; this.code = code; this.status = status || null; }
}

function createClient({ token, fetchImpl = globalThis.fetch, baseUrl = API, timeoutMs = 15000 } = {}) {
  if (!token) throw new GithubError('not_configured', 'GITHUB_TOKEN is not set.');
  if (typeof fetchImpl !== 'function') throw new GithubError('not_configured', 'No fetch implementation is available.');
  const base = new URL(baseUrl);

  /** One GET. Returns { status, notModified, data, etag, next, remaining }. `accept` selects raw text when needed. */
  async function get(pathOrUrl, { etag, raw = false } = {}) {
    let url;
    try { url = new URL(pathOrUrl, base); } catch { throw new GithubError('bad_request', 'Invalid GitHub path.'); }
    if (url.origin !== base.origin) throw new GithubError('bad_request', 'Refusing to send the GitHub token to another host.');
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'application-intelligence',
    };
    if (etag) headers['If-None-Match'] = etag;
    let res;
    try { res = await fetchImpl(url.toString(), { method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (err) { throw new GithubError('network', `GitHub could not be reached (${err && err.name === 'TimeoutError' ? 'timed out' : 'network error'}).`); }
    const remainingHeader = res.headers.get('x-ratelimit-remaining');
    const remaining = remainingHeader === null || remainingHeader === '' ? NaN : Number(remainingHeader); // an absent header is unknown, not zero
    const out = { status: res.status, notModified: res.status === 304, data: null, etag: res.headers.get('etag') || null, next: null, remaining: Number.isFinite(remaining) ? remaining : null };
    if (res.status === 304) return out;
    if (res.status === 401) throw new GithubError('unauthorized', 'GitHub rejected the token (expired or revoked).', 401);
    if (res.status === 403 || res.status === 429) {
      const limited = remaining === 0 || res.status === 429 || /rate limit/i.test(await safeText(res));
      throw new GithubError(limited ? 'rate_limited' : 'forbidden', limited ? 'GitHub rate limit reached; try again later.' : 'The token does not have permission for this request.', res.status);
    }
    if (res.status === 404) throw new GithubError('not_found', 'Not found (or the token cannot see it).', 404);
    if (!res.ok) throw new GithubError('http_error', `GitHub answered ${res.status}.`, res.status);
    if (raw) out.data = await res.text();
    else { try { out.data = await res.json(); } catch { throw new GithubError('bad_response', 'GitHub sent a response that could not be read.', res.status); } }
    const link = res.headers.get('link') || '';
    const m = /<([^>]+)>;\s*rel="next"/.exec(link);
    if (m) { try { if (new URL(m[1]).origin === base.origin) out.next = m[1]; } catch { /* ignore a malformed link */ } }
    return out;
  }

  return { get };
}

async function safeText(res) { try { return (await res.text()).slice(0, 300); } catch { return ''; } }

module.exports = { createClient, GithubError, API };
