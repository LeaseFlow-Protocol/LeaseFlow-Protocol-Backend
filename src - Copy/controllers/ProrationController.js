const { ProrationCalculatorService } = require('../services/prorationCalculatorService');

/**
 * Controller for Fiat-to-Crypto Rent Proration Calculator Engine
 * 
 * Handles GET /api/v1/leases/:id/proration-preview endpoint with rate limiting
 * and comprehensive error handling.
 */
class ProrationController {
  /**
   * Calculate proration preview for lease termination
   * @route GET /api/v1/leases/:id/proration-preview
   */
  async getProrationPreview(req, res) {
    try {
      const { id: leaseId } = req.params;
      const { termination_timestamp, target_currency = 'USD' } = req.query;

      // Validate required parameters
      if (!leaseId) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID is required',
          code: 'MISSING_LEASE_ID'
        });
      }

      if (!termination_timestamp) {
        return res.status(400).json({
          success: false,
          error: 'Termination timestamp is required',
          code: 'MISSING_TIMESTAMP'
        });
      }

      // Validate timestamp format
      const terminationTimestamp = parseInt(termination_timestamp, 10);
      if (isNaN(terminationTimestamp) || terminationTimestamp <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid termination timestamp format',
          code: 'INVALID_TIMESTAMP'
        });
      }

      // Validate target currency
      const validCurrencies = ['USD', 'EUR', 'NGN', 'GBP', 'JPY'];
      const targetCurrency = target_currency.toUpperCase();
      if (!validCurrencies.includes(targetCurrency)) {
        return res.status(400).json({
          success: false,
          error: `Invalid target currency. Supported: ${validCurrencies.join(', ')}`,
          code: 'INVALID_CURRENCY'
        });
      }

      // Get services from app locals
      const database = req.app.locals.database;
      const redisClient = req.app.locals.redisClient;

      if (!database) {
        console.error('[ProrationController] Database not available');
        return res.status(500).json({
          success: false,
          error: 'Database service unavailable',
          code: 'DATABASE_UNAVAILABLE'
        });
      }

      // Initialize calculator service
      const calculator = new ProrationCalculatorService(database, redisClient);

      // Perform calculation
      console.log(`[ProrationController] Calculating proration for lease ${leaseId}`);
      const startTime = Date.now();
      
      const result = await calculator.calculateProrationPreview(
        leaseId,
        terminationTimestamp,
        targetCurrency
      );

      const calculationTime = Date.now() - startTime;
      console.log(`[ProrationController] Calculation completed in ${calculationTime}ms`);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          code: 'CALCULATION_FAILED',
          calculatedAt: result.calculatedAt
        });
      }

      // Return successful result
      return res.status(200).json({
        success: true,
        data: result,
        meta: {
          calculationTimeMs: calculationTime,
          endpoint: '/api/v1/leases/:id/proration-preview',
          version: '1.0.0'
        }
      });

    } catch (error) {
      console.error('[ProrationController] Unexpected error:', error);
      
      return res.status(500).json({
        success: false,
        error: 'Internal server error during proration calculation',
        code: 'INTERNAL_ERROR',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Health check endpoint for the proration service
   * @route GET /api/v1/proration/health
   */
  async getHealthStatus(req, res) {
    try {
      const database = req.app.locals.database;
      const redisClient = req.app.locals.redisClient;

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
          database: !!database ? 'connected' : 'disconnected',
          redis: !!redisClient ? 'connected' : 'disconnected'
        },
        version: '1.0.0'
      };

      // Test database connectivity
      if (database) {
        try {
          database.db.prepare('SELECT 1').get();
          health.services.database = 'connected';
        } catch (error) {
          health.services.database = 'error';
          health.status = 'degraded';
        }
      }

      // Test Redis connectivity
      if (redisClient) {
        try {
          await redisClient.ping();
          health.services.redis = 'connected';
        } catch (error) {
          health.services.redis = 'error';
          health.status = 'degraded';
        }
      }

      const statusCode = health.status === 'healthy' ? 200 : 503;
      return res.status(statusCode).json(health);

    } catch (error) {
      console.error('[ProrationController] Health check failed:', error);
      
      return res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  }

  /**
   * Generate fuzz test cases for development/testing
   * @route GET /api/v1/proration/fuzz-tests
   */
  async generateFuzzTests(req, res) {
    try {
      const { count = 10 } = req.query;
      const testCount = Math.min(parseInt(count, 10), 100); // Limit to 100 max

      const calculator = new ProrationCalculatorService(null, null);
      const testCases = calculator.generateFuzzTestCases(testCount);

      return res.status(200).json({
        success: true,
        data: {
          count: testCases.length,
          testCases
        },
        meta: {
          generatedAt: new Date().toISOString(),
          purpose: 'Fuzz testing against smart contract output'
        }
      });

    } catch (error) {
      console.error('[ProrationController] Fuzz test generation failed:', error);
      
      return res.status(500).json({
        success: false,
        error: 'Failed to generate fuzz test cases',
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = new ProrationController();
