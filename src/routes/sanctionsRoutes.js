const express = require('express');
const router = express.Router();
const SanctionsListScreeningWorker = require('../services/sanctionsListScreeningWorker');
const { AppDatabase } = require('../src/db/appDatabase');

/**
 * Middleware to check if user is authorized for sanctions operations
 */
function requireSanctionsAuth(req, res, next) {
  // In production, implement proper authorization
  // For now, we'll check for a special header
  const authHeader = req.headers.authorization || '';
  if (!authHeader.includes('sanctions-admin')) {
    return res.status(403).json({ 
      success: false, 
      error: 'Insufficient permissions for sanctions operations' 
    });
  }
  next();
}

/**
 * GET /api/sanctions/statistics
 * Get sanctions screening statistics
 */
router.get('/statistics', requireSanctionsAuth, async (req, res) => {
  try {
    const database = new AppDatabase(process.env.DATABASE_PATH || './database.sqlite');
    const stats = database.getSanctionsStatistics();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to get statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sanctions statistics'
    });
  }
});

/**
 * POST /api/sanctions/screen-address
 * Manually screen a specific Stellar address
 */
router.post('/screen-address', requireSanctionsAuth, async (req, res) => {
  try {
    const { address } = req.body;
    
    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address is required'
      });
    }

    // Validate Stellar address format
    if (!address.startsWith('G') || address.length !== 56) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Stellar address format'
      });
    }

    const sanctionsWorker = new SanctionsListScreeningWorker();
    await sanctionsWorker.initialize();
    
    const result = await sanctionsWorker.screenAddress(address);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to screen address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to screen address'
    });
  }
});

/**
 * GET /api/sanctions/violations/:leaseId
 * Get sanctions violations for a specific lease
 */
router.get('/violations/:leaseId', requireSanctionsAuth, async (req, res) => {
  try {
    const { leaseId } = req.params;
    
    if (!leaseId) {
      return res.status(400).json({
        success: false,
        error: 'Lease ID is required'
      });
    }

    const database = new AppDatabase(process.env.DATABASE_PATH || './database.sqlite');
    const violations = database.getSanctionsViolations(leaseId);
    
    res.json({
      success: true,
      data: violations,
      count: violations.length
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to get violations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve sanctions violations'
    });
  }
});

/**
 * POST /api/sanctions/refresh-lists
 * Manually refresh sanctions lists
 */
router.post('/refresh-lists', requireSanctionsAuth, async (req, res) => {
  try {
    const sanctionsWorker = new SanctionsListScreeningWorker();
    await sanctionsWorker.initialize();
    
    await sanctionsWorker.refreshSanctionsLists();
    
    res.json({
      success: true,
      message: 'Sanctions lists refreshed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to refresh sanctions lists:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh sanctions lists'
    });
  }
});

/**
 * POST /api/sanctions/run-screening
 * Manually trigger sanctions screening for all active leases
 */
router.post('/run-screening', requireSanctionsAuth, async (req, res) => {
  try {
    const sanctionsWorker = new SanctionsListScreeningWorker();
    await sanctionsWorker.initialize();
    
    // Run screening asynchronously
    sanctionsWorker.performScreening().then(() => {
      console.log('[SanctionsRoutes] Manual screening completed');
    }).catch(error => {
      console.error('[SanctionsRoutes] Manual screening failed:', error);
    });
    
    res.json({
      success: true,
      message: 'Sanctions screening initiated',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to start screening:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sanctions screening'
    });
  }
});

/**
 * GET /api/sanctions/worker-status
 * Get sanctions worker status
 */
router.get('/worker-status', requireSanctionsAuth, async (req, res) => {
  try {
    const sanctionsWorker = new SanctionsListScreeningWorker();
    const status = sanctionsWorker.getStatistics();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to get worker status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve worker status'
    });
  }
});

/**
 * POST /api/sanctions/unfreeze-lease/:leaseId
 * Unfreeze a lease (admin only)
 */
router.post('/unfreeze-lease/:leaseId', requireSanctionsAuth, async (req, res) => {
  try {
    const { leaseId } = req.params;
    const { reason } = req.body;
    
    if (!leaseId) {
      return res.status(400).json({
        success: false,
        error: 'Lease ID is required'
      });
    }

    const database = new AppDatabase(process.env.DATABASE_PATH || './database.sqlite');
    
    // Update lease status back to active
    const success = database.updateLeaseStatus(leaseId, 'ACTIVE', {
      reason: reason || 'Manual unfreeze by admin',
      unfrozenAt: new Date().toISOString()
    });

    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Lease not found or update failed'
      });
    }

    // Resume payment schedules
    database.pausePaymentSchedules(leaseId, {
      reason: 'LEASE_UNFROZEN',
      pausedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Lease unfrozen successfully',
      leaseId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[SanctionsRoutes] Failed to unfreeze lease:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to unfreeze lease'
    });
  }
});

module.exports = router;
