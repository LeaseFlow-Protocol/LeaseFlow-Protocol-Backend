const express = require('express');
const { ReputationIndexerService } = require('../services/reputationIndexerService');

/**
 * Create reputation indexer routes for Issue #102
 * 
 * Provides endpoints for:
 * - GET /api/v1/users/:pubkey/reputation - Get user reputation score
 * - GET /api/v1/users/:pubkey/reputation/history - Get detailed history
 * - POST /api/v1/users/:pubkey/reputation/cache/clear - Clear cache
 */
function createReputationRoutes(database) {
  const router = express.Router();
  const reputationService = new ReputationIndexerService(database);

  /**
   * GET /api/v1/users/:pubkey/reputation
   * Get reputation score and summary for a user
   */
  router.get('/:pubkey/reputation', async (req, res) => {
    try {
      const { pubkey } = req.params;
      const {
        include_history = 'false',
        time_decay_months = '36',
        weighting_completed_leases = '0.25',
        weighting_payments = '0.35',
        weighting_defaults = '0.30',
        weighting_deposits = '0.10'
      } = req.query;

      if (!pubkey || pubkey.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Public key is required'
        });
      }

      // Parse options
      const options = {
        includeHistory: include_history === 'true',
        timeDecayMonths: parseInt(time_decay_months, 10),
        weighting: {
          completedLeases: parseFloat(weighting_completed_leases),
          payments: parseFloat(weighting_payments),
          defaults: parseFloat(weighting_defaults),
          deposits: parseFloat(weighting_deposits)
        }
      };

      // Validate weighting sums to 1
      const totalWeight = Object.values(options.weighting).reduce((sum, weight) => sum + weight, 0);
      if (Math.abs(totalWeight - 1.0) > 0.001) {
        return res.status(400).json({
          success: false,
          error: 'Weighting parameters must sum to 1.0',
          totalWeight: totalWeight
        });
      }

      const result = await reputationService.calculateReputationScore(pubkey, options);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error getting reputation:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/v1/users/:pubkey/reputation/history
   * Get detailed historical data for a user
   */
  router.get('/:pubkey/reputation/history', async (req, res) => {
    try {
      const { pubkey } = req.params;

      if (!pubkey || pubkey.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Public key is required'
        });
      }

      const history = await reputationService.getLesseeHistory(pubkey);

      res.json({
        success: true,
        data: {
          pubkey,
          history,
          summary: reputationService.summarizeHistory(history),
          retrievedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error getting history:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/v1/users/:pubkey/reputation/cache
   * Get cache status for a user
   */
  router.get('/:pubkey/reputation/cache', async (req, res) => {
    try {
      const { pubkey } = req.params;
      const cacheStats = reputationService.getCacheStats();

      // Check if user has cached data
      const userCachedEntries = Array.from(reputationService.scoreCache.keys())
        .filter(key => key.startsWith(pubkey + '_')).length;

      res.json({
        success: true,
        data: {
          pubkey,
          hasCachedData: userCachedEntries > 0,
          cachedEntries: userCachedEntries,
          globalCacheStats: cacheStats
        }
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error getting cache status:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/users/:pubkey/reputation/cache/clear
   * Clear cache for a specific user
   */
  router.post('/:pubkey/reputation/cache/clear', async (req, res) => {
    try {
      const { pubkey } = req.params;

      if (!pubkey || pubkey.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'Public key is required'
        });
      }

      reputationService.clearCache(pubkey);

      res.json({
        success: true,
        message: `Cache cleared for pubkey ${pubkey}`,
        clearedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error clearing cache:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/reputation/cache/cleanup
   * Cleanup expired cache entries (admin endpoint)
   */
  router.post('/reputation/cache/cleanup', async (req, res) => {
    try {
      const cleanedCount = reputationService.cleanupCache();

      res.json({
        success: true,
        message: `Cleaned up ${cleanedCount} expired cache entries`,
        cleanedCount,
        cleanedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error cleaning up cache:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /api/v1/reputation/stats
   * Get global reputation statistics (admin endpoint)
   */
  router.get('/reputation/stats', async (req, res) => {
    try {
      const cacheStats = reputationService.getCacheStats();

      // Get database statistics
      const totalUsers = database.db
        .prepare('SELECT COUNT(DISTINCT tenant_id) as count FROM leases')
        .get();

      const totalLeases = database.db
        .prepare('SELECT COUNT(*) as count FROM leases')
        .get();

      const completedLeases = database.db
        .prepare('SELECT COUNT(*) as count FROM leases WHERE status = ?')
        .get('completed');

      const activeLeases = database.db
        .prepare('SELECT COUNT(*) as count FROM leases WHERE status = ?')
        .get('active');

      res.json({
        success: true,
        data: {
          database: {
            totalUsers: totalUsers.count,
            totalLeases: totalLeases.count,
            completedLeases: completedLeases.count,
            activeLeases: activeLeases.count
          },
          cache: cacheStats,
          service: {
            cacheTimeout: reputationService.cacheTimeout,
            defaultWeighting: reputationService.getDefaultWeighting()
          }
        }
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error getting stats:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /api/v1/reputation/batch
   * Get reputation scores for multiple users (batch endpoint)
   */
  router.post('/reputation/batch', async (req, res) => {
    try {
      const { pubkeys, options = {} } = req.body;

      if (!Array.isArray(pubkeys) || pubkeys.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Array of pubkeys is required'
        });
      }

      if (pubkeys.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Maximum 50 pubkeys allowed per batch request'
        });
      }

      const results = [];
      
      for (const pubkey of pubkeys) {
        try {
          const score = await reputationService.calculateReputationScore(pubkey, options);
          results.push({
            pubkey,
            success: true,
            data: score
          });
        } catch (error) {
          results.push({
            pubkey,
            success: false,
            error: error.message
          });
        }
      }

      res.json({
        success: true,
        data: {
          results,
          processedAt: new Date().toISOString(),
          totalRequested: pubkeys.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });

    } catch (error) {
      console.error('[ReputationRoutes] Error in batch request:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

module.exports = { createReputationRoutes };
