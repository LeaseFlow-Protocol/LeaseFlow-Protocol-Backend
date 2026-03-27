const { VendorService } = require('../services/vendorService');

class VendorController {
  constructor(vendorService) {
    this.vendorService = vendorService;
  }

  // ==================== Vendor Registration & Management ====================

  /**
   * Register a new vendor
   */
  async registerVendor(req, res) {
    try {
      const vendorData = req.body;
      
      // Validate required fields
      if (!vendorData.name || !vendorData.email) {
        return res.status(400).json({
          success: false,
          error: 'Name and email are required'
        });
      }

      // Check if vendor already exists
      const existingVendor = this.vendorService.getVendorByEmail(vendorData.email);
      if (existingVendor) {
        return res.status(409).json({
          success: false,
          error: 'Vendor with this email already exists'
        });
      }

      const vendor = this.vendorService.registerVendor(vendorData);
      
      res.status(201).json({
        success: true,
        message: 'Vendor registered successfully',
        data: vendor
      });
    } catch (error) {
      console.error('[VendorController] Error registering vendor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to register vendor',
        details: error.message
      });
    }
  }

  /**
   * Get vendor profile
   */
  async getVendorProfile(req, res) {
    try {
      const { vendorId } = req.params;
      const vendor = this.vendorService.getVendorById(vendorId);

      if (!vendor) {
        return res.status(404).json({
          success: false,
          error: 'Vendor not found'
        });
      }

      res.status(200).json({
        success: true,
        data: vendor
      });
    } catch (error) {
      console.error('[VendorController] Error fetching vendor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch vendor',
        details: error.message
      });
    }
  }

  // ==================== Maintenance Ticket Management ====================

  /**
   * Create maintenance ticket
   */
  async createMaintenanceTicket(req, res) {
    try {
      const ticketData = req.body;
      
      // Validate required fields
      if (!ticketData.leaseId || !ticketData.title || !ticketData.description || !ticketData.category) {
        return res.status(400).json({
          success: false,
          error: 'Lease ID, title, description, and category are required'
        });
      }

      const ticket = this.vendorService.createMaintenanceTicket(ticketData);
      
      res.status(201).json({
        success: true,
        message: 'Maintenance ticket created successfully',
        data: ticket
      });
    } catch (error) {
      console.error('[VendorController] Error creating maintenance ticket:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create maintenance ticket',
        details: error.message
      });
    }
  }

  /**
   * Get maintenance tickets for a lease
   */
  async getMaintenanceTickets(req, res) {
    try {
      const { leaseId } = req.params;
      const tickets = this.vendorService.getMaintenanceTicketsByLeaseId(leaseId);

      res.status(200).json({
        success: true,
        data: tickets
      });
    } catch (error) {
      console.error('[VendorController] Error fetching maintenance tickets:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch maintenance tickets',
        details: error.message
      });
    }
  }

  /**
   * Update maintenance ticket status
   */
  async updateTicketStatus(req, res) {
    try {
      const { ticketId } = req.params;
      const { status, ...updates } = req.body;

      if (!status) {
        return res.status(400).json({
          success: false,
          error: 'Status is required'
        });
      }

      const ticket = this.vendorService.updateMaintenanceTicketStatus(ticketId, status, updates);
      
      res.status(200).json({
        success: true,
        message: `Ticket ${status} successfully`,
        data: ticket
      });
    } catch (error) {
      console.error('[VendorController] Error updating ticket status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update ticket status',
        details: error.message
      });
    }
  }

  /**
   * Assign vendor to ticket
   */
  async assignVendor(req, res) {
    try {
      const { ticketId } = req.params;
      const { vendorId } = req.body;

      if (!vendorId) {
        return res.status(400).json({
          success: false,
          error: 'Vendor ID is required'
        });
      }

      const ticket = this.vendorService.assignVendorToTicket(ticketId, vendorId);
      
      res.status(200).json({
        success: true,
        message: 'Vendor assigned successfully',
        data: ticket
      });
    } catch (error) {
      console.error('[VendorController] Error assigning vendor:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to assign vendor',
        details: error.message
      });
    }
  }

  /**
   * Add repair photos
   */
  async addRepairPhotos(req, res) {
    try {
      const { ticketId } = req.params;
      const { photos } = req.body;

      if (!photos || !Array.isArray(photos)) {
        return res.status(400).json({
          success: false,
          error: 'Photos array is required'
        });
      }

      const ticket = this.vendorService.addRepairPhotos(ticketId, photos);
      
      res.status(200).json({
        success: true,
        message: 'Repair photos added successfully',
        data: ticket
      });
    } catch (error) {
      console.error('[VendorController] Error adding repair photos:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add repair photos',
        details: error.message
      });
    }
  }

  // ==================== Vendor Access Management ====================

  /**
   * Grant access to vendor
   */
  async grantAccess(req, res) {
    try {
      const grantData = req.body;
      
      // Validate required fields
      if (!grantData.vendorId || !grantData.leaseId || !grantData.maintenanceTicketId || !grantData.grantedBy) {
        return res.status(400).json({
          success: false,
          error: 'Vendor ID, Lease ID, Maintenance Ticket ID, and Granted By are required'
        });
      }

      const grant = this.vendorService.grantVendorAccess(grantData);
      
      res.status(201).json({
        success: true,
        message: 'Access granted successfully',
        data: grant
      });
    } catch (error) {
      console.error('[VendorController] Error granting access:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to grant access',
        details: error.message
      });
    }
  }

  /**
   * Get active grants for vendor
   */
  async getVendorGrants(req, res) {
    try {
      const { vendorId } = req.params;
      const grants = this.vendorService.getActiveAccessGrantsForVendor(vendorId);

      res.status(200).json({
        success: true,
        data: grants
      });
    } catch (error) {
      console.error('[VendorController] Error fetching vendor grants:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch vendor grants',
        details: error.message
      });
    }
  }

  /**
   * Revoke vendor access
   */
  async revokeAccess(req, res) {
    try {
      const { grantId } = req.params;
      const { reason } = req.body;

      const grant = this.vendorService.revokeVendorAccess(grantId, reason);
      
      res.status(200).json({
        success: true,
        message: 'Access revoked successfully',
        data: grant
      });
    } catch (error) {
      console.error('[VendorController] Error revoking access:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to revoke access',
        details: error.message
      });
    }
  }

  /**
   * Get accessible data for vendor
   */
  async getAccessibleData(req, res) {
    try {
      const { vendorId, leaseId } = req.params;
      const data = this.vendorService.getVendorAccessibleData(vendorId, leaseId);

      res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      console.error('[VendorController] Error fetching accessible data:', error);
      res.status(error.message === 'Vendor does not have access to this lease' ? 403 : 500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Record vendor access (audit trail)
   */
  async recordAccess(req, res) {
    try {
      const { accessGrantId, vendorId, leaseId, action, resourceAccessed } = req.body;
      
      const log = this.vendorService.recordVendorAccess(
        accessGrantId, 
        vendorId, 
        leaseId, 
        action, 
        resourceAccessed,
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      );

      res.status(200).json({
        success: true,
        data: log
      });
    } catch (error) {
      console.error('[VendorController] Error recording access:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to record access',
        details: error.message
      });
    }
  }

  /**
   * Close maintenance ticket and revoke all associated access
   */
  async closeTicketAndRevokeAccess(req, res) {
    try {
      const { ticketId } = req.params;
      const { repairPhotos } = req.body;

      // Add repair photos if provided
      if (repairPhotos && Array.isArray(repairPhotos)) {
        this.vendorService.addRepairPhotos(ticketId, repairPhotos);
      }

      // Close the ticket
      const ticket = this.vendorService.updateMaintenanceTicketStatus(ticketId, 'closed');

      // Revoke all access grants for this ticket
      const revokedGrants = this.vendorService.revokeAccessForClosedTicket(ticketId);

      res.status(200).json({
        success: true,
        message: 'Ticket closed and all vendor access revoked',
        data: {
          ticket,
          revokedGrantsCount: revokedGrants.length
        }
      });
    } catch (error) {
      console.error('[VendorController] Error closing ticket:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to close ticket and revoke access',
        details: error.message
      });
    }
  }
}

module.exports = { VendorController };
