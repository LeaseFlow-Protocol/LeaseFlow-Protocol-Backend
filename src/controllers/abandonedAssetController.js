const { AbandonedAssetTracker } = require('../services/abandonedAssetTracker');

/**
 * Controller for abandoned asset tracking endpoints
 */
class AbandonedAssetController {
  constructor(database, notificationService) {
    this.tracker = new AbandonedAssetTracker(database, notificationService);
  }

  /**
   * GET /api/v1/leases/abandoned
   * Get all abandoned assets with countdown timers
   */
  async getAbandonedAssets(req, res) {
    try {
      const { landlord_id, status, page = 1, limit = 50 } = req.query;
      
      let abandonedAssets = this.tracker.getAbandonedAssetsData();
      
      // Filter by landlord_id if provided
      if (landlord_id) {
        abandonedAssets = abandonedAssets.filter(asset => asset.landlord_id === landlord_id);
      }
      
      // Filter by status if provided
      if (status) {
        abandonedAssets = abandonedAssets.filter(asset => asset.abandonment_status === status);
      }
      
      // Pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + parseInt(limit);
      const paginatedAssets = abandonedAssets.slice(startIndex, endIndex);
      
      // Summary statistics
      const summary = {
        total_abandoned_assets: abandonedAssets.length,
        assets_ready_for_seizure: abandonedAssets.filter(asset => asset.countdown.is_ready_for_seizure).length,
        assets_pending_seizure: abandonedAssets.filter(asset => asset.abandonment_status === 'pending_seizure').length,
        assets_active_tracking: abandonedAssets.filter(asset => asset.abandonment_status === 'active').length
      };
      
      res.json({
        success: true,
        data: {
          assets: paginatedAssets,
          pagination: {
            current_page: parseInt(page),
            per_page: parseInt(limit),
            total_items: abandonedAssets.length,
            total_pages: Math.ceil(abandonedAssets.length / limit)
          },
          summary,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error fetching abandoned assets:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch abandoned assets'
      });
    }
  }

  /**
   * GET /api/v1/leases/abandoned/:leaseId
   * Get specific abandoned asset details
   */
  async getAbandonedAssetById(req, res) {
    try {
      const { leaseId } = req.params;
      
      const abandonedAssets = this.tracker.getAbandonedAssetsData();
      const asset = abandonedAssets.find(a => a.lease_id === leaseId);
      
      if (!asset) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'Abandoned asset not found'
        });
      }
      
      res.json({
        success: true,
        data: asset,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching abandoned asset:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch abandoned asset'
      });
    }
  }

  /**
   * POST /api/v1/leases/abandoned/:leaseId/reset-timer
   * Reset abandonment timer when lessee interacts
   */
  async resetAbandonmentTimer(req, res) {
    try {
      const { leaseId } = req.params;
      const { interaction_type } = req.body; // Optional: type of interaction
      
      const success = this.tracker.resetAbandonmentTimer(leaseId);
      
      if (!success) {
        return res.status(404).json({
          success: false,
          error: 'Not found',
          message: 'Lease not found or update failed'
        });
      }
      
      res.json({
        success: true,
        message: 'Abandonment timer reset successfully',
        data: {
          lease_id: leaseId,
          interaction_type,
          reset_timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error resetting abandonment timer:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to reset abandonment timer'
      });
    }
  }

  /**
   * GET /api/v1/leases/abandoned/summary
   * Get summary statistics for abandoned assets
   */
  async getAbandonedAssetsSummary(req, res) {
    try {
      const { landlord_id } = req.query;
      
      let abandonedAssets = this.tracker.getAbandonedAssetsData();
      
      // Filter by landlord_id if provided
      if (landlord_id) {
        abandonedAssets = abandonedAssets.filter(asset => asset.landlord_id === landlord_id);
      }
      
      const summary = {
        total_abandoned_assets: abandonedAssets.length,
        assets_ready_for_seizure: abandonedAssets.filter(asset => asset.countdown.is_ready_for_seizure).length,
        assets_pending_seizure: abandonedAssets.filter(asset => asset.abandonment_status === 'pending_seizure').length,
        assets_active_tracking: abandonedAssets.filter(asset => asset.abandonment_status === 'active').length,
        assets_with_alerts_sent: abandonedAssets.filter(asset => asset.abandonment_status === 'pending_seizure' && asset.countdown.is_ready_for_seizure).length,
        average_days_abandoned: abandonedAssets.length > 0 
          ? Math.round(abandonedAssets.reduce((sum, asset) => sum + asset.countdown.days_since_interaction, 0) / abandonedAssets.length)
          : 0,
        next_seizure_alerts: abandonedAssets
          .filter(asset => !asset.countdown.is_ready_for_seizure && asset.countdown.remaining_days <= 1)
          .map(asset => ({
            lease_id: asset.lease_id,
            hours_until_seizure: Math.floor(asset.countdown.remaining_hours + (asset.countdown.remaining_days * 24)),
            landlord_id: asset.landlord_id
          }))
      };
      
      res.json({
        success: true,
        data: summary,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error fetching abandoned assets summary:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to fetch abandoned assets summary'
      });
    }
  }

  /**
   * POST /api/v1/leases/abandoned/run-tracking
   * Manually trigger the abandoned asset tracking process (admin only)
   */
  async runTrackingManually(req, res) {
    try {
      const results = await this.tracker.runTrackingProcess();
      
      res.json({
        success: true,
        message: 'Abandoned asset tracking completed',
        data: results
      });
    } catch (error) {
      console.error('Error running abandoned asset tracking:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'Failed to run abandoned asset tracking'
      });
    }
  }
}

module.exports = { AbandonedAssetController };
