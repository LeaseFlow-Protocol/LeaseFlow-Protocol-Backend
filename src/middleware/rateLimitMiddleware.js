/**
 * Issue #131: API Rate Limiting & Cloudflare WAF Rule Configuration
 *
 * Implements Redis-backed token bucket rate limiting with:
 * - 10 auth attempts/min per IP (strict)
 * - 200 general API requests/min per tenant (authenticated)
 * - 100 general API requests/min per IP (anonymous)
 * - HTTP 429 with Retry-After header
 * - Differentiates authenticated vs anonymous traffic
 */

const crypto = require('crypto');

const LIMITS = {
  auth: { max: 10, windowMs: 60_000 },       // 10 auth attempts/min per IP
  authenticated: { max: 200, windowMs: 60_000 }, // 200 req/min per tenant
  anonymous: { max: 100, windowMs: 60_000},  // 100 req/min per IP
};

/**
 * Token bucket check via Redis.
 * Returns { allowed, remaining, resetTime }
 */
async function checkBucket(redisClient, key, max, windowMs) {
  const now = Date.now();
  const bucketKey = `rl:bucket:${key}`;

  const raw = await redisClient.hgetall(bucketKey);
  let tokens = parseFloat(raw?.tokens ?? max);
  const lastRefill = parseInt(raw?.last_refill ?? now, 10);

  // Refill proportionally to elapsed time
  const elapsed = now - lastRefill;
  tokens = Math.min(max, tokens + (elapsed / windowMs) * max);

  const allowed = tokens >= 1;
  if (allowed) tokens -= 1;

  await redisClient.hset(bucketKey, { tokens: tokens.toString(), last_refill: now.toString() });
  await redisClient.pexpire(bucketKey, windowMs * 2);

  const resetTime = now + Math.ceil(((1 - tokens) / max) * windowMs);
  return { allowed, remaining: Math.floor(tokens), resetTime };
}

function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    'unknown'
  );
}

function send429(res, result, message) {
  const retryAfter = Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000));
  res.set({
    'Retry-After': String(retryAfter),
    'X-RateLimit-Limit': String(result.max),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
  });
  return res.status(429).json({
    success: false,
    error: 'Too Many Requests',
    message,
    retryAfter,
  });
}

/**
 * Middleware for authentication endpoints (login, token refresh, etc.)
 * Strict: 10 attempts/min per IP.
 */
function authRateLimit() {
  return async (req, res, next) => {
    const redisClient = req.app.locals.redisService
      ? await req.app.locals.redisService.getWorkingClient().catch(() => null)
      : null;

    if (!redisClient) return next(); // fail open if Redis unavailable

    const ip = getClientIp(req);
    const { max, windowMs } = LIMITS.auth;
    const result = await checkBucket(redisClient, `auth:${ip}`, max, windowMs).catch(() => null);

    if (!result) return next();
    result.max = max;

    if (!result.allowed) {
      return send429(res, result, 'Too many authentication attempts. Please wait before retrying.');
    }

    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
    });
    next();
  };
}

/**
 * General API rate limit middleware.
 * Authenticated: 200 req/min per tenant (from JWT actor).
 * Anonymous: 100 req/min per IP.
 */
function apiRateLimit() {
  return async (req, res, next) => {
    const redisClient = req.app.locals.redisService
      ? await req.app.locals.redisService.getWorkingClient().catch(() => null)
      : null;

    if (!redisClient) return next();

    const isAuthenticated = !!req.actor;
    const tenantId = req.actor?.id || req.actor?.pubkey;
    const ip = getClientIp(req);

    let bucketKey, max, windowMs;

    if (isAuthenticated && tenantId) {
      ({ max, windowMs } = LIMITS.authenticated);
      bucketKey = `api:tenant:${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 16)}`;
    } else {
      ({ max, windowMs } = LIMITS.anonymous);
      bucketKey = `api:anon:${ip}`;
    }

    const result = await checkBucket(redisClient, bucketKey, max, windowMs).catch(() => null);
    if (!result) return next();
    result.max = max;

    if (!result.allowed) {
      return send429(res, result, 'Rate limit exceeded. Please slow down your requests.');
    }

    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
    });
    next();
  };
}

module.exports = { authRateLimit, apiRateLimit };
