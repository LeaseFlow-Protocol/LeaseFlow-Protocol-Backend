const { AppDatabase } = require('../db/appDatabase');
const { NotificationService } = require('./notificationService');

/**
 * Service for tracking abandoned assets and managing 30-day countdown to seizure
 */
class AbandonedAssetTracker {
  constructor(database, notificationService) {
    this.db = database;
    this.notificationService = notificationService;
  }

  /**
   * Calculate precise time difference accounting for leap years and month variations
   * @param {string} lastInteractionTimestamp - ISO timestamp of last interaction
   * @returns {Object} Object with days, hours, minutes, seconds remaining
   */
  calculatePreciseTimeDifference(lastInteractionTimestamp) {
    const lastInteraction = new Date(lastInteractionTimestamp);
    const now = new Date();
    
    // Calculate exact difference in milliseconds
    const diffMs = now - lastInteraction;
    
    // Convert to days, accounting for exact time (not just calendar days)
    const daysSinceInteraction = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hoursSinceInteraction = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutesSinceInteraction = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const secondsSinceInteraction = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    // Calculate remaining time until 30-day threshold
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const remainingMs = Math.max(0, thirtyDaysInMs - diffMs);
    
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
    const remainingSeconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
    
    return {
      daysSinceInteraction,
      hoursSinceInteraction,
      minutesSinceInteraction,
      secondsSinceInteraction,
      remainingDays,
      remainingHours,
      remainingMinutes,
      remainingSeconds,
      totalSecondsSinceInteraction: Math.floor(diffMs / 1000),
      totalSecondsRemaining: Math.floor(remainingMs / 1000),
      isReadyForSeizure: remainingMs <= 0,
      exactTimeToSeizure: new Date(lastInteraction.getTime() + thirtyDaysInMs)
    };
  }

  /**
   * Get all expired leases that need abandonment tracking
   * @returns {Array} Array of lease objects with abandonment data
   */
  getExpiredLeasesForTracking() {
    const query = `
      SELECT 
        id,
        landlord_id,
        tenant_id,
        status,
        rent_amount,
        currency,
        end_date,
        last_interaction_timestamp,
        abandonment_status,
        abandonment_alert_sent,
        created_at,
        updated_at
      FROM leases
      WHERE status IN ('expired', 'terminated')
        AND abandonment_status != 'seized'
      ORDER BY last_interaction_timestamp ASC
    `;
    
    try {
      const stmt = this.db.db.prepare(query);
      const leases = stmt.all();
      
      // Add calculated time data to each lease
      return leases.map(lease => {
        const timeData = lease.last_interaction_timestamp 
          ? this.calculatePreciseTimeDifference(lease.last_interaction_timestamp)
          : {
              daysSinceInteraction: 0,
              remainingDays: 30,
              isReadyForSeizure: false,
              exactTimeToSeizure: new Date()
            };
        
        return {
          ...lease,
          ...timeData
        };
      });
    } catch (error) {
      console.error('Error fetching expired leases for tracking:', error);
      return [];
    }
  }

  /**
   * Update abandonment status for leases that have reached 30-day threshold
   * @returns {Array} Array of updated lease IDs
   */
  updateLeasesReadyForSeizure() {
    const leases = this.getExpiredLeasesForTracking();
    const readyLeases = leases.filter(lease => lease.isReadyForSeizure && lease.abandonment_status !== 'pending_seizure');
    const updatedLeases = [];
    
    for (const lease of readyLeases) {
      try {
        const updateStmt = this.db.db.prepare(`
          UPDATE leases 
          SET abandonment_status = 'pending_seizure',
              updated_at = datetime('now')
          WHERE id = ?
        `);
        
        updateStmt.run(lease.id);
        updatedLeases.push(lease.id);
      } catch (error) {
        console.error(`Error updating lease ${lease.id} for seizure:`, error);
      }
    }
    
    return updatedLeases;
  }

  /**
   * Send seizure alerts to lessors for leases ready for seizure
   * @returns {Array} Array of lease IDs that were alerted
   */
  async sendSeizureAlerts() {
    const query = `
      SELECT 
        id,
        landlord_id,
        tenant_id,
        rent_amount,
        currency,
        end_date,
        last_interaction_timestamp,
        exactTimeToSeizure
      FROM leases
      WHERE abandonment_status = 'pending_seizure'
        AND abandonment_alert_sent = 0
    `;
    
    try {
      const stmt = this.db.db.prepare(query);
      const leasesToAlert = stmt.all();
      const alertedLeases = [];
      
      for (const lease of leasesToAlert) {
        const timeData = this.calculatePreciseTimeDifference(lease.last_interaction_timestamp);
        
        // Send notification to lessor
        await this.notificationService.sendNotification({
          recipient_id: lease.landlord_id,
          recipient_role: 'landlord',
          type: 'asset_ready_for_seizure',
          lease_id: lease.id,
          message: `Asset Ready for Seizure: Lease ${lease.id} has been abandoned for 30+ days. Legal seizure rights are now available.`,
          metadata: {
            lease_id: lease.id,
            tenant_id: lease.tenant_id,
            rent_amount: lease.rent_amount,
            currency: lease.currency,
            days_abandoned: timeData.daysSinceInteraction,
            exact_abandonment_time: timeData.exactTimeToSeizure.toISOString()
          }
        });
        
        // Mark alert as sent
        const updateStmt = this.db.db.prepare(`
          UPDATE leases 
          SET abandonment_alert_sent = 1,
              updated_at = datetime('now')
          WHERE id = ?
        `);
        
        updateStmt.run(lease.id);
        alertedLeases.push(lease.id);
      }
      
      return alertedLeases;
    } catch (error) {
      console.error('Error sending seizure alerts:', error);
      return [];
    }
  }

  /**
   * Reset abandonment timer when lessee interacts with the protocol
   * @param {string} leaseId - The lease ID to reset
   * @returns {boolean} True if successful, false otherwise
   */
  resetAbandonmentTimer(leaseId) {
    try {
      const updateStmt = this.db.db.prepare(`
        UPDATE leases 
        SET last_interaction_timestamp = datetime('now'),
            abandonment_status = 'active',
            abandonment_alert_sent = 0,
            updated_at = datetime('now')
        WHERE id = ?
      `);
      
      const result = updateStmt.run(leaseId);
      return result.changes > 0;
    } catch (error) {
      console.error(`Error resetting abandonment timer for lease ${leaseId}:`, error);
      return false;
    }
  }

  /**
   * Get abandoned assets data for the API endpoint
   * @returns {Array} Array of abandoned assets with countdown data
   */
  getAbandonedAssetsData() {
    const leases = this.getExpiredLeasesForTracking();
    
    return leases.map(lease => ({
      lease_id: lease.id,
      landlord_id: lease.landlord_id,
      tenant_id: lease.tenant_id,
      status: lease.status,
      rent_amount: lease.rent_amount,
      currency: lease.currency,
      end_date: lease.end_date,
      abandonment_status: lease.abandonment_status,
      last_interaction_timestamp: lease.last_interaction_timestamp,
      countdown: {
        days_since_interaction: lease.daysSinceInteraction,
        remaining_days: lease.remainingDays,
        remaining_hours: lease.remainingHours,
        remaining_minutes: lease.remainingMinutes,
        remaining_seconds: lease.remainingSeconds,
        total_seconds_remaining: lease.totalSecondsRemaining,
        is_ready_for_seizure: lease.isReadyForSeizure,
        exact_time_to_seizure: lease.exactTimeToSeizure.toISOString()
      }
    }));
  }

  /**
   * Run the complete abandoned asset tracking process
   * @returns {Object} Summary of tracking results
   */
  async runTrackingProcess() {
    console.log('Starting abandoned asset tracking process...');
    
    // Update leases ready for seizure
    const updatedLeases = this.updateLeasesReadyForSeizure();
    console.log(`Updated ${updatedLeases.length} leases for seizure readiness`);
    
    // Send seizure alerts
    const alertedLeases = await this.sendSeizureAlerts();
    console.log(`Sent seizure alerts for ${alertedLeases.length} leases`);
    
    // Get current abandoned assets data
    const abandonedAssets = this.getAbandonedAssetsData();
    
    return {
      timestamp: new Date().toISOString(),
      leases_updated_for_seizure: updatedLeases,
      seizure_alerts_sent: alertedLeases,
      total_abandoned_assets_tracked: abandonedAssets.length,
      assets_ready_for_seizure: abandonedAssets.filter(asset => asset.countdown.is_ready_for_seizure).length,
      assets_pending_seizure: abandonedAssets.filter(asset => asset.abandonment_status === 'pending_seizure').length
    };
  }
}

module.exports = { AbandonedAssetTracker };
