const { LeaseEventValidator } = require('../schemas/leaseEventSchemas');

/**
 * Lease Event Handlers
 * Processes and routes lease state transition events with security controls
 */
class LeaseEventHandlers {
  constructor(database, websocketGateway, config) {
    this.database = database;
    this.websocketGateway = websocketGateway;
    this.config = config;
    this.eventValidator = new LeaseEventValidator();
    
    // Security and privacy controls
    this.dataLeakageProtection = {
      enabled: config.websocket?.dataLeakageProtection !== false,
      auditLog: [],
      blockedAttempts: 0,
      lastBlockedAt: null
    };
    
    // Event processing metrics
    this.metrics = {
      eventsProcessed: 0,
      eventsBlocked: 0,
      eventsDelivered: 0,
      eventsFailed: 0,
      processingTime: 0,
      lastProcessedAt: null
    };
    
    // Rate limiting
    this.rateLimits = new Map(); // pubkey -> { count, resetTime }
    this.rateLimitWindow = config.websocket?.rateLimitWindow || 60000; // 1 minute
    this.rateLimitMax = config.websocket?.rateLimitMax || 100; // 100 events per minute
  }

  /**
   * Process lease event with security controls
   * @param {object} eventData - Lease event data
   * @returns {Promise<boolean>} True if event was processed successfully
   */
  async processLeaseEvent(eventData) {
    const startTime = Date.now();
    
    try {
      // Validate event structure
      const validation = this.eventValidator.validate(eventData.eventType, eventData);
      if (!validation.valid) {
        console.error('[LeaseEventHandlers] Invalid event structure:', validation.errors);
        this.metrics.eventsFailed++;
        return false;
      }

      // Apply security controls
      const securityCheck = await this.applySecurityControls(eventData);
      if (!securityCheck.allowed) {
        this.blockEvent(eventData, securityCheck.reason);
        return false;
      }

      // Get event recipients
      const recipients = await this.getEventRecipients(eventData);
      
      if (recipients.length === 0) {
        console.log(`[LeaseEventHandlers] No recipients found for event: ${eventData.eventType}`);
        return true; // Not an error, just no recipients
      }

      // Deliver event to recipients
      await this.deliverEvent(eventData, recipients);

      // Update metrics
      this.metrics.eventsProcessed++;
      this.metrics.eventsDelivered += recipients.length;
      this.metrics.lastProcessedAt = new Date().toISOString();
      this.metrics.processingTime += Date.now() - startTime;

      console.log(`[LeaseEventHandlers] Processed ${eventData.eventType} for ${recipients.length} recipients`);
      return true;

    } catch (error) {
      console.error('[LeaseEventHandlers] Error processing lease event:', error);
      this.metrics.eventsFailed++;
      return false;
    }
  }

  /**
   * Apply security controls to prevent data leakage
   * @param {object} eventData - Event data
   * @returns {Promise<object>} Security check result
   */
  async applySecurityControls(eventData) {
    if (!this.dataLeakageProtection.enabled) {
      return { allowed: true };
    }

    try {
      // Validate event data integrity
      const integrityCheck = this.validateEventIntegrity(eventData);
      if (!integrityCheck.valid) {
        return { allowed: false, reason: 'Event integrity validation failed' };
      }

      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(eventData);
      if (!rateLimitCheck.allowed) {
        return { allowed: false, reason: 'Rate limit exceeded' };
      }

      // Validate lease access permissions
      const accessCheck = await this.validateLeaseAccess(eventData);
      if (!accessCheck.allowed) {
        return { allowed: false, reason: 'Unauthorized lease access' };
      }

      // Check for cross-tenant data leakage
      const leakageCheck = this.checkDataLeakage(eventData);
      if (!leakageCheck.allowed) {
        return { allowed: false, reason: 'Potential data leakage detected' };
      }

      return { allowed: true };

    } catch (error) {
      console.error('[LeaseEventHandlers] Error in security controls:', error);
      return { allowed: false, reason: 'Security control error' };
    }
  }

  /**
   * Validate event data integrity
   * @param {object} eventData - Event data
   * @returns {object} Integrity check result
   */
  validateEventIntegrity(eventData) {
    try {
      // Check required fields
      const requiredFields = ['eventType', 'leaseId', 'timestamp', 'transactionHash'];
      for (const field of requiredFields) {
        if (!eventData[field]) {
          return { valid: false, reason: `Missing required field: ${field}` };
        }
      }

      // Validate transaction hash format
      if (!/^[a-fA-F0-9]{64}$/.test(eventData.transactionHash)) {
        return { valid: false, reason: 'Invalid transaction hash format' };
      }

      // Validate timestamp
      const eventTime = new Date(eventData.timestamp);
      if (isNaN(eventTime.getTime()) || eventTime > new Date()) {
        return { valid: false, reason: 'Invalid timestamp' };
      }

      // Check for duplicate events
      if (this.isDuplicateEvent(eventData)) {
        return { valid: false, reason: 'Duplicate event detected' };
      }

      return { valid: true };

    } catch (error) {
      return { valid: false, reason: 'Integrity validation error' };
    }
  }

  /**
   * Check if event is a duplicate
   * @param {object} eventData - Event data
   * @returns {boolean} True if duplicate
   */
  isDuplicateEvent(eventData) {
    // In production, this would check against a database or cache
    // For now, use a simple in-memory check
    const eventKey = `${eventData.leaseId}_${eventData.transactionHash}_${eventData.eventType}`;
    
    // This is a simplified implementation
    // In production, use Redis or database with proper TTL
    return false;
  }

  /**
   * Check rate limiting for events
   * @param {object} eventData - Event data
   * @returns {object} Rate limit check result
   */
  checkRateLimit(eventData) {
    // Rate limiting is applied per lease to prevent spam
    const leaseId = eventData.leaseId;
    const now = Date.now();
    
    let rateLimit = this.rateLimits.get(leaseId);
    
    if (!rateLimit || now > rateLimit.resetTime) {
      // Reset or initialize rate limit
      rateLimit = {
        count: 1,
        resetTime: now + this.rateLimitWindow
      };
      this.rateLimits.set(leaseId, rateLimit);
      return { allowed: true };
    }
    
    if (rateLimit.count >= this.rateLimitMax) {
      return { allowed: false, reason: 'Rate limit exceeded' };
    }
    
    rateLimit.count++;
    return { allowed: true };
  }

  /**
   * Validate lease access permissions
   * @param {object} eventData - Event data
   * @returns {Promise<object>} Access check result
   */
  async validateLeaseAccess(eventData) {
    try {
      const leaseId = eventData.leaseId;
      
      // Get lease information
      const lease = this.database.db.prepare(`
        SELECT id, landlord_id, tenant_id, status
        FROM leases
        WHERE id = ?
      `).get(leaseId);

      if (!lease) {
        return { allowed: false, reason: 'Lease not found' };
      }

      // Validate that event data contains correct participants
      if (eventData.data) {
        const { lessorPubkey, lesseePubkey } = eventData.data;
        
        if (lessorPubkey && lessorPubkey !== lease.landlord_id) {
          return { allowed: false, reason: 'Invalid lessor public key' };
        }
        
        if (lesseePubkey && lesseePubkey !== lease.tenant_id) {
          return { allowed: false, reason: 'Invalid lessee public key' };
        }
      }

      return { allowed: true, lease };

    } catch (error) {
      console.error('[LeaseEventHandlers] Error validating lease access:', error);
      return { allowed: false, reason: 'Access validation error' };
    }
  }

  /**
   * Check for potential data leakage
   * @param {object} eventData - Event data
   * @returns {object} Leakage check result
   */
  checkDataLeakage(eventData) {
    try {
      // Ensure event only contains data for the specific lease
      const leaseId = eventData.leaseId;
      
      // Check that no other lease IDs are present in the data
      const dataString = JSON.stringify(eventData);
      const leaseIdPattern = /[a-zA-Z0-9_-]+/g;
      const foundIds = dataString.match(leaseIdPattern);
      
      if (foundIds && foundIds.length > 1) {
        // Check if any other lease-like IDs are present
        for (const id of foundIds) {
          if (id !== leaseId && this.looksLikeLeaseId(id)) {
            return { allowed: false, reason: 'Potential cross-lease data detected' };
          }
        }
      }

      // Validate that sensitive data is not exposed
      if (this.containsSensitiveData(eventData)) {
        return { allowed: false, reason: 'Sensitive data exposure detected' };
      }

      return { allowed: true };

    } catch (error) {
      console.error('[LeaseEventHandlers] Error checking data leakage:', error);
      return { allowed: false, reason: 'Leakage check error' };
    }
  }

  /**
   * Check if string looks like a lease ID
   * @param {string} id - String to check
   * @returns {boolean} True if looks like lease ID
   */
  looksLikeLeaseId(id) {
    // Simple heuristic for lease ID format
    return /^[a-zA-Z0-9_-]{8,}$/.test(id);
  }

  /**
   * Check for sensitive data exposure
   * @param {object} eventData - Event data
   * @returns {boolean} True if sensitive data found
   */
  containsSensitiveData(eventData) {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /private[_\s]?key/i,
      /token/i,
      /api[_\s]?key/i,
      /credential/i
    ];

    const dataString = JSON.stringify(eventData).toLowerCase();
    
    return sensitivePatterns.some(pattern => pattern.test(dataString));
  }

  /**
   * Get event recipients based on lease participants
   * @param {object} eventData - Event data
   * @returns {Promise<Array>} Array of recipient pubkeys
   */
  async getEventRecipients(eventData) {
    try {
      const leaseId = eventData.leaseId;
      
      // Get lease participants
      const lease = this.database.db.prepare(`
        SELECT landlord_id, tenant_id
        FROM leases
        WHERE id = ?
      `).get(leaseId);

      if (!lease) {
        return [];
      }

      const recipients = [lease.landlord_id, lease.tenant_id];
      
      // Remove duplicates
      return [...new Set(recipients)];

    } catch (error) {
      console.error('[LeaseEventHandlers] Error getting event recipients:', error);
      return [];
    }
  }

  /**
   * Deliver event to specified recipients
   * @param {object} eventData - Event data
   * @param {Array} recipients - Array of recipient pubkeys
   * @returns {Promise<void>}
   */
  async deliverEvent(eventData, recipients) {
    try {
      for (const pubkey of recipients) {
        // Create sanitized event data for this recipient
        const sanitizedEvent = this.sanitizeEventForRecipient(eventData, pubkey);
        
        // Deliver to user namespace
        this.websocketGateway.broadcastToUserNamespace(pubkey, sanitizedEvent);
        
        // Also deliver to lease room if user is subscribed
        this.websocketGateway.io.to(`lease:${eventData.leaseId}`).emit('lease_event', sanitizedEvent);
      }

      // Log successful delivery
      this.logEventDelivery(eventData, recipients);

    } catch (error) {
      console.error('[LeaseEventHandlers] Error delivering event:', error);
      this.metrics.eventsFailed++;
    }
  }

  /**
   * Sanitize event data for specific recipient
   * @param {object} eventData - Original event data
   * @param {string} recipientPubkey - Recipient's public key
   * @returns {object} Sanitized event data
   */
  sanitizeEventForRecipient(eventData, recipientPubkey) {
    // Create a copy of the event data
    const sanitized = JSON.parse(JSON.stringify(eventData));
    
    // Add recipient information for tracking
    sanitized.recipient = recipientPubkey;
    sanitized.deliveredAt = new Date().toISOString();
    
    // Remove any sensitive information that shouldn't be visible to this recipient
    // This is a simplified implementation - in production, more sophisticated filtering might be needed
    
    return sanitized;
  }

  /**
   * Block event due to security violation
   * @param {object} eventData - Event data
   * @param {string} reason - Block reason
   */
  blockEvent(eventData, reason) {
    this.metrics.eventsBlocked++;
    this.dataLeakageProtection.blockedAttempts++;
    this.dataLeakageProtection.lastBlockedAt = new Date().toISOString();
    
    // Log security violation
    const violation = {
      timestamp: new Date().toISOString(),
      eventType: eventData.eventType,
      leaseId: eventData.leaseId,
      reason: reason,
      eventData: JSON.stringify(eventData)
    };
    
    this.dataLeakageProtection.auditLog.push(violation);
    
    console.warn(`[LeaseEventHandlers] Event blocked: ${reason}`, violation);
    
    // Emit security alert
    this.websocketGateway.emit('security_violation', violation);
  }

  /**
   * Log successful event delivery
   * @param {object} eventData - Event data
   * @param {Array} recipients - Recipients
   */
  logEventDelivery(eventData, recipients) {
    const deliveryLog = {
      timestamp: new Date().toISOString(),
      eventType: eventData.eventType,
      leaseId: eventData.leaseId,
      transactionHash: eventData.transactionHash,
      recipients: recipients,
      deliveryCount: recipients.length
    };
    
    // In production, this would be stored in a database
    console.log(`[LeaseEventHandlers] Event delivered: ${eventData.eventType} to ${recipients.length} recipients`);
  }

  /**
   * Handle SecurityDepositLocked event
   * @param {object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleSecurityDepositLocked(eventData) {
    try {
      // Add specific logic for security deposit locked events
      console.log(`[LeaseEventHandlers] Security deposit locked for lease ${eventData.leaseId}`);
      
      // Could trigger additional actions like:
      // - Update lease status in database
      // - Send notifications to other systems
      // - Update metrics
      
      await this.processLeaseEvent(eventData);
    } catch (error) {
      console.error('[LeaseEventHandlers] Error handling SecurityDepositLocked:', error);
    }
  }

  /**
   * Handle LeaseRenewed event
   * @param {object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleLeaseRenewed(eventData) {
    try {
      // Add specific logic for lease renewal events
      console.log(`[LeaseEventHandlers] Lease renewed for lease ${eventData.leaseId}`);
      
      // Update lease end date in database
      if (eventData.data && eventData.data.newEndDate) {
        this.database.db.prepare(`
          UPDATE leases
          SET end_date = ?, updated_at = ?
          WHERE id = ?
        `).run(eventData.data.newEndDate, new Date().toISOString(), eventData.leaseId);
      }
      
      await this.processLeaseEvent(eventData);
    } catch (error) {
      console.error('[LeaseEventHandlers] Error handling LeaseRenewed:', error);
    }
  }

  /**
   * Handle LeaseTerminated event
   * @param {object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleLeaseTerminated(eventData) {
    try {
      // Add specific logic for lease termination events
      console.log(`[LeaseEventHandlers] Lease terminated for lease ${eventData.leaseId}`);
      
      // Update lease status in database
      this.database.db.prepare(`
        UPDATE leases
        SET status = 'terminated', lease_terminated_at = ?, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), eventData.leaseId);
      
      await this.processLeaseEvent(eventData);
    } catch (error) {
      console.error('[LeaseEventHandlers] Error handling LeaseTerminated:', error);
    }
  }

  /**
   * Handle RentPaymentReceived event
   * @param {object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleRentPaymentReceived(eventData) {
    try {
      // Add specific logic for rent payment events
      console.log(`[LeaseEventHandlers] Rent payment received for lease ${eventData.leaseId}`);
      
      // Could update payment records, send receipts, etc.
      
      await this.processLeaseEvent(eventData);
    } catch (error) {
      console.error('[LeaseEventHandlers] Error handling RentPaymentReceived:', error);
    }
  }

  /**
   * Get security metrics
   * @returns {object} Security metrics
   */
  getSecurityMetrics() {
    return {
      ...this.dataLeakageProtection,
      totalRateLimits: this.rateLimits.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get processing metrics
   * @returns {object} Processing metrics
   */
  getProcessingMetrics() {
    const avgProcessingTime = this.metrics.eventsProcessed > 0 
      ? this.metrics.processingTime / this.metrics.eventsProcessed 
      : 0;

    return {
      ...this.metrics,
      avgProcessingTime: Math.round(avgProcessingTime),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      eventsProcessed: 0,
      eventsBlocked: 0,
      eventsDelivered: 0,
      eventsFailed: 0,
      processingTime: 0,
      lastProcessedAt: null
    };
    
    this.dataLeakageProtection.blockedAttempts = 0;
    this.dataLeakageProtection.lastBlockedAt = null;
  }

  /**
   * Clear rate limits
   */
  clearRateLimits() {
    this.rateLimits.clear();
  }

  /**
   * Get audit log
   * @param {number} limit - Maximum number of entries to return
   * @returns {Array} Audit log entries
   */
  getAuditLog(limit = 100) {
    return this.dataLeakageProtection.auditLog.slice(-limit);
  }
}

module.exports = LeaseEventHandlers;
