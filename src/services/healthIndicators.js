/**
 * Database Health Indicator
 * Checks database connectivity and schema integrity
 */
class DatabaseHealthIndicator {
  constructor(database) {
    this.database = database;
  }

  async isHealthy() {
    try {
      // Basic connectivity check
      this.database.db.prepare("SELECT 1").get();
      
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: { message: 'Database connection successful' }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: { message: 'Database connection failed' }
      };
    }
  }

  async checkSchema() {
    try {
      // Check if critical tables exist
      const criticalTables = [
        'leases',
        'actors', 
        'assets',
        'audit_log'
      ];

      const tableResults = {};
      let allTablesExist = true;

      for (const table of criticalTables) {
        try {
          const result = this.database.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
          ).get(table);
          
          tableResults[table] = result ? 'exists' : 'missing';
          if (!result) allTablesExist = false;
        } catch (error) {
          tableResults[table] = 'error';
          allTablesExist = false;
        }
      }

      return {
        status: allTablesExist ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        tables: tableResults,
        details: { 
          message: allTablesExist ? 'All critical tables present' : 'Missing critical tables'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: { message: 'Schema check failed' }
      };
    }
  }

  async checkCriticalTables() {
    try {
      // Check if we can query critical tables
      const checks = {};

      // Check leases table
      try {
        this.database.db.prepare("SELECT COUNT(*) as count FROM leases LIMIT 1").get();
        checks.leases = 'queryable';
      } catch (error) {
        checks.leases = 'error';
      }

      // Check actors table
      try {
        this.database.db.prepare("SELECT COUNT(*) as count FROM actors LIMIT 1").get();
        checks.actors = 'queryable';
      } catch (error) {
        checks.actors = 'error';
      }

      // Check audit_log table
      try {
        this.database.db.prepare("SELECT COUNT(*) as count FROM audit_log LIMIT 1").get();
        checks.audit_log = 'queryable';
      } catch (error) {
        checks.audit_log = 'error';
      }

      const allQueryable = Object.values(checks).every(status => status === 'queryable');

      return {
        status: allQueryable ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        tables: checks,
        details: {
          message: allQueryable ? 'All critical tables queryable' : 'Some tables not queryable'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: { message: 'Critical tables check failed' }
      };
    }
  }
}

/**
 * Redis Health Indicator
 * Checks Redis connectivity and basic operations
 */
class RedisHealthIndicator {
  constructor(redisService) {
    this.redisService = redisService;
  }

  async isHealthy() {
    try {
      // Get Redis client
      const redis = await this.redisService.getWorkingClient();
      
      if (!redis) {
        throw new Error('Redis client not available');
      }

      // Basic ping test
      const pong = await redis.ping();
      
      if (pong !== 'PONG') {
        throw new Error('Redis ping failed');
      }

      // Basic set/get test
      const testKey = `health_check_${Date.now()}`;
      await redis.setex(testKey, 10, 'test_value');
      const value = await redis.get(testKey);
      await redis.del(testKey);

      if (value !== 'test_value') {
        throw new Error('Redis read/write test failed');
      }

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        details: { 
          message: 'Redis connection and operations successful',
          ping: pong
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: { message: 'Redis health check failed' }
      };
    }
  }

  async checkMemory() {
    try {
      const redis = await this.redisService.getWorkingClient();
      
      if (!redis) {
        throw new Error('Redis client not available');
      }

      const info = await redis.info('memory');
      const memoryInfo = this.parseRedisInfo(info);

      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        memory: {
          used: memoryInfo.used_memory_human,
          peak: memoryInfo.used_memory_peak_human,
          rss: memoryInfo.used_memory_rss_human
        },
        details: { message: 'Redis memory info retrieved' }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        details: { message: 'Redis memory check failed' }
      };
    }
  }

  parseRedisInfo(info) {
    const lines = info.split('\r\n');
    const result = {};
    
    for (const line of lines) {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          result[key] = value;
        }
      }
    }
    
    return result;
  }
}

module.exports = {
  DatabaseHealthIndicator,
  RedisHealthIndicator
};
