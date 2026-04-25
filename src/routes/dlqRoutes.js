const express = require('express');
const { DlqService } = require('../services/dlqService');
const { AppDatabase } = require('../db/appDatabase');

/**
 * Create DLQ administrative routes for Issue #105
 * 
 * Provides endpoints for:
 * - POST /admin/dlq/retry - Manual retry of failed jobs
 * - GET /admin/dlq/jobs - List DLQ jobs
 * - GET /admin/dlq/stats - DLQ statistics
 */
function createDlqRoutes(config) {
  const router = express.Router();
  const database = new AppDatabase(config.database?.filename || './leases.db');
  const dlqService = new DlqService(config);

  /**
   * POST /admin/dlq/retry
   * Manually retry a failed DLQ job
   */
  router.post('/retry', async (req, res) => {
    try {
      const { jobId } = req.body;
      
      if (!jobId) {
        return res.status(400).json({
          success: false,
          error: 'Job ID is required'
        });
      }

      // Check if DLQ job exists
      const dlqEvents = database.getDlqEvents({ limit: 1000 });
      const dlqJob = dlqEvents.find(job => job.id === jobId);
      
      if (!dlqJob) {
        return res.status(404).json({
          success: false,
          error: 'DLQ job not found'
        });
      }

      // Update status to retried
      database.updateDlqEventStatus(jobId, 'retried');
      
      // Log the retry action
      database.insertDlqAuditLog({
        dlqEventId: jobId,
        action: 'MANUAL_RETRY',
        performedBy: req.actor?.id || 'system',
        notes: `Manual retry triggered via API`
      });

      // Queue the retry
      await dlqService.retryDlqJob(jobId);

      res.json({
        success: true,
        message: `Job ${jobId} queued for retry`,
        jobId: jobId,
        retriedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[DLQ Routes] Retry error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/dlq/jobs
   * List DLQ jobs with optional filtering
   */
  router.get('/jobs', async (req, res) => {
    try {
      const {
        eventType,
        status,
        limit = 50,
        offset = 0
      } = req.query;

      const options = {
        eventType,
        status,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10)
      };

      const jobs = database.getDlqEvents(options);
      const stats = database.getDlqStats();

      res.json({
        success: true,
        data: jobs,
        pagination: {
          limit: options.limit,
          offset: options.offset,
          total: stats.totalFailed + stats.totalRetried + stats.totalResolved
        },
        stats: stats
      });

    } catch (error) {
      console.error('[DLQ Routes] Jobs list error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/dlq/stats
   * Get DLQ statistics and queue health
   */
  router.get('/stats', async (req, res) => {
    try {
      const dbStats = database.getDlqStats();
      const queueStats = await dlqService.getQueueStats();

      res.json({
        success: true,
        data: {
          database: dbStats,
          queues: queueStats,
          health: {
            totalFailed: dbStats.totalFailed,
            totalRetried: dbStats.totalRetried,
            totalResolved: dbStats.totalResolved,
            resolutionRate: dbStats.totalFailed > 0 
              ? (dbStats.totalResolved / dbStats.totalFailed * 100).toFixed(2) + '%'
              : '0%',
            lastIngestedLedger: dbStats.lastIngestedLedger
          }
        }
      });

    } catch (error) {
      console.error('[DLQ Routes] Stats error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * GET /admin/dlq/jobs/:jobId
   * Get specific DLQ job details
   */
  router.get('/jobs/:jobId', async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const jobs = database.getDlqEvents({ limit: 1000 });
      const job = jobs.find(j => j.id === jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'DLQ job not found'
        });
      }

      // Get audit log for this job
      const auditLogs = database.db
        .prepare(`
          SELECT action, performed_by, notes, created_at
          FROM dlq_audit_log
          WHERE dlq_event_id = ?
          ORDER BY created_at ASC
        `)
        .all(jobId);

      res.json({
        success: true,
        data: {
          ...job,
          auditLogs: auditLogs
        }
      });

    } catch (error) {
      console.error('[DLQ Routes] Job detail error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /admin/dlq/jobs/:jobId/resolve
   * Manually mark a DLQ job as resolved (without retrying)
   */
  router.post('/jobs/:jobId/resolve', async (req, res) => {
    try {
      const { jobId } = req.params;
      const { notes } = req.body;
      
      // Check if DLQ job exists
      const jobs = database.getDlqEvents({ limit: 1000 });
      const job = jobs.find(j => j.id === jobId);
      
      if (!job) {
        return res.status(404).json({
          success: false,
          error: 'DLQ job not found'
        });
      }

      // Update status to resolved
      database.updateDlqEventStatus(jobId, 'resolved');
      
      // Log the resolution action
      database.insertDlqAuditLog({
        dlqEventId: jobId,
        action: 'MANUAL_RESOLUTION',
        performedBy: req.actor?.id || 'system',
        notes: notes || 'Manually resolved via API'
      });

      res.json({
        success: true,
        message: `Job ${jobId} marked as resolved`,
        jobId: jobId,
        resolvedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[DLQ Routes] Resolve error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * POST /admin/dlq/ledger/reset
   * Reset the last ingested ledger pointer (emergency use only)
   */
  router.post('/ledger/reset', async (req, res) => {
    try {
      const { ledgerNumber } = req.body;
      
      if (typeof ledgerNumber !== 'number' || ledgerNumber < 0) {
        return res.status(400).json({
          success: false,
          error: 'Valid ledger number is required'
        });
      }

      database.updateLastIngestedLedger(ledgerNumber);
      
      // Log this emergency action
      database.insertDlqAuditLog({
        dlqEventId: 'system',
        action: 'LEDGER_RESET',
        performedBy: req.actor?.id || 'system',
        notes: `Reset last ingested ledger to ${ledgerNumber}`
      });

      res.json({
        success: true,
        message: `Last ingested ledger reset to ${ledgerNumber}`,
        ledgerNumber: ledgerNumber,
        resetAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('[DLQ Routes] Ledger reset error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  return router;
}

module.exports = { createDlqRoutes };
