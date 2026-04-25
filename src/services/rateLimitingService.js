const crypto = require('crypto');

/**
 * Redis-Backed Rate Limiting Service for IoT Endpoints (Issue #104)
 * 
 * This service protects the backend infrastructure from being overwhelmed by thousands
 * of physical devices pinging the server simultaneously using a token bucket algorithm.
 * 
 * Key Features:
 * - Redis-backed token bucket rate limiting
 * - Per-IP address rate limiting (60 requests per minute)
 * - HTTP 429 responses with Retry-After headers
 * - Security audit logging for throttled connections
 * - Global cluster-wide rate limiting
 */
class RateLimitingService {
  constructor(redisService, config = {}) {
    this.redisService = redisService;
    this.config = {
      // Default rate limits for IoT endpoints
      iotEndpoints: {
        windowMs: 60 * 1000, // 1 minute window
        maxRequests: 60, // 60 requests per minute per IP
        keyExpiry: 300, // 5 minutes key expiry
      },
      // Stricter limits for webhook endpoints
      webhookEndpoints: {
        windowMs: 60 * 1000, // 1 minute window
        maxRequests: 30, // 30 requests per minute per IP
        keyExpiry: 300,
      },
      // Global limits for emergency protection
      globalLimits: {
        windowMs: 60 * 1000, // 1 minute window
        maxRequests: 10000, // 10k requests per minute globally
        keyExpiry: 300,
      },
      ...config
    };
    
    this.auditLog = [];
    this.metrics = {
      totalRequests: 0,
      throttledRequests: 0,
      allowedRequests: 0,
      iotRequests: 0,
      webhookRequests: 0,
    };
  }

  /**
   * Initialize Redis connection and setup
   */
  async initialize() {
    try {
      const redisClient = await this.redisService.getWorkingClient();
      this.redisClient = redisClient;
      
      // Test Redis connection
      await redisClient.ping();
      console.log('[RateLimiting] Redis connection established');
      
      // Initialize metrics keys
      await this.initializeMetrics();
      
    } catch (error) {
      console.error('[RateLimiting] Failed to initialize:', error);
      throw new Error('Rate limiting service initialization failed');
    }
  }

  /**
   * Initialize metrics tracking in Redis
   */
  async initializeMetrics() {
    const now = Date.now();
    const metricsKey = `rate_limit:metrics:${Math.floor(now / (60 * 1000))}`;
    
    await this.redisClient.hset(metricsKey, {
      total_requests: 0,
      throttled_requests: 0,
      allowed_requests: 0,
      iot_requests: 0,
      webhook_requests: 0,
      created_at: new Date().toISOString()
    });
    
    // Set expiry for metrics key
    await this.redisClient.expire(metricsKey, 3600); // 1 hour
  }

  /**
   * Token bucket algorithm implementation
   */
  async tokenBucket(key, maxTokens, refillRate, windowMs) {
    const now = Date.now();
    const bucketKey = `rate_limit:bucket:${key}`;
    
    // Get current bucket state
    const bucket = await this.redisClient.hgetall(bucketKey);
    
    let tokens = parseFloat(bucket.tokens || maxTokens);
    let lastRefill = parseInt(bucket.last_refill || now);
    
    // Calculate tokens to add based on time elapsed
    const timeElapsed = now - lastRefill;
    const tokensToAdd = (timeElapsed / windowMs) * maxTokens;
    
    // Refill tokens (don't exceed max)
    tokens = Math.min(maxTokens, tokens + tokensToAdd);
    
    // Check if request can be allowed
    if (tokens >= 1) {
      // Consume one token
      tokens -= 1;
      
      // Update bucket state
      await this.redisClient.hset(bucketKey, {
        tokens: tokens.toString(),
        last_refill: now.toString()
      });
      
      // Set expiry
      await this.redisClient.expire(bucketKey, Math.ceil(windowMs / 1000) * 2);
      
      return { allowed: true, tokens, resetTime: now + windowMs };
    } else {
      // Request denied
      const resetTime = lastRefill + windowMs;
      
      // Update bucket state without consuming token
      await this.redisClient.hset(bucketKey, {
        tokens: tokens.toString(),
        last_refill: now.toString()
      });
      
      return { allowed: false, tokens, resetTime };
    }
  }

  /**
   * Check rate limit for IoT endpoints
   */
  async checkIotRateLimit(ipAddress, endpoint = 'default') {
    const key = `iot:${ipAddress}:${endpoint}`;
    const { maxRequests, windowMs } = this.config.iotEndpoints;
    
    this.metrics.totalRequests++;
    this.metrics.iotRequests++;
    
    const result = await this.tokenBucket(key, maxRequests, maxRequests, windowMs);
    
    if (!result.allowed) {
      this.metrics.throttledRequests++;
      await this.logThrottledConnection(ipAddress, endpoint, 'iot');
    } else {
      this.metrics.allowedRequests++;
    }
    
    await this.updateMetrics();
    
    return {
      allowed: result.allowed,
      limit: maxRequests,
      remaining: Math.floor(result.tokens),
      resetTime: result.resetTime,
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
    };
  }

  /**
   * Check rate limit for webhook endpoints
   */
  async checkWebhookRateLimit(ipAddress, webhookId = 'default') {
    const key = `webhook:${ipAddress}:${webhookId}`;
    const { maxRequests, windowMs } = this.config.webhookEndpoints;
    
    this.metrics.totalRequests++;
    this.metrics.webhookRequests++;
    
    const result = await this.tokenBucket(key, maxRequests, maxRequests, windowMs);
    
    if (!result.allowed) {
      this.metrics.throttledRequests++;
      await this.logThrottledConnection(ipAddress, webhookId, 'webhook');
    } else {
      this.metrics.allowedRequests++;
    }
    
    await this.updateMetrics();
    
    return {
      allowed: result.allowed,
      limit: maxRequests,
      remaining: Math.floor(result.tokens),
      resetTime: result.resetTime,
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
    };
  }

  /**
   * Check global rate limit (emergency protection)
   */
  async checkGlobalRateLimit() {
    const key = 'global:all_requests';
    const { maxRequests, windowMs } = this.config.globalLimits;
    
    const result = await this.tokenBucket(key, maxRequests, maxRequests, windowMs);
    
    if (!result.allowed) {
      await this.logThrottledConnection('global', 'all', 'global');
    }
    
    return {
      allowed: result.allowed,
      limit: maxRequests,
      remaining: Math.floor(result.tokens),
      resetTime: result.resetTime,
      retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
    };
  }

  /**
   * Express middleware for IoT endpoint rate limiting
   */
  createIotRateLimitMiddleware(endpoint = 'default') {
    return async (req, res, next) => {
      try {
        const ipAddress = this.getClientIp(req);
        
        // Check global limit first
        const globalCheck = await this.checkGlobalRateLimit();
        if (!globalCheck.allowed) {
          return this.sendRateLimitResponse(res, globalCheck, 'Global rate limit exceeded');
        }
        
        // Check IoT-specific limit
        const iotCheck = await this.checkIotRateLimit(ipAddress, endpoint);
        if (!iotCheck.allowed) {
          return this.sendRateLimitResponse(res, iotCheck, 'IoT rate limit exceeded');
        }
        
        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': iotCheck.limit,
          'X-RateLimit-Remaining': iotCheck.remaining,
          'X-RateLimit-Reset': new Date(iotCheck.resetTime).toISOString()
        });
        
        next();
      } catch (error) {
        console.error('[RateLimiting] Middleware error:', error);
        // Fail open - allow request if rate limiting fails
        next();
      }
    };
  }

  /**
   * Express middleware for webhook endpoint rate limiting
   */
  createWebhookRateLimitMiddleware(webhookId = 'default') {
    return async (req, res, next) => {
      try {
        const ipAddress = this.getClientIp(req);
        
        // Check global limit first
        const globalCheck = await this.checkGlobalRateLimit();
        if (!globalCheck.allowed) {
          return this.sendRateLimitResponse(res, globalCheck, 'Global rate limit exceeded');
        }
        
        // Check webhook-specific limit
        const webhookCheck = await this.checkWebhookRateLimit(ipAddress, webhookId);
        if (!webhookCheck.allowed) {
          return this.sendRateLimitResponse(res, webhookCheck, 'Webhook rate limit exceeded');
        }
        
        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': webhookCheck.limit,
          'X-RateLimit-Remaining': webhookCheck.remaining,
          'X-RateLimit-Reset': new Date(webhookCheck.resetTime).toISOString()
        });
        
        next();
      } catch (error) {
        console.error('[RateLimiting] Middleware error:', error);
        // Fail open - allow request if rate limiting fails
        next();
      }
    };
  }

  /**
   * Get client IP address from request
   */
  getClientIp(req) {
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           'unknown';
  }

  /**
   * Send rate limit response with proper headers
   */
  sendRateLimitResponse(res, rateLimitResult, message) {
    res.set({
      'Retry-After': rateLimitResult.retryAfter.toString(),
      'X-RateLimit-Limit': rateLimitResult.limit,
      'X-RateLimit-Remaining': rateLimitResult.remaining,
      'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString()
    });
    
    res.status(429).json({
      success: false,
      error: 'Too Many Requests',
      message: message,
      retryAfter: rateLimitResult.retryAfter,
      limit: rateLimitResult.limit,
      resetTime: new Date(rateLimitResult.resetTime).toISOString()
    });
  }

  /**
   * Log throttled connections for security audit
   */
  async logThrottledConnection(ipAddress, endpoint, type) {
    const logEntry = {
      id: crypto.randomUUID(),
      ipAddress,
      endpoint,
      type,
      timestamp: new Date().toISOString(),
      userAgent: 'N/A', // Would be extracted from request in real implementation
    };
    
    // Store in Redis for recent audit logs
    const auditKey = `rate_limit:audit:${Date.now()}`;
    await this.redisClient.hset(auditKey, logEntry);
    await this.redisClient.expire(auditKey, 86400); // 24 hours
    
    // Also store in memory for immediate access
    this.auditLog.push(logEntry);
    
    // Keep only last 1000 entries in memory
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
    
    console.warn(`[RateLimiting] Throttled ${type} connection from ${ipAddress} to ${endpoint}`);
  }

  /**
   * Update metrics in Redis
   */
  async updateMetrics() {
    const now = Date.now();
    const metricsKey = `rate_limit:metrics:${Math.floor(now / (60 * 1000))}`;
    
    await this.redisClient.hincrby(metricsKey, 'total_requests', 1);
    await this.redisClient.hincrby(metricsKey, 'iot_requests', this.metrics.iotRequests > 0 ? 1 : 0);
    await this.redisClient.hincrby(metricsKey, 'webhook_requests', this.metrics.webhookRequests > 0 ? 1 : 0);
    await this.redisClient.hincrby(metricsKey, 'allowed_requests', this.metrics.allowedRequests > 0 ? 1 : 0);
    await this.redisClient.hincrby(metricsKey, 'throttled_requests', this.metrics.throttledRequests > 0 ? 1 : 0);
  }

  /**
   * Get current rate limiting statistics
   */
  async getStats() {
    const now = Date.now();
    const currentMinute = Math.floor(now / (60 * 1000));
    const metricsKey = `rate_limit:metrics:${currentMinute}`;
    
    const currentMetrics = await this.redisClient.hgetall(metricsKey);
    
    // Get recent audit logs
    const auditKeys = await this.redisClient.keys('rate_limit:audit:*');
    const recentAudits = [];
    
    if (auditKeys.length > 0) {
      const auditData = await this.redisClient.mget(auditKeys);
      auditData.forEach((data, index) => {
        if (data) {
          recentAudits.push(JSON.parse(data));
        }
      });
    }
    
    // Sort by timestamp and get last 50
    recentAudits.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const recentThrottled = recentAudits.slice(0, 50);
    
    return {
      current: {
        ...currentMetrics,
        timestamp: new Date().toISOString()
      },
      cumulative: this.metrics,
      recentThrottled: recentThrottled,
      config: this.config
    };
  }

  /**
   * Reset rate limit for a specific IP (admin function)
   */
  async resetRateLimit(ipAddress, endpoint = 'default', type = 'iot') {
    const key = `rate_limit:bucket:${type}:${ipAddress}:${endpoint}`;
    await this.redisClient.del(key);
    
    console.log(`[RateLimiting] Reset rate limit for ${type} endpoint ${endpoint} from ${ipAddress}`);
    return { success: true, message: 'Rate limit reset' };
  }

  /**
   * Get rate limit status for a specific IP
   */
  async getRateLimitStatus(ipAddress, endpoint = 'default', type = 'iot') {
    const key = `rate_limit:bucket:${type}:${ipAddress}:${endpoint}`;
    const bucket = await this.redisClient.hgetall(key);
    
    if (!bucket || Object.keys(bucket).length === 0) {
      return {
        ipAddress,
        endpoint,
        type,
        status: 'no_limit',
        tokens: type === 'iot' ? this.config.iotEndpoints.maxRequests : this.config.webhookEndpoints.maxRequests,
        resetTime: Date.now() + (type === 'iot' ? this.config.iotEndpoints.windowMs : this.config.webhookEndpoints.windowMs)
      };
    }
    
    const now = Date.now();
    const windowMs = type === 'iot' ? this.config.iotEndpoints.windowMs : this.config.webhookEndpoints.windowMs;
    const maxTokens = type === 'iot' ? this.config.iotEndpoints.maxRequests : this.config.webhookEndpoints.maxRequests;
    
    // Calculate current tokens based on time elapsed
    let tokens = parseFloat(bucket.tokens || maxTokens);
    const lastRefill = parseInt(bucket.last_refill || now);
    const timeElapsed = now - lastRefill;
    const tokensToAdd = (timeElapsed / windowMs) * maxTokens;
    tokens = Math.min(maxTokens, tokens + tokensToAdd);
    
    return {
      ipAddress,
      endpoint,
      type,
      status: 'active',
      tokens: Math.floor(tokens),
      maxTokens,
      resetTime: parseInt(bucket.last_refill) + windowMs,
      lastRefill: parseInt(bucket.last_refill)
    };
  }

  /**
   * Cleanup old rate limit data
   */
  async cleanup() {
    try {
      // Clean up old audit logs (older than 24 hours)
      const auditKeys = await this.redisClient.keys('rate_limit:audit:*');
      const now = Date.now();
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
      
      for (const key of auditKeys) {
        const timestamp = parseInt(key.split(':')[2]);
        if (timestamp < twentyFourHoursAgo) {
          await this.redisClient.del(key);
        }
      }
      
      // Clean up old metrics (older than 1 hour)
      const metricsKeys = await this.redisClient.keys('rate_limit:metrics:*');
      const oneHourAgo = now - (60 * 60 * 1000);
      
      for (const key of metricsKeys) {
        const timestamp = parseInt(key.split(':')[2]) * 60000; // Convert back to milliseconds
        if (timestamp < oneHourAgo) {
          await this.redisClient.del(key);
        }
      }
      
      console.log('[RateLimiting] Cleanup completed');
    } catch (error) {
      console.error('[RateLimiting] Cleanup failed:', error);
    }
  }
}

module.exports = { RateLimitingService };
