const Redis = require('ioredis');

/**
 * RedisService - Manages Redis connections and operations
 */
class RedisService {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.subscriber = null;
    this.isConnected = false;
    this.subscriptions = new Map();
  }

  /**
   * Initialize Redis connection
   */
  async connect() {
    try {
      if (this.client && this.isConnected) {
        return this.client;
      }

      this.client = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        // Enable key prefixing for this application
        keyPrefix: 'leaseflow:',
        // Handle connection errors gracefully
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          return err.message.includes(targetError);
        },
      });

      // Set up event handlers
      this.client.on('connect', () => {
        console.log('[RedisService] Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('[RedisService] Redis connection error:', err);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        console.log('[RedisService] Redis connection closed');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        console.log('[RedisService] Reconnecting to Redis...');
      });

      // Test the connection
      await this.client.connect();
      await this.client.ping();

      console.log('[RedisService] Redis connection established successfully');
      return this.client;

    } catch (error) {
      console.error('[RedisService] Failed to connect to Redis:', error.message);
      console.warn('[RedisService] Continuing without Redis - caching will be disabled');
      this.client = null;
      this.isConnected = false;
      return null;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    // Unsubscribe from all Pub/Sub channels
    await this.unsubscribeAll();

    // Close subscriber connection
    if (this.subscriber) {
      try {
        await this.subscriber.quit();
        console.log('[RedisService] Redis subscriber disconnected');
      } catch (error) {
        console.error('[RedisService] Error during subscriber disconnection:', error.message);
      } finally {
        this.subscriber = null;
      }
    }

    // Close main client connection
    if (this.client) {
      try {
        await this.client.quit();
        console.log('[RedisService] Disconnected from Redis');
      } catch (error) {
        console.error('[RedisService] Error during Redis disconnection:', error.message);
      } finally {
        this.client = null;
        this.isConnected = false;
      }
    }
  }

  /**
   * Subscribe to a Redis Pub/Sub channel
   * @param {string} channel - Channel name
   * @param {Function} callback - Callback function for messages
   */
  async subscribe(channel, callback) {
    if (!this.subscriber) {
      // Create a dedicated subscriber connection
      this.subscriber = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        keyPrefix: 'leaseflow:',
      });

      this.subscriber.on('connect', () => {
        console.log('[RedisService] Subscriber connected to Redis');
      });

      this.subscriber.on('error', (err) => {
        console.error('[RedisService] Subscriber connection error:', err);
      });
    }

    try {
      await this.subscriber.connect();
      await this.subscriber.subscribe(channel, (message) => {
        callback(message, channel);
      });

      this.subscriptions.set(channel, callback);
      console.log(`[RedisService] Subscribed to channel: ${channel}`);
    } catch (error) {
      console.error(`[RedisService] Error subscribing to channel ${channel}:`, error.message);
    }
  }

  /**
   * Unsubscribe from a specific channel
   * @param {string} channel - Channel name
   */
  async unsubscribe(channel) {
    if (this.subscriber && this.subscriptions.has(channel)) {
      try {
        await this.subscriber.unsubscribe(channel);
        this.subscriptions.delete(channel);
        console.log(`[RedisService] Unsubscribed from channel: ${channel}`);
      } catch (error) {
        console.error(`[RedisService] Error unsubscribing from channel ${channel}:`, error.message);
      }
    }
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribeAll() {
    if (this.subscriber && this.subscriptions.size > 0) {
      try {
        const channels = Array.from(this.subscriptions.keys());
        await this.subscriber.unsubscribe(...channels);
        this.subscriptions.clear();
        console.log(`[RedisService] Unsubscribed from ${channels.length} channels`);
      } catch (error) {
        console.error('[RedisService] Error unsubscribing from all channels:', error.message);
      }
    }
  }

  /**
   * Get Redis client (lazy initialization)
   */
  async getClient() {
    if (!this.client || !this.isConnected) {
      return await this.connect();
    }
    return this.client;
  }

  /**
   * Check if Redis is available
   */
  isAvailable() {
    return this.isConnected && this.client;
  }

  /**
   * Set a key with expiration
   */
  async setex(key, ttl, value) {
    const client = await this.getClient();
    if (!client) return false;

    try {
      await client.setex(key, ttl, value);
      return true;
    } catch (error) {
      console.error('[RedisService] Error in setex:', error.message);
      return false;
    }
  }

  /**
   * Get a key value
   */
  async get(key) {
    const client = await this.getClient();
    if (!client) return null;

    try {
      return await client.get(key);
    } catch (error) {
      console.error('[RedisService] Error in get:', error.message);
      return null;
    }
  }

  /**
   * Delete keys
   */
  async del(...keys) {
    const client = await this.getClient();
    if (!client) return 0;

    try {
      return await client.del(...keys);
    } catch (error) {
      console.error('[RedisService] Error in del:', error.message);
      return 0;
    }
  }

  /**
   * Get keys matching a pattern
   */
  async keys(pattern) {
    const client = await this.getClient();
    if (!client) return [];

    try {
      return await client.keys(pattern);
    } catch (error) {
      console.error('[RedisService] Error in keys:', error.message);
      return [];
    }
  }

  /**
   * Increment a key
   */
  async incr(key) {
    const client = await this.getClient();
    if (!client) return 0;

    try {
      return await client.incr(key);
    } catch (error) {
      console.error('[RedisService] Error in incr:', error.message);
      return 0;
    }
  }

  /**
   * Create a mock Redis client for testing/fallback
   */
  createMockClient() {
    const mockCache = new Map();

    return {
      get: async (key) => mockCache.get(key) || null,
      setex: async (key, ttl, value) => {
        mockCache.set(key, value);
        // Mock expiration with setTimeout
        setTimeout(() => mockCache.delete(key), ttl * 1000);
        return 'OK';
      },
      del: async (...keys) => {
        let deleted = 0;
        keys.forEach(key => {
          if (mockCache.delete(key)) deleted++;
        });
        return deleted;
      },
      keys: async (pattern) => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Array.from(mockCache.keys()).filter(key => regex.test(key));
      },
      incr: async (key) => {
        const current = mockCache.get(key) || 0;
        const newValue = current + 1;
        mockCache.set(key, newValue);
        return newValue;
      },
      ping: async () => 'PONG',
      quit: async () => 'OK'
    };
  }

  /**
   * Get a working client (either real Redis or mock)
   */
  async getWorkingClient() {
    const client = await this.getClient();
    if (client) return client;

    // Return mock client if Redis is not available
    console.warn('[RedisService] Using mock Redis client - caching is in-memory only');
    return this.createMockClient();
  }
}

module.exports = { RedisService };
