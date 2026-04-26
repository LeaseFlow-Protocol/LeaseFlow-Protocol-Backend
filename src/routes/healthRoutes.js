const { HealthService } = require('../services/healthService');

/**
 * Create health routes for Kubernetes probes
 * @param {Object} database - Database instance
 * @param {Object} redisService - Redis service instance
 * @param {Object} config - Application configuration
 * @returns {Object} Express router with health endpoints
 */
function createHealthRoutes(database, redisService, config) {
  const express = require('express');
  const router = express.Router();

  // Initialize health service
  const healthService = new HealthService(database, redisService, config);

  /**
   * Liveness Probe Endpoint
   * GET /health/liveness
   * 
   * Kubernetes liveness probes check if the container is still running.
   * If this probe fails, Kubernetes will restart the container.
   * 
   * Returns 200 if the application process is alive and responsive.
   * Returns 503 if the application is in a zombie state.
   */
  router.get('/liveness', async (req, res) => {
    try {
      const result = await healthService.checkLiveness();
      
      const statusCode = result.status === 'ok' ? 200 : 503;
      
      // Log health check failures for monitoring
      if (result.status !== 'ok') {
        console.error(`[Health] Liveness probe failed:`, result.error);
      }
      
      res.status(statusCode).json(result);
    } catch (error) {
      console.error('[Health] Liveness probe error:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check service unavailable'
      });
    }
  });

  /**
   * Readiness Probe Endpoint
   * GET /health/readiness
   * 
   * Kubernetes readiness probes check if the container is ready to serve traffic.
   * If this probe fails, Kubernetes will stop routing traffic to this pod.
   * 
   * Returns 200 if the application is ready to serve requests.
   * Returns 503 if the application is not ready (database/Redis issues).
   */
  router.get('/readiness', async (req, res) => {
    try {
      const result = await healthService.checkReadiness();
      
      const statusCode = result.status === 'ok' ? 200 : 503;
      
      // Log readiness check failures for monitoring
      if (result.status !== 'ok') {
        console.warn(`[Health] Readiness probe failed:`, result.error || result.status);
      }
      
      res.status(statusCode).json(result);
    } catch (error) {
      console.error('[Health] Readiness probe error:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check service unavailable'
      });
    }
  });

  /**
   * Startup Probe Endpoint
   * GET /health/startup
   * 
   * Kubernetes startup probes check if the container has started successfully.
   * This probe is used during application startup with a longer timeout.
   * 
   * Returns 200 if the application has started successfully.
   * Returns 503 if the application is still starting or failed to start.
   */
  router.get('/startup', async (req, res) => {
    try {
      const result = await healthService.checkStartup();
      
      const statusCode = result.status === 'ok' ? 200 : 503;
      
      // Log startup probe status
      if (result.status === 'failed') {
        console.error(`[Health] Startup probe failed:`, result.error);
      } else if (result.status === 'starting') {
        console.log(`[Health] Application still starting... (${result.initializationTime}ms)`);
      } else {
        console.log(`[Health] Application startup complete (${result.initializationTime}ms)`);
      }
      
      res.status(statusCode).json(result);
    } catch (error) {
      console.error('[Health] Startup probe error:', error);
      res.status(503).json({
        status: 'failed',
        timestamp: new Date().toISOString(),
        error: 'Health check service unavailable'
      });
    }
  });

  /**
   * Comprehensive Health Check Endpoint
   * GET /health
   * 
   * Combined health check for monitoring dashboards and manual checks.
   * This endpoint provides detailed information about all health aspects.
   */
  router.get('/', async (req, res) => {
    try {
      const result = await healthService.getHealthSummary();
      
      const statusCode = result.liveness.status === 'ok' && 
                        result.readiness.status === 'ok' ? 200 : 503;
      
      res.status(statusCode).json(result);
    } catch (error) {
      console.error('[Health] Comprehensive health check error:', error);
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check service unavailable'
      });
    }
  });

  /**
   * Graceful Shutdown Endpoint
   * POST /health/shutdown
   * 
   * Endpoint for graceful shutdown preparation.
   * Marks the application as unhealthy so Kubernetes stops sending traffic.
   */
  router.post('/shutdown', (req, res) => {
    try {
      healthService.markUnhealthy();
      
      console.log('[Health] Application marked for graceful shutdown');
      
      res.status(200).json({
        status: 'shutting_down',
        timestamp: new Date().toISOString(),
        message: 'Application marked for graceful shutdown'
      });
      
      // Initiate graceful shutdown after response
      setTimeout(() => {
        console.log('[Health] Initiating graceful shutdown...');
        process.exit(0);
      }, 1000);
      
    } catch (error) {
      console.error('[Health] Shutdown error:', error);
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Failed to initiate shutdown'
      });
    }
  });

  return router;
}

module.exports = { createHealthRoutes };
