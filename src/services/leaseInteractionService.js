const { AppDatabase } = require('../db/appDatabase');

/**
 * Service to handle lease interactions and automatically reset abandonment timers
 * This service should be called whenever a lessee interacts with the protocol
 */
class LeaseInteractionService {
  constructor(database) {
    this.db = database;
  }

  /**
   * Record a lease interaction and reset abandonment timer
   * @param {string} leaseId - The lease ID
   * @param {string} interactionType - Type of interaction (payment, communication, etc.)
   * @param {string} actorId - ID of the actor performing the interaction
   * @param {string} actorRole - Role of the actor (tenant, landlord, system)
   * @returns {boolean} True if successful
   */
  recordInteraction(leaseId, interactionType, actorId, actorRole) {
    try {
      // Update last_interaction_timestamp
      const updateStmt = this.db.db.prepare(`
        UPDATE leases 
        SET last_interaction_timestamp = datetime('now'),
            abandonment_status = 'active',
            abandonment_alert_sent = 0,
            updated_at = datetime('now')
        WHERE id = ?
      `);
      
      const result = updateStmt.run(leaseId);
      
      if (result.changes > 0) {
        console.log(`Lease interaction recorded: ${leaseId} - ${interactionType} by ${actorRole}:${actorId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error recording lease interaction for ${leaseId}:`, error);
      return false;
    }
  }

  /**
   * Record payment interaction (most common lessee interaction)
   * @param {string} leaseId - The lease ID
   * @param {string} tenantId - The tenant ID making the payment
   * @param {number} amount - Payment amount
   * @param {string} currency - Payment currency
   * @returns {boolean} True if successful
   */
  recordPaymentInteraction(leaseId, tenantId, amount, currency) {
    return this.recordInteraction(leaseId, 'payment', tenantId, 'tenant');
  }

  /**
   * Record communication interaction
   * @param {string} leaseId - The lease ID
   * @param {string} actorId - ID of the actor communicating
   * @param {string} actorRole - Role of the actor
   * @param {string} message - Optional message content
   * @returns {boolean} True if successful
   */
  recordCommunicationInteraction(leaseId, actorId, actorRole, message = '') {
    return this.recordInteraction(leaseId, 'communication', actorId, actorRole);
  }

  /**
   * Record maintenance request interaction
   * @param {string} leaseId - The lease ID
   * @param {string} tenantId - The tenant ID making the request
   * @param {string} description - Maintenance description
   * @returns {boolean} True if successful
   */
  recordMaintenanceInteraction(leaseId, tenantId, description) {
    return this.recordInteraction(leaseId, 'maintenance_request', tenantId, 'tenant');
  }

  /**
   * Record document upload interaction
   * @param {string} leaseId - The lease ID
   * @param {string} actorId - ID of the actor uploading
   * @param {string} actorRole - Role of the actor
   * @param {string} documentType - Type of document
   * @returns {boolean} True if successful
   */
  recordDocumentInteraction(leaseId, actorId, actorRole, documentType) {
    return this.recordInteraction(leaseId, 'document_upload', actorId, actorRole);
  }

  /**
   * Check if lease is eligible for abandonment tracking
   * @param {string} leaseId - The lease ID
   * @returns {boolean} True if eligible for tracking
   */
  isEligibleForTracking(leaseId) {
    try {
      const lease = this.db.db.prepare(`
        SELECT status, abandonment_status 
        FROM leases 
        WHERE id = ?
      `).get(leaseId);
      
      if (!lease) return false;
      
      return lease.status === 'expired' || lease.status === 'terminated';
    } catch (error) {
      console.error(`Error checking tracking eligibility for ${leaseId}:`, error);
      return false;
    }
  }

  /**
   * Get interaction history for a lease
   * @param {string} leaseId - The lease ID
   * @param {number} limit - Maximum number of records to return
   * @returns {Array} Array of interaction records
   */
  getInteractionHistory(leaseId, limit = 10) {
    try {
      // This would require an interaction_history table in a full implementation
      // For now, return the current lease state
      const lease = this.db.db.prepare(`
        SELECT 
          id,
          last_interaction_timestamp,
          abandonment_status,
          abandonment_alert_sent,
          updated_at
        FROM leases 
        WHERE id = ?
      `).get(leaseId);
      
      return lease ? [lease] : [];
    } catch (error) {
      console.error(`Error getting interaction history for ${leaseId}:`, error);
      return [];
    }
  }
}

module.exports = { LeaseInteractionService };
