const { RentEscrowService } = require('../services/rentEscrowService');

class RentEscrowController {
  constructor(rentEscrowService) {
    this.rentEscrowService = rentEscrowService;
  }

  // ==================== Escrow Management ====================

  /**
   * Create rent escrow (withhold disputed amount)
   */
  async createEscrow(req, res) {
    try {
      const escrowData = req.body;
      
      if (!escrowData.leaseId || !escrowData.maintenanceTicketId || 
          !escrowData.tenantId || !escrowData.landlordId || !escrowData.disputedAmount) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID, Maintenance Ticket ID, Tenant ID, Landlord ID, and Disputed Amount are required'
        });
      }

      const escrow = this.rentEscrowService.createEscrow(escrowData);
      
      res.status(201).json({
        success: true,
        message: 'Rent escrow created successfully',
        data: escrow
      });
    } catch (error) {
      console.error('[RentEscrowController] Error creating escrow:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Get escrow by ID
   */
  async getEscrow(req, res) {
    try {
      const { escrowId } = req.params;
      const escrow = this.rentEscrowService.getEscrowById(escrowId);

      if (!escrow) {
        return res.status(404).json({
          success: false,
          error: 'Escrow not found'
        });
      }

      res.status(200).json({
        success: true,
        data: escrow
      });
    } catch (error) {
      console.error('[RentEscrowController] Error fetching escrow:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch escrow',
        details: error.message
      });
    }
  }

  /**
   * Get escrows by lease
   */
  async getLeaseEscrows(req, res) {
    try {
      const { leaseId } = req.params;
      const escrows = this.rentEscrowService.getEscrowsByLeaseId(leaseId);

      res.status(200).json({
        success: true,
        data: escrows
      });
    } catch (error) {
      console.error('[RentEscrowController] Error fetching lease escrows:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch escrows',
        details: error.message
      });
    }
  }

  // ==================== Repair Verification Workflow ====================

  /**
   * Upload repair photos
   */
  async uploadRepairPhotos(req, res) {
    try {
      const { verificationId } = req.params;
      const { photos, repairDescription } = req.body;

      if (!photos || !Array.isArray(photos)) {
        return res.status(400).json({
          success: false,
          error: 'Photos array is required'
        });
      }

      const verification = this.rentEscrowService.uploadRepairPhotos(verificationId, photos, repairDescription);
      
      res.status(200).json({
        success: true,
        message: 'Repair photos uploaded successfully',
        data: verification
      });
    } catch (error) {
      console.error('[RentEscrowController] Error uploading repair photos:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to upload repair photos',
        details: error.message
      });
    }
  }

  /**
   * Tenant confirms repairs
   */
  async confirmRepairs(req, res) {
    try {
      const { verificationId } = req.params;
      const { feedback } = req.body;

      const verification = this.rentEscrowService.tenantConfirmRepairs(verificationId, feedback);
      
      res.status(200).json({
        success: true,
        message: 'Repairs confirmed - escrow will be released to landlord',
        data: verification
      });
    } catch (error) {
      console.error('[RentEscrowController] Error confirming repairs:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Tenant rejects repairs
   */
  async rejectRepairs(req, res) {
    try {
      const { verificationId } = req.params;
      const { feedback } = req.body;

      if (!feedback) {
        return res.status(400).json({
          success: false,
          error: 'Feedback is required when rejecting repairs'
        });
      }

      const verification = this.rentEscrowService.tenantRejectRepairs(verificationId, feedback);
      
      res.status(200).json({
        success: true,
        message: 'Repairs rejected - escrow remains active',
        data: verification
      });
    } catch (error) {
      console.error('[RentEscrowController] Error rejecting repairs:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  // ==================== Escrow Release ====================

  /**
   * Release escrow to landlord
   */
  async releaseToLandlord(req, res) {
    try {
      const { escrowId } = req.params;
      const { reason } = req.body;

      const result = this.rentEscrowService.releaseEscrowToLandlord(escrowId, reason);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      console.error('[RentEscrowController] Error releasing to landlord:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Return escrow to tenant
   */
  async returnToTenant(req, res) {
    try {
      const { escrowId } = req.params;
      const { reason } = req.body;

      const result = this.rentEscrowService.returnEscrowToTenant(escrowId, reason);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      console.error('[RentEscrowController] Error returning to tenant:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Split escrow between parties
   */
  async splitEscrow(req, res) {
    try {
      const { escrowId } = req.params;
      const { landlordPercentage, reason } = req.body;

      if (landlordPercentage === undefined || landlordPercentage < 0 || landlordPercentage > 100) {
        return res.status(400).json({
          success: false,
          error: 'Landlord percentage (0-100) is required'
        });
      }

      const result = this.rentEscrowService.splitEscrow(escrowId, landlordPercentage, reason);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      console.error('[RentEscrowController] Error splitting escrow:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  /**
   * Cancel escrow
   */
  async cancelEscrow(req, res) {
    try {
      const { escrowId } = req.params;
      const { reason } = req.body;

      const result = this.rentEscrowService.cancelEscrow(escrowId, reason);
      
      res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });
    } catch (error) {
      console.error('[RentEscrowController] Error cancelling escrow:', error);
      res.status(400).json({
        success: false,
        error: error.message,
        details: error.message
      });
    }
  }

  // ==================== Automation ====================

  /**
   * Trigger auto-release of expired verifications
   */
  async triggerAutoRelease(req, res) {
    try {
      const result = this.rentEscrowService.autoReleaseExpiredVerifications();
      
      res.status(200).json({
        success: true,
        message: `Auto-released ${result.count} escrows`,
        data: result
      });
    } catch (error) {
      console.error('[RentEscrowController] Error triggering auto-release:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to trigger auto-release',
        details: error.message
      });
    }
  }

  /**
   * Get transaction history for escrow
   */
  async getTransactions(req, res) {
    try {
      const { escrowId } = req.params;
      const transactions = this.rentEscrowService.getTransactionsByEscrowId(escrowId);

      res.status(200).json({
        success: true,
        data: transactions
      });
    } catch (error) {
      console.error('[RentEscrowController] Error fetching transactions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch transactions',
        details: error.message
      });
    }
  }
}

module.exports = { RentEscrowController };
