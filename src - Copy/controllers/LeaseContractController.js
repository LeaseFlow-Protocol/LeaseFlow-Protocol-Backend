const IpfsService = require('../services/ipfsService');
const LeasePdfGenerationJob = require('../jobs/leasePdfGenerationJob');
const { loadConfig } = require('../config');

/**
 * Controller for lease contract PDF generation and serving
 */
class LeaseContractController {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.ipfsService = new IpfsService(config);
    this.pdfJob = new LeasePdfGenerationJob(database, config);
  }

  /**
   * Generate and serve lease contract PDF
   * @route GET /api/v1/leases/:id/contract
   */
  async getLeaseContract(req, res) {
    try {
      const { id: leaseId } = req.params;
      
      console.log(`[LeaseContractController] Contract requested for lease: ${leaseId}`);
      
      // 1. Verify lease exists and user has access
      const lease = await this.verifyLeaseAccess(leaseId, req);
      if (!lease) {
        return res.status(404).json({
          success: false,
          error: 'Lease not found or access denied'
        });
      }
      
      // 2. Check if PDF already exists
      let ipfsCid = await this.getExistingPdfCid(leaseId);
      
      if (!ipfsCid) {
        // 3. If no PDF exists, trigger generation and return status
        console.log(`[LeaseContractController] No existing PDF found for lease: ${leaseId}. Triggering generation...`);
        
        const job = await this.pdfJob.addPdfGenerationJob(leaseId, {
          priority: 'high'
        });
        
        return res.status(202).json({
          success: true,
          message: 'PDF generation in progress',
          jobId: job.id,
          leaseId,
          statusUrl: `/api/v1/leases/${leaseId}/contract/status`
        });
      }
      
      // 4. If PDF exists, verify it's available on IPFS
      const pdfExists = await this.ipfsService.verifyFileExists(ipfsCid);
      
      if (!pdfExists) {
        console.log(`[LeaseContractController] PDF CID exists but file not accessible on IPFS for lease: ${leaseId}. Regenerating...`);
        
        // Trigger regeneration
        const job = await this.pdfJob.addPdfGenerationJob(leaseId, {
          priority: 'high'
        });
        
        return res.status(202).json({
          success: true,
          message: 'PDF regeneration in progress',
          jobId: job.id,
          leaseId,
          statusUrl: `/api/v1/leases/${leaseId}/contract/status`
        });
      }
      
      // 5. Stream PDF from IPFS
      console.log(`[LeaseContractController] Streaming PDF from IPFS for lease: ${leaseId}`);
      
      const pdfBuffer = await this.ipfsService.getFile(ipfsCid);
      
      // Set appropriate headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="lease-agreement-${leaseId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.setHeader('ETag', `"${ipfsCid}"`); // Use CID as ETag
      
      // Send the PDF
      res.send(pdfBuffer);
      
      console.log(`[LeaseContractController] Successfully served PDF for lease: ${leaseId}`);
      
    } catch (error) {
      console.error('[LeaseContractController] Error serving lease contract:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get PDF generation status
   * @route GET /api/v1/leases/:id/contract/status
   */
  async getContractGenerationStatus(req, res) {
    try {
      const { id: leaseId } = req.params;
      const { jobId } = req.query;
      
      console.log(`[LeaseContractController] Status requested for lease: ${leaseId}, job: ${jobId}`);
      
      // If jobId provided, check job status
      if (jobId) {
        const jobStatus = await this.pdfJob.getJobStatus(jobId);
        
        return res.status(200).json({
          success: true,
          data: {
            leaseId,
            jobId,
            jobStatus,
            status: this.mapJobStatusToContractStatus(jobStatus.status),
            message: this.getJobStatusMessage(jobStatus)
          }
        });
      }
      
      // Otherwise, check if PDF exists
      const ipfsCid = await this.getExistingPdfCid(leaseId);
      
      if (!ipfsCid) {
        return res.status(200).json({
          success: true,
          data: {
            leaseId,
            status: 'not_generated',
            message: 'PDF has not been generated yet'
          }
        });
      }
      
      // Verify PDF is accessible
      const pdfExists = await this.ipfsService.verifyFileExists(ipfsCid);
      
      if (!pdfExists) {
        return res.status(200).json({
          success: true,
          data: {
            leaseId,
            status: 'regeneration_needed',
            message: 'PDF exists but is not accessible, regeneration needed'
          }
        });
      }
      
      return res.status(200).json({
        success: true,
        data: {
          leaseId,
          status: 'completed',
          ipfsCid,
          gatewayUrl: this.ipfsService.getGatewayUrl(ipfsCid),
          contractUrl: `/api/v1/leases/${leaseId}/contract`,
          message: 'PDF is ready for download'
        }
      });
      
    } catch (error) {
      console.error('[LeaseContractController] Error getting contract status:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Trigger PDF generation (manual trigger)
   * @route POST /api/v1/leases/:id/contract/generate
   */
  async triggerContractGeneration(req, res) {
    try {
      const { id: leaseId } = req.params;
      
      console.log(`[LeaseContractController] Manual generation triggered for lease: ${leaseId}`);
      
      // Verify lease exists
      const lease = await this.verifyLeaseAccess(leaseId, req);
      if (!lease) {
        return res.status(404).json({
          success: false,
          error: 'Lease not found or access denied'
        });
      }
      
      // Add job to queue
      const job = await this.pdfJob.addPdfGenerationJob(leaseId, {
        priority: req.body.priority || 'normal',
        force: req.body.force || false
      });
      
      return res.status(202).json({
        success: true,
        message: 'PDF generation started',
        jobId: job.id,
        leaseId,
        statusUrl: `/api/v1/leases/${leaseId}/contract/status?jobId=${job.id}`
      });
      
    } catch (error) {
      console.error('[LeaseContractController] Error triggering contract generation:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Get PDF generation queue statistics
   * @route GET /api/v1/leases/contracts/queue/stats
   */
  async getQueueStats(req, res) {
    try {
      const stats = await this.pdfJob.getQueueStats();
      
      return res.status(200).json({
        success: true,
        data: {
          queue: 'lease-pdf-generation',
          ...stats,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (error) {
      console.error('[LeaseContractController] Error getting queue stats:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Verify lease exists and user has access
   * @param {string} leaseId - Lease ID
   * @param {object} req - Express request object
   * @returns {Promise<object|null>} Lease data or null
   */
  async verifyLeaseAccess(leaseId, req) {
    try {
      const lease = this.database.getLeaseById(leaseId);
      
      if (!lease) {
        return null;
      }
      
      // TODO: Implement proper authentication check
      // For now, we'll allow access to all leases
      // In production, check if req.actor.id matches lease.landlord_id or lease.tenant_id
      
      return lease;
    } catch (error) {
      console.error('[LeaseContractController] Error verifying lease access:', error);
      return null;
    }
  }

  /**
   * Get existing PDF CID for lease
   * @param {string} leaseId - Lease ID
   * @returns {Promise<string|null>} IPFS CID or null
   */
  async getExistingPdfCid(leaseId) {
    try {
      // First try to get from lease record (if pdf_cid column exists)
      try {
        const lease = this.database.getLeaseById(leaseId);
        if (lease.pdf_cid) {
          return lease.pdf_cid;
        }
      } catch (error) {
        // Column may not exist, continue to next method
      }
      
      // Try to get from dedicated PDF records table
      try {
        const pdfRecord = this.database.db.prepare(`
          SELECT ipfs_cid FROM lease_pdf_records WHERE lease_id = ? AND status = 'completed'
        `).get(leaseId);
        
        if (pdfRecord && pdfRecord.ipfs_cid) {
          return pdfRecord.ipfs_cid;
        }
      } catch (error) {
        // Table may not exist
        console.warn('[LeaseContractController] PDF records table not found:', error.message);
      }
      
      return null;
    } catch (error) {
      console.error('[LeaseContractController] Error getting existing PDF CID:', error);
      return null;
    }
  }

  /**
   * Map BullMQ job status to contract status
   * @param {string} jobStatus - BullMQ job status
   * @returns {string} Contract status
   */
  mapJobStatusToContractStatus(jobStatus) {
    const statusMap = {
      'waiting': 'queued',
      'active': 'generating',
      'completed': 'completed',
      'failed': 'failed',
      'delayed': 'queued',
      'paused': 'paused'
    };
    
    return statusMap[jobStatus] || 'unknown';
  }

  /**
   * Get human-readable job status message
   * @param {object} jobStatus - Job status object
   * @returns {string} Status message
   */
  getJobStatusMessage(jobStatus) {
    const messages = {
      'waiting': 'PDF generation is queued and waiting to be processed',
      'active': 'PDF is currently being generated',
      'completed': 'PDF generation completed successfully',
      'failed': `PDF generation failed: ${jobStatus.failedReason || 'Unknown error'}`,
      'delayed': 'PDF generation is delayed',
      'paused': 'PDF generation is paused'
    };
    
    return messages[jobStatus.status] || 'Unknown status';
  }

  /**
   * Cleanup old PDF records (maintenance task)
   * @route POST /api/v1/leases/contracts/cleanup
   */
  async cleanupOldRecords(req, res) {
    try {
      const { daysOld = 30 } = req.body;
      
      console.log(`[LeaseContractController] Cleaning up PDF records older than ${daysOld} days`);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const cutoffIso = cutoffDate.toISOString();
      
      // Delete old failed records
      const deletedFailed = this.database.db.prepare(`
        DELETE FROM lease_pdf_records 
        WHERE status = 'failed' AND updated_at < ?
      `).run(cutoffIso);
      
      // Delete old completed records (optional - you might want to keep these)
      const deletedCompleted = this.database.db.prepare(`
        DELETE FROM lease_pdf_records 
        WHERE status = 'completed' AND updated_at < ?
      `).run(cutoffIso);
      
      return res.status(200).json({
        success: true,
        message: 'Cleanup completed',
        data: {
          deletedFailedRecords: deletedFailed.changes,
          deletedCompletedRecords: deletedCompleted.changes,
          cutoffDate: cutoffIso
        }
      });
      
    } catch (error) {
      console.error('[LeaseContractController] Error during cleanup:', error);
      return res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * Initialize the controller (start worker, etc.)
   */
  initialize() {
    this.pdfJob.start();
    console.log('[LeaseContractController] Initialized');
  }

  /**
   * Shutdown the controller
   */
  async shutdown() {
    await this.pdfJob.stop();
    console.log('[LeaseContractController] Shutdown complete');
  }
}

module.exports = LeaseContractController;
