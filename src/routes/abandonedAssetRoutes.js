const express = require('express');
const { AbandonedAssetController } = require('../controllers/abandonedAssetController');

/**
 * Create abandoned asset tracking routes
 * @param {AppDatabase} database - Database instance
 * @param {NotificationService} notificationService - Notification service instance
 * @returns {express.Router} Router instance
 */
function createAbandonedAssetRoutes(database, notificationService) {
  const router = express.Router();
  const controller = new AbandonedAssetController(database, notificationService);

  /**
   * GET /api/v1/leases/abandoned
   * Get all abandoned assets with countdown timers
   * Query params:
   * - landlord_id: Filter by specific landlord
   * - status: Filter by abandonment status (active, pending_seizure, seized)
   * - page: Page number for pagination (default: 1)
   * - limit: Items per page (default: 50)
   */
  router.get('/', controller.getAbandonedAssets.bind(controller));

  /**
   * GET /api/v1/leases/abandoned/summary
   * Get summary statistics for abandoned assets
   * Query params:
   * - landlord_id: Filter by specific landlord
   */
  router.get('/summary', controller.getAbandonedAssetsSummary.bind(controller));

  /**
   * GET /api/v1/leases/abandoned/:leaseId
   * Get specific abandoned asset details
   * Path params:
   * - leaseId: The lease ID to retrieve
   */
  router.get('/:leaseId', controller.getAbandonedAssetById.bind(controller));

  /**
   * POST /api/v1/leases/abandoned/:leaseId/reset-timer
   * Reset abandonment timer when lessee interacts with the protocol
   * Path params:
   * - leaseId: The lease ID to reset
   * Body:
   * - interaction_type: Optional description of the interaction type
   */
  router.post('/:leaseId/reset-timer', controller.resetAbandonmentTimer.bind(controller));

  /**
   * POST /api/v1/leases/abandoned/run-tracking
   * Manually trigger the abandoned asset tracking process (admin only)
   * This endpoint should be protected by admin authentication in production
   */
  router.post('/run-tracking', controller.runTrackingManually.bind(controller));

  return router;
}

module.exports = { createAbandonedAssetRoutes };
