/**
 * Tests for Issue #131: API Rate Limiting & Cloudflare WAF Rule Configuration
 */

const { authRateLimit, apiRateLimit } = require('../src/middleware/rateLimitMiddleware');

// Mock Redis client
function makeMockRedis(initialTokens = null) {
  const store = {};
  return {
    hgetall: jest.fn(async (key) => store[key] || null),
    hset: jest.fn(async (key, data) => { store[key] = { ...store[key], ...data }; }),
    pexpire: jest.fn(async () => {}),
    _store: store,
    _setTokens: (key, tokens, lastRefill) => {
      store[`rl:bucket:${key}`] = { tokens: String(tokens), last_refill: String(lastRefill || Date.now()) };
    },
  };
}

function makeReq(overrides = {}) {
  return {
    headers: { 'user-agent': 'test-agent', ...overrides.headers },
    ip: '127.0.0.1',
    actor: overrides.actor || null,
    app: { locals: { redisService: overrides.redisService || null } },
    ...overrides,
  };
}

function makeRes() {
  const headers = {};
  const res = {
    _status: null,
    _body: null,
    headers,
    set: jest.fn((h) => Object.assign(headers, h)),
    status: jest.fn(function (code) { this._status = code; return this; }),
    json: jest.fn(function (body) { this._body = body; return this; }),
  };
  return res;
}

describe('Issue #131: Rate Limiting Middleware', () => {
  describe('authRateLimit()', () => {
    it('allows requests within the 10/min auth limit', async () => {
      const mockRedis = makeMockRedis();
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({ redisService });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      const middleware = authRateLimit();
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(429);
    });

    it('returns 429 when auth limit (10/min) is exceeded', async () => {
      const mockRedis = makeMockRedis();
      // Simulate bucket exhausted (0 tokens)
      mockRedis._setTokens('auth:127.0.0.1', 0, Date.now());
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({ redisService });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      const middleware = authRateLimit();
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res._body.error).toBe('Too Many Requests');
      expect(res._body).toHaveProperty('retryAfter');
      expect(next).not.toHaveBeenCalled();
    });

    it('includes Retry-After header in 429 response', async () => {
      const mockRedis = makeMockRedis();
      mockRedis._setTokens('auth:127.0.0.1', 0, Date.now());
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({ redisService });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      await authRateLimit()(req, res, next);

      expect(res.headers['Retry-After']).toBeDefined();
      expect(parseInt(res.headers['Retry-After'])).toBeGreaterThan(0);
    });

    it('fails open when Redis is unavailable', async () => {
      const redisService = { getWorkingClient: jest.fn(async () => { throw new Error('Redis down'); }) };
      const req = makeReq({ redisService });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      await authRateLimit()(req, res, next);

      expect(next).toHaveBeenCalled(); // fail open
    });
  });

  describe('apiRateLimit()', () => {
    it('allows authenticated tenant up to 200 req/min', async () => {
      const mockRedis = makeMockRedis();
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({
        redisService,
        actor: { id: 'tenant-123', pubkey: 'GABC123' },
      });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      await apiRateLimit()(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe('200');
    });

    it('applies 100 req/min limit for anonymous traffic', async () => {
      const mockRedis = makeMockRedis();
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({ redisService }); // no actor = anonymous
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      await apiRateLimit()(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe('100');
    });

    it('differentiates between authenticated and anonymous buckets', async () => {
      const mockRedis = makeMockRedis();
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };

      // Exhaust anonymous bucket
      mockRedis._setTokens('api:anon:127.0.0.1', 0, Date.now());

      const anonReq = makeReq({ redisService });
      anonReq.app.locals.redisService = redisService;
      const anonRes = makeRes();
      const anonNext = jest.fn();
      await apiRateLimit()(anonReq, anonRes, anonNext);
      expect(anonRes._status).toBe(429);

      // Authenticated tenant should still be allowed (different bucket)
      const authReq = makeReq({ redisService, actor: { id: 'tenant-456' } });
      authReq.app.locals.redisService = redisService;
      const authRes = makeRes();
      const authNext = jest.fn();
      await apiRateLimit()(authReq, authRes, authNext);
      expect(authNext).toHaveBeenCalled();
    });

    it('returns 429 with structured error body when limit exceeded', async () => {
      const mockRedis = makeMockRedis();
      mockRedis._setTokens('api:anon:127.0.0.1', 0, Date.now());
      const redisService = { getWorkingClient: jest.fn(async () => mockRedis) };
      const req = makeReq({ redisService });
      req.app.locals.redisService = redisService;
      const res = makeRes();
      const next = jest.fn();

      await apiRateLimit()(req, res, next);

      expect(res._status).toBe(429);
      expect(res._body).toMatchObject({
        success: false,
        error: 'Too Many Requests',
        retryAfter: expect.any(Number),
      });
    });
  });
});
