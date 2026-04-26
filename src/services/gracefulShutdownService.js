/**
 * Graceful Shutdown Service for LeaseFlow Backend
 * Ensures zero-downtime deployments by handling SIGTERM signals properly
 */

class GracefulShutdownService {
  constructor() {
    this.isShuttingDown = false;
    this.activeConnections = new Set();
    this.backgroundJobs = new Map();
    this.bullMQQueues = new Map();
    this.shutdownTimeout = 30000; // 30 seconds
    this.healthCheckGracePeriod = 5000; // 5 seconds
    this.requestDrainTimeout = 25000; // 25 seconds for request drain
  }

  /**
   * Initialize graceful shutdown handlers
   * @param {Object} app - Express app instance
   * @param {Object} server - HTTP server instance
   * @param {Object} dependencies - Application dependencies
   */
  initialize(app, server, dependencies = {}) {
    this.app = app;
    this.server = server;
    this.dependencies = dependencies;

    // Register signal handlers
    process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
    process.on('SIGINT', () => this.handleShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('[GracefulShutdown] Uncaught exception:', error);
      this.handleShutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[GracefulShutdown] Unhandled rejection at:', promise, 'reason:', reason);
      this.handleShutdown('unhandledRejection');
    });

    // Track active connections
    this.setupConnectionTracking();

    console.log('[GracefulShutdown] Service initialized');
  }

  /**
   * Setup connection tracking for graceful shutdown
   */
  setupConnectionTracking() {
    if (!this.server) return;

    this.server.on('connection', (socket) => {
      const connectionId = this.generateConnectionId(socket);
      this.activeConnections.add(connectionId);

      socket.on('close', () => {
        this.activeConnections.delete(connectionId);
      });

      // Set timeout for connections during shutdown
      socket.setTimeout(this.shutdownTimeout, () => {
        if (this.isShuttingDown) {
          socket.destroy();
          this.activeConnections.delete(connectionId);
        }
      });
    });

    // Add middleware to return 503 during shutdown
    this.setupShutdownMiddleware();
  }

  /**
   * Setup middleware to return 503 for all requests during shutdown
   */
  setupShutdownMiddleware() {
    if (!this.app) return;

    // Insert middleware at the beginning of the stack
    this.app.use((req, res, next) => {
      if (this.isShuttingDown) {
        res.status(503).json({
          status: 'shutting_down',
          message: 'Server is shutting down, please retry later',
          timestamp: new Date().toISOString()
        });
        return;
      }
      next();
    });
  }

  /**
   * Generate unique connection ID
   * @param {Object} socket - Socket connection
   * @returns {string} Connection ID
   */
  generateConnectionId(socket) {
    return `${socket.remoteAddress}:${socket.remotePort}:${Date.now()}`;
  }

  /**
   * Register background job for graceful shutdown
   * @param {string} name - Job name
   * @param {Object} job - Job instance with stop() method
   */
  registerBackgroundJob(name, job) {
    this.backgroundJobs.set(name, job);
  }

  /**
   * Register BullMQ queue for graceful shutdown
   * @param {string} name - Queue name
   * @param {Object} queue - BullMQ queue instance
   * @param {Object} worker - BullMQ worker instance (optional)
   */
  registerBullMQQueue(name, queue, worker = null) {
    this.bullMQQueues.set(name, { queue, worker });
  }

  /**
   * Handle shutdown signal
   * @param {string} signal - Shutdown signal type
   */
  async handleShutdown(signal) {
    if (this.isShuttingDown) {
      console.log('[GracefulShutdown] Shutdown already in progress, ignoring signal:', signal);
      return;
    }

    this.isShuttingDown = true;
    console.log(`[GracefulShutdown] Received ${signal}, starting graceful shutdown...`);

    try {
      // Start shutdown sequence
      await this.performGracefulShutdown();
    } catch (error) {
      console.error('[GracefulShutdown] Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Perform graceful shutdown sequence
   */
  async performGracefulShutdown() {
    const shutdownStart = Date.now();

    try {
      // Step 1: Stop accepting new connections (return 503)
      await this.stopAcceptingConnections();

      // Step 2: Pause BullMQ queues to prevent new jobs
      await this.pauseBullMQQueues();

      // Step 3: Wait for active connections to finish (with timeout)
      await this.waitForActiveConnections();

      // Step 4: Stop background jobs
      await this.stopBackgroundJobs();

      // Step 5: Close BullMQ workers and queues
      await this.closeBullMQQueues();

      // Step 6: Close database connections
      await this.closeDatabaseConnections();

      // Step 7: Close Redis connections (including Pub/Sub)
      await this.closeRedisConnections();

      // Step 8: Stop GraphQL server
      await this.stopGraphQLServer();

      // Step 9: Close HTTP server
      await this.closeHttpServer();

      const shutdownDuration = Date.now() - shutdownStart;
      console.log(`[GracefulShutdown] Shutdown completed in ${shutdownDuration}ms`);

      process.exit(0);
    } catch (error) {
      console.error('[GracefulShutdown] Shutdown failed:', error);
      process.exit(1);
    }
  }

  /**
   * Stop accepting new connections
   */
  async stopAcceptingConnections() {
    console.log('[GracefulShutdown] Stopping new connections...');

    // Mark health check endpoint as shutting down
    if (this.app) {
      this.app.get('/health', (req, res) => {
        res.status(503).json({
          status: 'shutting_down',
          message: 'Server is shutting down',
          timestamp: new Date().toISOString()
        });
      });
    }

    // Wait a moment for health check propagation
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  /**
   * Wait for active connections to complete
   */
  async waitForActiveConnections() {
    console.log(`[GracefulShutdown] Waiting for ${this.activeConnections.size} active connections...`);

    const startTime = Date.now();
    const maxWaitTime = this.requestDrainTimeout; // Use dedicated request drain timeout

    while (this.activeConnections.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      console.log(`[GracefulShutdown] Still waiting for ${this.activeConnections.size} connections...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (this.activeConnections.size > 0) {
      console.warn(`[GracefulShutdown] Force closing ${this.activeConnections.size} remaining connections`);
      this.activeConnections.clear();
    }
  }

  /**
   * Pause BullMQ queues to prevent new jobs from being processed
   */
  async pauseBullMQQueues() {
    console.log('[GracefulShutdown] Pausing BullMQ queues...');

    const pausePromises = [];

    for (const [name, { queue, worker }] of this.bullMQQueues) {
      console.log(`[GracefulShutdown] Pausing queue: ${name}`);

      if (worker && typeof worker.pause === 'function') {
        pausePromises.push(
          Promise.resolve().then(() => worker.pause())
            .catch(error => console.error(`[GracefulShutdown] Error pausing worker ${name}:`, error))
        );
      }

      if (queue && typeof queue.pause === 'function') {
        pausePromises.push(
          Promise.resolve().then(() => queue.pause())
            .catch(error => console.error(`[GracefulShutdown] Error pausing queue ${name}:`, error))
        );
      }
    }

    await Promise.all(pausePromises);
    console.log('[GracefulShutdown] All BullMQ queues paused');
  }

  /**
   * Close BullMQ workers and queues
   */
  async closeBullMQQueues() {
    console.log('[GracefulShutdown] Closing BullMQ workers and queues...');

    const closePromises = [];

    for (const [name, { queue, worker }] of this.bullMQQueues) {
      console.log(`[GracefulShutdown] Closing queue: ${name}`);

      if (worker && typeof worker.close === 'function') {
        closePromises.push(
          Promise.resolve().then(() => worker.close())
            .catch(error => console.error(`[GracefulShutdown] Error closing worker ${name}:`, error))
        );
      }

      if (queue && typeof queue.close === 'function') {
        closePromises.push(
          Promise.resolve().then(() => queue.close())
            .catch(error => console.error(`[GracefulShutdown] Error closing queue ${name}:`, error))
        );
      }
    }

    await Promise.all(closePromises);
    console.log('[GracefulShutdown] All BullMQ workers and queues closed');
  }

  /**
   * Stop all background jobs
   */
  async stopBackgroundJobs() {
    console.log('[GracefulShutdown] Stopping background jobs...');

    const stopPromises = [];

    for (const [name, job] of this.backgroundJobs) {
      console.log(`[GracefulShutdown] Stopping job: ${name}`);

      if (job && typeof job.stop === 'function') {
        stopPromises.push(
          Promise.resolve().then(() => job.stop())
            .catch(error => console.error(`[GracefulShutdown] Error stopping job ${name}:`, error))
        );
      }

      // Handle Soroban indexer worker specifically
      if (name === 'sorobanIndexer' && job && typeof job.pause === 'function') {
        stopPromises.push(
          Promise.resolve().then(() => job.pause())
            .catch(error => console.error(`[GracefulShutdown] Error pausing indexer ${name}:`, error))
        );
      }
    }

    await Promise.all(stopPromises);
    console.log('[GracefulShutdown] All background jobs stopped');
  }

  /**
   * Close database connections
   */
  async closeDatabaseConnections() {
    console.log('[GracefulShutdown] Closing database connections...');

    if (this.dependencies.database) {
      try {
        await this.dependencies.database.close();
        console.log('[GracefulShutdown] Database connections closed');
      } catch (error) {
        console.error('[GracefulShutdown] Error closing database:', error);
      }
    }
  }

  /**
   * Close Redis connections
   */
  async closeRedisConnections() {
    console.log('[GracefulShutdown] Closing Redis connections...');

    if (this.dependencies.redisService) {
      try {
        const redis = await this.dependencies.redisService.getWorkingClient();
        await redis.quit();
        console.log('[GracefulShutdown] Redis connections closed');
      } catch (error) {
        console.error('[GracefulShutdown] Error closing Redis:', error);
      }
    }
  }

  /**
   * Stop GraphQL server
   */
  async stopGraphQLServer() {
    console.log('[GracefulShutdown] Stopping GraphQL server...');

    if (this.dependencies.apolloServer) {
      try {
        await this.dependencies.apolloServer.stop();
        console.log('[GracefulShutdown] GraphQL server stopped');
      } catch (error) {
        console.error('[GracefulShutdown] Error stopping GraphQL server:', error);
      }
    }
  }

  /**
   * Close HTTP server
   */
  async closeHttpServer() {
    console.log('[GracefulShutdown] Closing HTTP server...');

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close((error) => {
          if (error) {
            console.error('[GracefulShutdown] Error closing HTTP server:', error);
          } else {
            console.log('[GracefulShutdown] HTTP server closed');
          }
          resolve();
        });
      });
    }
  }

  /**
   * Check if shutdown is in progress
   * @returns {boolean} True if shutting down
   */
  isShuttingDownInProgress() {
    return this.isShuttingDown;
  }

  /**
   * Get active connection count
   * @returns {number} Number of active connections
   */
  getActiveConnectionCount() {
    return this.activeConnections.size;
  }
}

module.exports = { GracefulShutdownService };
