/**
 * Service to manage Redis caching for Lease Status (Issue #32).
 * Drastically reduces server load by avoiding repeated DB hits for lease checks.
 */
class LeaseCacheService {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} redisClient - Redis client (or mock)
   */
  constructor(database, redisClient = null) {
    this.database = database;
    this.redis = redisClient || this._createMockRedis();
  }

  /**
   * Get lease status, checking cache first.
   * This is called every time a tenant opens their app.
   * 
   * @param {string} leaseId - Lease identifier
   * @returns {Promise<object|null>} Lease status information
   */
  async getLeaseStatus(leaseId) {
    const cacheKey = `lease:status:${leaseId}`;
    
    try {
      const cachedData = await this.redis.get(cacheKey);
      if (cachedData) {
        console.log(`[Redis Cache Hit] Lease ${leaseId} status loaded instantly.`);
        return JSON.parse(cachedData);
      }
    } catch (err) {
      console.error(`[Redis Error] Failed to get cache for ${leaseId}:`, err.message);
    }

    // Cache Miss: Hit the database
    const lease = this.database.getLeaseById(leaseId);
    if (!lease) return null;

    const statusInfo = {
      id: lease.id,
      status: lease.status,
      paymentStatus: lease.paymentStatus,
      lastPaymentAt: lease.lastPaymentAt,
      rentAmount: lease.rentAmount,
      currency: lease.currency,
      updatedAt: lease.updatedAt
    };

    // Store in Redis for 1 hour (3600 seconds)
    try {
      await this.redis.set(cacheKey, JSON.stringify(statusInfo), 'EX', 3600);
      console.log(`[Redis Cache Fill] Lease ${leaseId} status cached.`);
    } catch (err) {
      console.error(`[Redis Error] Failed to set cache for ${leaseId}:`, err.message);
    }

    return statusInfo;
  }

  /**
   * Invalidate the cache when a LeaseUpdate event is detected on-chain.
   * 
   * @param {string} leaseId - Lease identifier
   */
  async invalidateLeaseCache(leaseId) {
    const cacheKey = `lease:status:${leaseId}`;
    try {
      await this.redis.del(cacheKey);
      console.log(`[Redis Cache Invalidate] LeaseUpdate event detected for ${leaseId}. Cache cleared.`);
    } catch (err) {
      console.error(`[Redis Error] Failed to invalidate cache for ${leaseId}:`, err.message);
    }
  }

  /**
   * Private helper to create a mock Redis client if none is provided.
   */
  _createMockRedis() {
    return {
      _data: new Map(),
      async get(key) { return this._data.get(key); },
      async set(key, val) { this._data.set(key, val); return 'OK'; },
      async del(key) { this._data.delete(key); return 1; }
    };
  }
}

module.exports = { LeaseCacheService };
