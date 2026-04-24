const express = require('express');
const { MrrController } = require('../controllers/MrrController');

/**
 * MRR (Monthly Recurring Revenue) API Routes
 * 
 * Provides endpoints for:
 * - Current MRR calculation
 * - Historical MRR by date
 * - MRR trends analysis
 * - Bulk MRR processing
 * - Cache management
 */
function createMrrRoutes(database, redisClient = null) {
  const router = express.Router();
  const mrrController = new MrrController(database, redisClient);

  /**
   * GET /api/v1/lessors/:id/metrics/mrr
   * Get current MRR for a specific lessor
   * 
   * Query Parameters:
   * - currency: Target fiat currency (USD, EUR, GBP, JPY, CAD, AUD) - default: USD
   * 
   * Response:
   * {
   *   "success": true,
   *   "lessorId": "lessor-123",
   *   "targetCurrency": "USD",
   *   "currentMrr": 15000.00,
   *   "activeLeaseCount": 5,
   *   "currencyBreakdown": [
   *     {
   *       "currency": "USDC",
   *       "originalAmount": 150000000,
   *       "convertedAmount": 15000.00,
   *       "activeLeaseCount": 5,
   *       "avgMonthlyRent": 30000000,
   *       "maxMonthlyRent": 50000000,
   *       "minMonthlyRent": 20000000
   *     }
   *   ],
   *   "calculatedAt": "2024-04-24T11:55:00.000Z"
   * }
   */
  router.get('/lessors/:id/metrics/mrr', mrrController.getCurrentMrr.bind(mrrController));

  /**
   * GET /api/v1/lessors/:id/metrics/mrr?date=YYYY-MM
   * Get historical MRR for a specific lessor as of a given date
   * 
   * Query Parameters:
   * - date: Date in YYYY-MM format (required)
   * - currency: Target fiat currency (USD, EUR, GBP, JPY, CAD, AUD) - default: USD
   * 
   * Response:
   * {
   *   "success": true,
   *   "lessorId": "lessor-123",
   *   "date": "2024-03",
   *   "targetCurrency": "USD",
   *   "historicalMrr": 14500.00,
   *   "activeLeaseCount": 4,
   *   "currencyBreakdown": [...],
   *   "calculatedAt": "2024-04-24T11:55:00.000Z"
   * }
   */
  router.get('/lessors/:id/metrics/mrr', mrrController.getHistoricalMrr.bind(mrrController));

  /**
   * GET /api/v1/lessors/:id/metrics/mrr/trends
   * Get MRR trends for a lessor over time
   * 
   * Query Parameters:
   * - months: Number of months to look back (1-60) - default: 12
   * - currency: Target fiat currency (USD, EUR, GBP, JPY, CAD, AUD) - default: USD
   * 
   * Response:
   * {
   *   "success": true,
   *   "lessorId": "lessor-123",
   *   "targetCurrency": "USD",
   *   "months": 12,
   *   "trends": [
   *     {
   *       "month": "2024-03",
   *       "originalAmount": 145000000,
   *       "convertedAmount": 14500.00,
   *       "currency": "USDC",
   *       "newLeasesCount": 1
   *     }
   *   ],
   *   "calculatedAt": "2024-04-24T11:55:00.000Z"
   * }
   */
  router.get('/lessors/:id/metrics/mrr/trends', mrrController.getMrrTrends.bind(mrrController));

  /**
   * DELETE /api/v1/lessors/:id/metrics/mrr/cache
   * Clear MRR cache for a lessor (admin endpoint)
   * 
   * Response:
   * {
   *   "success": true,
   *   "message": "MRR cache cleared successfully",
   *   "lessorId": "lessor-123",
   *   "clearedAt": "2024-04-24T11:55:00.000Z"
   * }
   */
  router.delete('/lessors/:id/metrics/mrr/cache', mrrController.clearMrrCache.bind(mrrController));

  /**
   * POST /api/v1/lessors/metrics/mrr/bulk
   * Get MRR summary for multiple lessors (bulk endpoint)
   * 
   * Request Body:
   * {
   *   "lessorIds": ["lessor-123", "lessor-456", "lessor-789"],
   *   "currency": "USD"
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "currency": "USD",
   *   "totalLessors": 3,
   *   "successfulCalculations": 3,
   *   "results": [
   *     {
   *       "lessorId": "lessor-123",
   *       "success": true,
   *       "currentMrr": 15000.00,
   *       "activeLeaseCount": 5,
   *       "currencyBreakdown": [...],
   *       "calculatedAt": "2024-04-24T11:55:00.000Z"
   *     }
   *   ],
   *   "calculatedAt": "2024-04-24T11:55:00.000Z"
   * }
   */
  router.post('/lessors/metrics/mrr/bulk', mrrController.getBulkMrr.bind(mrrController));

  return router;
}

module.exports = { createMrrRoutes };
