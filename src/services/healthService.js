const { DatabaseHealthIndicator, RedisHealthIndicator } = require('./healthIndicators');

/**
 * Health Service for Kubernetes Probes
 * Implements liveness, readiness, and startup probes
 */
class HealthService {
  constructor(database, redisService, config) {
    this.database = database;
    this.redisService = redisService;
    this.config = config;
    this.dbIndicator = new DatabaseHealthIndicator(database);
    this.redisIndicator = new RedisHealthIndicator(redisService);
    this.startupTime = Date.now();
    this.isReady = false;
    this.isLive = true;
  }

  /**
   * Liveness Probe - Checks if the application is running
   * Returns 200 if the process is alive, 503 if in zombie state
   */
  async checkLiveness() {
    try {
      // Basic process check
      if (!this.isLive) {
        throw new Error('Application is in zombie state');
      }

      // Quick database connectivity check (no heavy operations)
      this.database.db.prepare("SELECT 1").get();

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: {
          process: { status: 'up' },
          database: { status: 'connected' }
        }
      };
    } catch (error) {
      this.isLive = false;
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        checks: {
          process: { status: 'down' },
          database: { status: 'disconnected' }
        }
      };
    }
  }

  /**
   * Readiness Probe - Checks if the application is ready to serve traffic
   * Verifies database and Redis connectivity
   */
  async checkReadiness() {
    const checks = {};
    let overallStatus = 'ok';

    try {
      // Database connectivity check
      const dbCheck = await this.dbIndicator.isHealthy();
      checks.database = dbCheck;
      if (dbCheck.status !== 'healthy') {
        overallStatus = 'degraded';
      }

      // Redis connectivity check
      const redisCheck = await this.redisIndicator.isHealthy();
      checks.redis = redisCheck;
      if (redisCheck.status !== 'healthy') {
        overallStatus = overallStatus === 'degraded' ? 'unhealthy' : 'degraded';
      }

      // Check if critical services are initialized
      const initializationTime = Date.now() - this.startupTime;
      if (initializationTime < 30000) { // 30 seconds grace period
        overallStatus = 'starting';
        checks.initialization = { 
          status: 'in_progress',
          message: 'Application is still initializing'
        };
      } else {
        checks.initialization = { 
          status: 'complete',
          message: 'Application initialization complete'
        };
        this.isReady = true;
      }

      const statusCode = overallStatus === 'ok' ? 200 : 503;

      return {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
        ready: this.isReady
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
        checks,
        ready: false
      };
    }
  }

  /**
   * Startup Probe - Checks if the application has started successfully
   * Provides longer timeout for heavy initialization
   */
  async checkStartup() {
    const checks = {};
    const startupTimeout = this.config.startup?.timeoutMs || 120000; // 2 minutes default
    const initializationTime = Date.now() - this.startupTime;

    try {
      // Check if startup timeout exceeded
      if (initializationTime > startupTimeout) {
        throw new Error('Startup timeout exceeded');
      }

      // Database schema check
      const dbSchemaCheck = await this.dbIndicator.checkSchema();
      checks.databaseSchema = dbSchemaCheck;

      // Redis connection check
      const redisCheck = await this.redisIndicator.isHealthy();
      checks.redis = redisCheck;

      // Check if all critical tables exist
      const tablesCheck = await this.dbIndicator.checkCriticalTables();
      checks.criticalTables = tablesCheck;

      // Check if application is ready
      if (dbSchemaCheck.status === 'healthy' && 
          redisCheck.status === 'healthy' && 
          tablesCheck.status === 'healthy') {
        this.isReady = true;
        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
          initializationTime,
          checks,
          message: 'Application startup complete'
        };
      }

      return {
        status: 'starting',
        timestamp: new Date().toISOString(),
        initializationTime,
        checks,
        message: 'Application is still starting'
      };

    } catch (error) {
      return {
        status: 'failed',
        timestamp: new Date().toISOString(),
        initializationTime,
        error: error.message,
        checks,
        message: 'Application startup failed'
      };
    }
  }

  /**
   * Mark application as unhealthy (for graceful shutdown)
   */
  markUnhealthy() {
    this.isLive = false;
    this.isReady = false;
  }

  /**
   * Get application health summary
   */
  async getHealthSummary() {
    const [liveness, readiness, startup] = await Promise.all([
      this.checkLiveness(),
      this.checkReadiness(),
      this.checkStartup()
    ]);

    return {
      liveness,
      readiness,
      startup,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0'
    };
  }
}

module.exports = { HealthService };
