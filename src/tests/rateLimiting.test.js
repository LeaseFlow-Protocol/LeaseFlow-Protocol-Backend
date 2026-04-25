const { RateLimitingService } = require('../services/rateLimitingService');
const { RedisService } = require('../services/redisService');

describe('Rate Limiting Service (Issue #104)', () => {
  let rateLimitingService;
  let redisService;
  let mockRedisClient;

  beforeAll(async () => {
    // Mock Redis service
    mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      hset: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn().mockResolvedValue({}),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      mget: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1)
    };

    redisService = {
      getWorkingClient: jest.fn().mockResolvedValue(mockRedisClient)
    };

    rateLimitingService = new RateLimitingService(redisService);
    await rateLimitingService.initialize();
  });

  describe('Token Bucket Algorithm', () => {
    test('should allow requests when tokens are available', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '10',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.tokenBucket('test-key', 10, 10, 60000);
      
      expect(result.allowed).toBe(true);
      expect(result.tokens).toBeGreaterThanOrEqual(0);
    });

    test('should deny requests when no tokens are available', async () => {
      const pastTime = Date.now() - 120000; // 2 minutes ago
      
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '0',
        last_refill: pastTime.toString()
      });

      const result = await rateLimitingService.tokenBucket('test-key', 10, 10, 60000);
      
      expect(result.allowed).toBe(false);
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });

    test('should refill tokens over time', async () => {
      const pastTime = Date.now() - 30000; // 30 seconds ago
      
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '5',
        last_refill: pastTime.toString()
      });

      const result = await rateLimitingService.tokenBucket('test-key', 10, 10, 60000);
      
      // Should have some tokens refilled (half the window = 5 tokens)
      expect(result.tokens).toBeGreaterThan(5);
      expect(result.tokens).toBeLessThanOrEqual(10);
    });
  });

  describe('IoT Endpoint Rate Limiting', () => {
    test('should check IoT rate limits', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '60',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkIotRateLimit('192.168.1.100', 'sensor-1');
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(60);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    test('should throttle IoT requests when limit exceeded', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '0',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkIotRateLimit('192.168.1.100', 'sensor-1');
      
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    test('should log throttled IoT connections', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '0',
        last_refill: Date.now().toString()
      });

      await rateLimitingService.checkIotRateLimit('192.168.1.100', 'sensor-1');
      
      expect(mockRedisClient.hset).toHaveBeenCalledWith(
        expect.stringContaining('rate_limit:audit:'),
        expect.objectContaining({
          ipAddress: '192.168.1.100',
          endpoint: 'sensor-1',
          type: 'iot'
        })
      );
    });
  });

  describe('Webhook Endpoint Rate Limiting', () => {
    test('should check webhook rate limits', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '30',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkWebhookRateLimit('192.168.1.200', 'webhook-1');
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(30);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    test('should throttle webhook requests when limit exceeded', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '0',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkWebhookRateLimit('192.168.1.200', 'webhook-1');
      
      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('Global Rate Limiting', () => {
    test('should check global rate limits', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '10000',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10000);
    });

    test('should throttle when global limit exceeded', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '0',
        last_refill: Date.now().toString()
      });

      const result = await rateLimitingService.checkGlobalRateLimit();
      
      expect(result.allowed).toBe(false);
    });
  });

  describe('Express Middleware', () => {
    test('should create IoT rate limiting middleware', () => {
      const middleware = rateLimitingService.createIotRateLimitMiddleware('test-endpoint');
      expect(typeof middleware).toBe('function');
    });

    test('should create webhook rate limiting middleware', () => {
      const middleware = rateLimitingService.createWebhookRateLimitMiddleware('test-webhook');
      expect(typeof middleware).toBe('function');
    });

    test('should extract client IP correctly', () => {
      const mockReq = {
        ip: '192.168.1.100',
        connection: { remoteAddress: '192.168.1.100' },
        headers: { 'x-forwarded-for': '192.168.1.100' }
      };

      const ip = rateLimitingService.getClientIp(mockReq);
      expect(ip).toBe('192.168.1.100');
    });

    test('should handle missing IP address', () => {
      const mockReq = {
        ip: null,
        connection: { remoteAddress: null },
        headers: {}
      };

      const ip = rateLimitingService.getClientIp(mockReq);
      expect(ip).toBe('unknown');
    });
  });

  describe('Rate Limit Response', () => {
    test('should send proper 429 response', () => {
      const mockRes = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      const rateLimitResult = {
        limit: 60,
        remaining: 0,
        resetTime: Date.now() + 60000,
        retryAfter: 30
      };

      rateLimitingService.sendRateLimitResponse(mockRes, rateLimitResult, 'Test limit exceeded');

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.set).toHaveBeenCalledWith({
        'Retry-After': '30',
        'X-RateLimit-Limit': 60,
        'X-RateLimit-Remaining': 0,
        'X-RateLimit-Reset': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Too Many Requests',
        message: 'Test limit exceeded',
        retryAfter: 30,
        limit: 60,
        resetTime: expect.any(String)
      });
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should get rate limiting statistics', async () => {
      mockRedisClient.keys.mockResolvedValue([]);
      mockRedisClient.mget.mockResolvedValue([]);
      mockRedisClient.hgetall.mockResolvedValue({
        total_requests: '100',
        allowed_requests: '95',
        throttled_requests: '5'
      });

      const stats = await rateLimitingService.getStats();

      expect(stats.current).toBeDefined();
      expect(stats.cumulative).toBeDefined();
      expect(stats.recentThrottled).toBeInstanceOf(Array);
      expect(stats.config).toBeDefined();
    });

    test('should update metrics correctly', async () => {
      await rateLimitingService.updateMetrics();

      expect(mockRedisClient.hincrby).toHaveBeenCalledWith(
        expect.stringContaining('rate_limit:metrics:'),
        'total_requests',
        1
      );
    });
  });

  describe('Admin Functions', () => {
    test('should reset rate limit for IP', async () => {
      const result = await rateLimitingService.resetRateLimit('192.168.1.100', 'test-endpoint', 'iot');

      expect(result.success).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith('rate_limit:bucket:iot:192.168.1.100:test-endpoint');
    });

    test('should get rate limit status for IP', async () => {
      mockRedisClient.hgetall.mockResolvedValue({
        tokens: '45',
        last_refill: Date.now().toString()
      });

      const status = await rateLimitingService.getRateLimitStatus('192.168.1.100', 'test-endpoint', 'iot');

      expect(status.ipAddress).toBe('192.168.1.100');
      expect(status.endpoint).toBe('test-endpoint');
      expect(status.type).toBe('iot');
      expect(status.tokens).toBeGreaterThanOrEqual(0);
    });

    test('should handle non-existent rate limit status', async () => {
      mockRedisClient.hgetall.mockResolvedValue({});

      const status = await rateLimitingService.getRateLimitStatus('192.168.1.100', 'test-endpoint', 'iot');

      expect(status.status).toBe('no_limit');
      expect(status.tokens).toBe(60); // Default IoT limit
    });
  });

  describe('Cleanup Operations', () => {
    test('should cleanup old data', async () => {
      mockRedisClient.keys
        .mockResolvedValueOnce(['rate_limit:audit:1640995200000'])
        .mockResolvedValueOnce(['rate_limit:metrics:1640995200']);

      await rateLimitingService.cleanup();

      expect(mockRedisClient.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    test('should handle Redis connection errors gracefully', async () => {
      redisService.getWorkingClient.mockRejectedValue(new Error('Redis connection failed'));

      await expect(rateLimitingService.initialize()).rejects.toThrow('Rate limiting service initialization failed');
    });

    test('should handle middleware errors gracefully', async () => {
      const middleware = rateLimitingService.createIotRateLimitMiddleware('test-endpoint');
      const mockReq = { ip: '192.168.1.100' };
      const mockRes = {};
      const mockNext = jest.fn();

      // Mock Redis error
      mockRedisClient.hgetall.mockRejectedValue(new Error('Redis error'));

      await middleware(mockReq, mockRes, mockNext);

      // Should call next() (fail open)
      expect(mockNext).toHaveBeenCalled();
    });
  });
});

describe('Rate Limiting Integration Tests', () => {
  test('should handle high volume requests without crashing', async () => {
    const mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      hset: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn().mockResolvedValue({ tokens: '50', last_refill: Date.now().toString() }),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      mget: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1)
    };

    const redisService = {
      getWorkingClient: jest.fn().mockResolvedValue(mockRedisClient)
    };

    const rateLimitingService = new RateLimitingService(redisService);
    await rateLimitingService.initialize();

    // Simulate 1000 requests
    const promises = [];
    for (let i = 0; i < 1000; i++) {
      promises.push(rateLimitingService.checkIotRateLimit(`192.168.1.${i % 255}`, 'sensor-test'));
    }

    const results = await Promise.all(promises);

    // Should handle all requests without errors
    expect(results).toHaveLength(1000);
    results.forEach(result => {
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('limit');
      expect(result).toHaveProperty('remaining');
    });
  });

  test('should prevent connection flooding from single IP', async () => {
    const mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      hset: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn()
        .mockResolvedValueOnce({ tokens: '60', last_refill: Date.now().toString() })
        .mockResolvedValueOnce({ tokens: '59', last_refill: Date.now().toString() })
        .mockResolvedValueOnce({ tokens: '58', last_refill: Date.now().toString() })
        // Continue decreasing tokens
        .mockResolvedValue({ tokens: '0', last_refill: Date.now().toString() }),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      mget: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1)
    };

    const redisService = {
      getWorkingClient: jest.fn().mockResolvedValue(mockRedisClient)
    };

    const rateLimitingService = new RateLimitingService(redisService);
    await rateLimitingService.initialize();

    // Simulate 70 requests from same IP (exceeds 60 limit)
    const results = [];
    for (let i = 0; i < 70; i++) {
      const result = await rateLimitingService.checkIotRateLimit('192.168.1.100', 'sensor-test');
      results.push(result);
    }

    // Should have some throttled requests
    const throttledCount = results.filter(r => !r.allowed).length;
    expect(throttledCount).toBeGreaterThan(0);
  });

  test('should provide accurate Retry-After headers', async () => {
    const mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      hset: jest.fn().mockResolvedValue('OK'),
      hgetall: jest.fn().mockResolvedValue({
        tokens: '0',
        last_refill: (Date.now() - 30000).toString() // 30 seconds ago
      }),
      expire: jest.fn().mockResolvedValue(1),
      hincrby: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      mget: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(1)
    };

    const redisService = {
      getWorkingClient: jest.fn().mockResolvedValue(mockRedisClient)
    };

    const rateLimitingService = new RateLimitingService(redisService);
    await rateLimitingService.initialize();

    const result = await rateLimitingService.checkIotRateLimit('192.168.1.100', 'sensor-test');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60); // Should be less than or equal to window size
  });
});
