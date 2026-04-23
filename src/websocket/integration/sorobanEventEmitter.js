const EventEmitter = require('events');

/**
 * Soroban Event Emitter
 * Integrates with the Soroban indexer to emit real-time lease events
 */
class SorobanEventEmitter extends EventEmitter {
  constructor(config, database, websocketGateway) {
    super();
    this.config = config;
    this.database = database;
    this.websocketGateway = websocketGateway;
    
    // Event mapping configuration
    this.eventMappings = {
      'security_deposit_locked': {
        eventType: 'SecurityDepositLocked',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'depositAmount', 'depositAsset']
      },
      'lease_renewed': {
        eventType: 'LeaseRenewed',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'newEndDate', 'renewalTerms']
      },
      'lease_terminated': {
        eventType: 'LeaseTerminated',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'terminationReason']
      },
      'lease_created': {
        eventType: 'LeaseCreated',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'leaseTerms']
      },
      'rent_payment_received': {
        eventType: 'RentPaymentReceived',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'paymentAmount', 'paymentAsset']
      },
      'rent_payment_late': {
        eventType: 'RentPaymentLate',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'dueDate', 'daysLate']
      },
      'security_deposit_refunded': {
        eventType: 'SecurityDepositRefunded',
        requiredFields: ['leaseId', 'lessorPubkey', 'lesseePubkey', 'refundAmount']
      }
    };

    // Metrics tracking
    this.metrics = {
      eventsProcessed: 0,
      eventsEmitted: 0,
      eventsFailed: 0,
      lastEventProcessed: null,
      processingErrors: []
    };

    this.isListening = false;
    this.eventBuffer = [];
    this.batchSize = config.soroban?.batchSize || 100;
    this.flushInterval = config.soroban?.flushInterval || 1000; // 1 second
  }

  /**
   * Start listening for Soroban events
   * @returns {Promise<void>}
   */
  async start() {
    try {
      console.log('[SorobanEventEmitter] Starting Soroban event listener...');
      
      // Set up database change listener
      this.setupDatabaseListener();
      
      // Set up periodic event processing
      this.setupEventProcessor();
      
      this.isListening = true;
      console.log('[SorobanEventEmitter] Soroban event listener started');
      
      this.emit('started');
    } catch (error) {
      console.error('[SorobanEventEmitter] Error starting event listener:', error);
      throw error;
    }
  }

  /**
   * Stop listening for events
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      console.log('[SorobanEventEmitter] Stopping Soroban event listener...');
      
      this.isListening = false;
      
      // Process any remaining events
      await this.flushEventBuffer();
      
      console.log('[SorobanEventEmitter] Soroban event listener stopped');
      
      this.emit('stopped');
    } catch (error) {
      console.error('[SorobanEventEmitter] Error stopping event listener:', error);
    }
  }

  /**
   * Set up database listener for lease state changes
   */
  setupDatabaseListener() {
    // This would typically use database triggers or change streams
    // For SQLite, we'll use polling to detect changes
    
    setInterval(() => {
      if (this.isListening) {
        this.pollForLeaseChanges();
      }
    }, this.config.soroban?.pollInterval || 5000); // 5 seconds
  }

  /**
   * Poll for lease state changes
   */
  async pollForLeaseChanges() {
    try {
      // Get recent lease changes
      const recentChanges = this.database.db.prepare(`
        SELECT id, landlord_id, tenant_id, status, updated_at, created_at,
               transaction_hash, security_deposit_locked_at, lease_terminated_at
        FROM leases
        WHERE updated_at > datetime('now', '-10 seconds')
        ORDER BY updated_at DESC
      `).all();

      for (const lease of recentChanges) {
        await this.processLeaseChange(lease);
      }
    } catch (error) {
      console.error('[SorobanEventEmitter] Error polling for lease changes:', error);
      this.metrics.eventsFailed++;
    }
  }

  /**
   * Process lease change and emit appropriate events
   * @param {object} lease - Lease data
   */
  async processLeaseChange(lease) {
    try {
      // Determine what type of event this is based on the changes
      const eventType = this.determineEventType(lease);
      
      if (!eventType) {
        return;
      }

      const eventData = await this.buildEventData(eventType, lease);
      
      if (eventData) {
        this.bufferEvent(eventData);
      }
    } catch (error) {
      console.error('[SorobanEventEmitter] Error processing lease change:', error);
      this.metrics.eventsFailed++;
    }
  }

  /**
   * Determine event type based on lease changes
   * @param {object} lease - Lease data
   * @returns {string|null} Event type
   */
  determineEventType(lease) {
    // Check for various event types based on lease state changes
    
    if (lease.security_deposit_locked_at && this.isRecentChange(lease.security_deposit_locked_at, lease.updated_at)) {
      return 'security_deposit_locked';
    }
    
    if (lease.lease_terminated_at && this.isRecentChange(lease.lease_terminated_at, lease.updated_at)) {
      return 'lease_terminated';
    }
    
    if (lease.status === 'active' && this.isRecentChange(lease.created_at, lease.updated_at)) {
      return 'lease_created';
    }
    
    // For other events, we might need to check separate event tables
    // This is a simplified implementation
    
    return null;
  }

  /**
   * Check if a timestamp is a recent change
   * @param {string} timestamp - Timestamp to check
   * @param {string} updatedAt - Updated timestamp
   * @returns {boolean} True if recent change
   */
  isRecentChange(timestamp, updatedAt) {
    if (!timestamp) return false;
    
    const changeTime = new Date(timestamp).getTime();
    const updateTime = new Date(updatedAt).getTime();
    
    // Consider it recent if within 10 seconds
    return Math.abs(updateTime - changeTime) < 10000;
  }

  /**
   * Build event data for emission
   * @param {string} eventType - Event type
   * @param {object} lease - Lease data
   * @returns {Promise<object|null>} Event data
   */
  async buildEventData(eventType, lease) {
    try {
      const mapping = this.eventMappings[eventType];
      if (!mapping) {
        return null;
      }

      const baseEventData = {
        eventType: mapping.eventType,
        timestamp: new Date().toISOString(),
        leaseId: lease.id,
        transactionHash: lease.transaction_hash,
        network: this.config.stellar?.network || 'testnet',
        data: {
          lessorPubkey: lease.landlord_id,
          lesseePubkey: lease.tenant_id
        }
      };

      // Add event-specific data
      switch (eventType) {
        case 'security_deposit_locked':
          baseEventData.data.lockTimestamp = lease.security_deposit_locked_at;
          break;
          
        case 'lease_terminated':
          baseEventData.data.terminationDate = lease.lease_terminated_at;
          baseEventData.data.terminationReason = this.inferTerminationReason(lease);
          break;
          
        case 'lease_created':
          baseEventData.data.creationTimestamp = lease.created_at;
          baseEventData.data.leaseTerms = await this.getLeaseTerms(lease.id);
          break;
      }

      // Validate required fields
      const missingFields = mapping.requiredFields.filter(field => !this.getNestedValue(baseEventData, field));
      if (missingFields.length > 0) {
        console.warn(`[SorobanEventEmitter] Missing required fields for ${eventType}: ${missingFields.join(', ')}`);
        return null;
      }

      return baseEventData;
    } catch (error) {
      console.error('[SorobanEventEmitter] Error building event data:', error);
      return null;
    }
  }

  /**
   * Get nested value from object using dot notation
   * @param {object} obj - Object to search
   * @param {string} path - Dot-separated path
   * @returns {*} Value or null
   */
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => current && current[key], obj);
  }

  /**
   * Infer termination reason based on lease data
   * @param {object} lease - Lease data
   * @returns {string} Termination reason
   */
  inferTerminationReason(lease) {
    // This would typically come from additional data
    // For now, use a default reason
    return 'mutual_agreement';
  }

  /**
   * Get lease terms from database
   * @param {string} leaseId - Lease ID
   * @returns {Promise<object>} Lease terms
   */
  async getLeaseTerms(leaseId) {
    try {
      const lease = this.database.db.prepare(`
        SELECT start_date, end_date, rent_amount, rent_currency, security_deposit_required
        FROM leases
        WHERE id = ?
      `).get(leaseId);

      if (!lease) {
        return {};
      }

      return {
        startDate: lease.start_date,
        endDate: lease.end_date,
        rentAmount: lease.rent_amount,
        rentCurrency: lease.rent_currency,
        securityDepositRequired: Boolean(lease.security_deposit_required)
      };
    } catch (error) {
      console.error('[SorobanEventEmitter] Error getting lease terms:', error);
      return {};
    }
  }

  /**
   * Buffer event for batch processing
   * @param {object} eventData - Event data
   */
  bufferEvent(eventData) {
    this.eventBuffer.push({
      ...eventData,
      bufferedAt: new Date().toISOString()
    });

    // Flush if buffer is full
    if (this.eventBuffer.length >= this.batchSize) {
      this.flushEventBuffer();
    }
  }

  /**
   * Set up periodic event processor
   */
  setupEventProcessor() {
    setInterval(() => {
      if (this.isListening && this.eventBuffer.length > 0) {
        this.flushEventBuffer();
      }
    }, this.flushInterval);
  }

  /**
   * Flush event buffer to WebSocket gateway
   * @returns {Promise<void>}
   */
  async flushEventBuffer() {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const events = [...this.eventBuffer];
    this.eventBuffer = [];

    try {
      for (const eventData of events) {
        await this.emitEvent(eventData);
      }
      
      console.log(`[SorobanEventEmitter] Processed ${events.length} events`);
    } catch (error) {
      console.error('[SorobanEventEmitter] Error flushing event buffer:', error);
      this.metrics.eventsFailed += events.length;
    }
  }

  /**
   * Emit single event to WebSocket gateway
   * @param {object} eventData - Event data
   * @returns {Promise<void>}
   */
  async emitEvent(eventData) {
    try {
      // Emit to WebSocket gateway
      this.websocketGateway.emit('soroban_event', eventData);
      
      this.metrics.eventsProcessed++;
      this.metrics.eventsEmitted++;
      this.metrics.lastEventProcessed = new Date().toISOString();
      
      // Also emit for general event handling
      this.emit('lease_event', eventData);
      
    } catch (error) {
      console.error('[SorobanEventEmitter] Error emitting event:', error);
      this.metrics.eventsFailed++;
    }
  }

  /**
   * Handle external Soroban event
   * @param {object} sorobanEvent - Raw Soroban event
   * @returns {Promise<void>}
   */
  async handleSorobanEvent(sorobanEvent) {
    try {
      if (!this.isListening) {
        return;
      }

      // Validate Soroban event structure
      if (!this.validateSorobanEvent(sorobanEvent)) {
        console.warn('[SorobanEventEmitter] Invalid Soroban event structure');
        return;
      }

      // Transform to lease event format
      const leaseEvent = this.transformSorobanEvent(sorobanEvent);
      
      if (leaseEvent) {
        await this.emitEvent(leaseEvent);
      }
    } catch (error) {
      console.error('[SorobanEventEmitter] Error handling Soroban event:', error);
      this.metrics.eventsFailed++;
    }
  }

  /**
   * Validate Soroban event structure
   * @param {object} sorobanEvent - Soroban event
   * @returns {boolean} True if valid
   */
  validateSorobanEvent(sorobanEvent) {
    const requiredFields = ['type', 'leaseId', 'timestamp', 'transactionHash'];
    
    return requiredFields.every(field => sorobanEvent[field]);
  }

  /**
   * Transform Soroban event to lease event format
   * @param {object} sorobanEvent - Raw Soroban event
   * @returns {object|null} Transformed event
   */
  transformSorobanEvent(sorobanEvent) {
    try {
      const mapping = this.eventMappings[sorobanEvent.type];
      if (!mapping) {
        return null;
      }

      return {
        eventType: mapping.eventType,
        timestamp: sorobanEvent.timestamp,
        leaseId: sorobanEvent.leaseId,
        transactionHash: sorobanEvent.transactionHash,
        network: sorobanEvent.network || 'testnet',
        data: {
          ...sorobanEvent.data,
          lessorPubkey: sorobanEvent.lessorPubkey,
          lesseePubkey: sorobanEvent.lesseePubkey
        }
      };
    } catch (error) {
      console.error('[SorobanEventEmitter] Error transforming Soroban event:', error);
      return null;
    }
  }

  /**
   * Get metrics
   * @returns {object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      isListening: this.isListening,
      bufferSize: this.eventBuffer.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      eventsProcessed: 0,
      eventsEmitted: 0,
      eventsFailed: 0,
      lastEventProcessed: null,
      processingErrors: []
    };
  }

  /**
   * Get event mappings
   * @returns {object} Event mappings
   */
  getEventMappings() {
    return this.eventMappings;
  }

  /**
   * Add custom event mapping
   * @param {string} sorobanType - Soroban event type
   * @param {object} mapping - Event mapping
   */
  addEventMapping(sorobanType, mapping) {
    this.eventMappings[sorobanType] = mapping;
    console.log(`[SorobanEventEmitter] Added event mapping: ${sorobanType} -> ${mapping.eventType}`);
  }

  /**
   * Remove event mapping
   * @param {string} sorobanType - Soroban event type
   */
  removeEventMapping(sorobanType) {
    delete this.eventMappings[sorobanType];
    console.log(`[SorobanEventEmitter] Removed event mapping: ${sorobanType}`);
  }
}

module.exports = SorobanEventEmitter;
