const { MrrAggregatorService } = require('../services/mrrAggregatorService');

/**
 * MRR (Monthly Recurring Revenue) Controller
 * 
 * Handles API endpoints for MRR calculations including:
 * - Current MRR for lessors
 * - Historical MRR by date
 * - MRR trends over time
 */
class MrrController {
  /**
   * @param {AppDatabase} database - Database instance
   * @param {object} redisClient - Redis client for caching
   */
  constructor(database, redisClient = null) {
    this.mrrService = new MrrAggregatorService(database, redisClient);
  }

  /**
   * Get current MRR for a lessor
   * GET /api/v1/lessors/:id/metrics/mrr
   */
  async getCurrentMrr(req, res) {
    try {
      const { id } = req.params;
      const { currency = 'USD' } = req.query;

      // Validate input
      if (!id || !id.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Lessor ID is required'
        });
      }

      // Validate currency
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
      if (!validCurrencies.includes(currency.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid currency. Supported currencies: ${validCurrencies.join(', ')}`
        });
      }

      console.log(`[MrrController] Getting current MRR for lessor: ${id}, currency: ${currency}`);

      // Get MRR data
      const result = await this.mrrService.getCurrentMrr(id, currency.toUpperCase());

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }

    } catch (error) {
      console.error('[MrrController] getCurrentMrr error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while calculating MRR'
      });
    }
  }

  /**
   * Get historical MRR for a lessor
   * GET /api/v1/lessors/:id/metrics/mrr?date=YYYY-MM
   */
  async getHistoricalMrr(req, res) {
    try {
      const { id } = req.params;
      const { date, currency = 'USD' } = req.query;

      // Validate input
      if (!id || !id.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Lessor ID is required'
        });
      }

      if (!date || !date.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Date parameter is required. Use format: YYYY-MM'
        });
      }

      // Validate currency
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
      if (!validCurrencies.includes(currency.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid currency. Supported currencies: ${validCurrencies.join(', ')}`
        });
      }

      console.log(`[MrrController] Getting historical MRR for lessor: ${id}, date: ${date}, currency: ${currency}`);

      // Get historical MRR data
      const result = await this.mrrService.getHistoricalMrr(id, date, currency.toUpperCase());

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }

    } catch (error) {
      console.error('[MrrController] getHistoricalMrr error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while calculating historical MRR'
      });
    }
  }

  /**
   * Get MRR trends for a lessor
   * GET /api/v1/lessors/:id/metrics/mrr/trends?months=12&currency=USD
   */
  async getMrrTrends(req, res) {
    try {
      const { id } = req.params;
      const { months = 12, currency = 'USD' } = req.query;

      // Validate input
      if (!id || !id.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Lessor ID is required'
        });
      }

      // Validate months parameter
      const monthsNum = parseInt(months);
      if (isNaN(monthsNum) || monthsNum < 1 || monthsNum > 60) {
        return res.status(400).json({
          success: false,
          error: 'Months parameter must be a number between 1 and 60'
        });
      }

      // Validate currency
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
      if (!validCurrencies.includes(currency.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid currency. Supported currencies: ${validCurrencies.join(', ')}`
        });
      }

      console.log(`[MrrController] Getting MRR trends for lessor: ${id}, months: ${monthsNum}, currency: ${currency}`);

      // Get MRR trends data
      const result = await this.mrrService.getMrrTrends(id, monthsNum, currency.toUpperCase());

      if (result.success) {
        return res.status(200).json(result);
      } else {
        return res.status(500).json(result);
      }

    } catch (error) {
      console.error('[MrrController] getMrrTrends error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while calculating MRR trends'
      });
    }
  }

  /**
   * Clear MRR cache for a lessor (admin endpoint)
   * DELETE /api/v1/lessors/:id/metrics/mrr/cache
   */
  async clearMrrCache(req, res) {
    try {
      const { id } = req.params;

      // Validate input
      if (!id || !id.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Lessor ID is required'
        });
      }

      console.log(`[MrrController] Clearing MRR cache for lessor: ${id}`);

      // Clear cache
      await this.mrrService.clearCache(id);

      return res.status(200).json({
        success: true,
        message: 'MRR cache cleared successfully',
        lessorId: id,
        clearedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[MrrController] clearMrrCache error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while clearing MRR cache'
      });
    }
  }

  /**
   * Get MRR summary for multiple lessors (bulk endpoint)
   * POST /api/v1/lessors/metrics/mrr/bulk
   */
  async getBulkMrr(req, res) {
    try {
      const { lessorIds, currency = 'USD' } = req.body;

      // Validate input
      if (!lessorIds || !Array.isArray(lessorIds) || lessorIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'lessorIds array is required and cannot be empty'
        });
      }

      if (lessorIds.length > 50) {
        return res.status(400).json({
          success: false,
          error: 'Cannot process more than 50 lessors per request'
        });
      }

      // Validate currency
      const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
      if (!validCurrencies.includes(currency.toUpperCase())) {
        return res.status(400).json({
          success: false,
          error: `Invalid currency. Supported currencies: ${validCurrencies.join(', ')}`
        });
      }

      console.log(`[MrrController] Getting bulk MRR for ${lessorIds.length} lessors, currency: ${currency}`);

      // Process in parallel with concurrency limit
      const results = [];
      const concurrencyLimit = 5;
      
      for (let i = 0; i < lessorIds.length; i += concurrencyLimit) {
        const batch = lessorIds.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(async (lessorId) => {
          try {
            const result = await this.mrrService.getCurrentMrr(lessorId, currency.toUpperCase());
            return { lessorId, ...result };
          } catch (error) {
            return {
              lessorId,
              success: false,
              error: error.message,
              calculatedAt: new Date().toISOString()
            };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      }

      return res.status(200).json({
        success: true,
        currency: currency.toUpperCase(),
        totalLessors: lessorIds.length,
        successfulCalculations: results.filter(r => r.success).length,
        results,
        calculatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[MrrController] getBulkMrr error:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error while calculating bulk MRR'
      });
    }
  }
}

module.exports = { MrrController };
