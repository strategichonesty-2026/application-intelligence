// server/middleware/rateLimiter.cjs: small in-memory limiter, per client address (req.ip, which honours
// X-Forwarded-For only for the trusted proxy hops configured with app.set('trust proxy')).
'use strict';

function createLimiter({ windowMs = 60 * 1000, max = 120 } = {}) {
  const hits = new Map();
  const timer = setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k); }, windowMs); timer.unref();
  return (req, res, next) => {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now(); let rec = hits.get(key);
    if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + windowMs }; hits.set(key, rec); }
    rec.count += 1;
    if (rec.count > max) { res.set('Retry-After', String(Math.ceil((rec.resetAt - now) / 1000))); return res.status(429).json({ success: false, error: 'Too many requests. Slow down and try again shortly.' }); }
    return next();
  };
}
module.exports = { createLimiter };
