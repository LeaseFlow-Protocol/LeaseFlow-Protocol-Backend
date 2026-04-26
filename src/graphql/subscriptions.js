const { EventEmitter } = require('events');

/**
 * GraphQL Subscription Manager
 * Handles real-time subscriptions for IoT events, lease updates, and asset changes
 */

class SubscriptionManager extends EventEmitter {
  constructor(redisService, database) {
    super();
    this.redisService = redisService;
    this.database = database;
    this.subscriptions = new Map(); // Track active subscriptions
    this.redisClient = null;
    this.isInitialized = false;
  }

  /**
   * Initialize the subscription manager
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      // Get Redis client for pub/sub
      this.redisClient = await this.redisService.getWorkingClient();
      
      // Set up Redis subscription listeners
      await this.setupRedisSubscriptions();
      
      this.isInitialized = true;
      console.log('[GraphQL] Subscription manager initialized');
    } catch (error) {
      console.error('[GraphQL] Failed to initialize subscription manager:', error);
      throw error;
    }
  }

  /**
   * Set up Redis subscription listeners for real-time events
   */
  async setupRedisSubscriptions() {
    // Create a separate Redis client for subscriptions
    const subscriber = await this.redisService.getWorkingClient();
    
    // Subscribe to relevant Redis channels
    const channels = [
      'lease_status_changed',
      'lease_created',
      'lease_terminated',
      'asset_unlocked',
      'asset_condition_changed',
      'condition_report_submitted',
      'condition_report_verified',
      'payment_received',
      'payment_overdue',
      'maintenance_ticket_created',
      'maintenance_ticket_updated',
      'iot_event',
      'asset_health_changed'
    ];

    await subscriber.subscribe(...channels);

    // Handle incoming Redis messages
    subscriber.on('message', (channel, message) => {
      this.handleRedisMessage(channel, message);
    });

    console.log(`[GraphQL] Subscribed to ${channels.length} Redis channels`);
  }

  /**
   * Handle incoming Redis messages and emit to appropriate GraphQL subscriptions
   */
  async handleRedisMessage(channel, message) {
    try {
      const data = JSON.parse(message);
      
      // Validate and filter data based on user permissions
      const filteredData = await this.filterSubscriptionData(channel, data);
      
      if (filteredData) {
        // Emit to GraphQL subscribers
        this.emit(channel, filteredData);
        
        // Also emit to specific user-based channels
        if (data.landlordId) {
          this.emit(`${channel}_${data.landlordId}`, filteredData);
        }
        if (data.tenantId) {
          this.emit(`${channel}_${data.tenantId}`, filteredData);
        }
        if (data.lessorId) {
          this.emit(`${channel}_${data.lessorId}`, filteredData);
        }
        if (data.vendorId) {
          this.emit(`${channel}_${data.vendorId}`, filteredData);
        }
      }
    } catch (error) {
      console.error(`[GraphQL] Error handling Redis message on channel ${channel}:`, error);
    }
  }

  /**
   * Filter subscription data based on user permissions and privacy
   */
  async filterSubscriptionData(channel, data) {
    // Remove sensitive information from subscription payloads
    const filtered = { ...data };

    // Remove internal database IDs and sensitive fields
    switch (channel) {
      case 'lease_status_changed':
      case 'lease_created':
      case 'lease_terminated':
        // Remove sensitive internal fields
        delete filtered.internalNotes;
        delete filtered.adminFlags;
        break;

      case 'condition_report_submitted':
        // Filter condition report data
        if (filtered.reportData) {
          // Remove any sensitive personal information
          delete filtered.reportData.personalInfo;
          delete filtered.reportData.privateNotes;
        }
        break;

      case 'payment_received':
        // Remove transaction details that could be sensitive
        delete filtered.internalTransactionId;
        delete filtered.processingNotes;
        break;

      case 'iot_event':
        // Filter IoT data to remove device credentials
        if (filtered.payload) {
          delete filtered.payload.deviceCredentials;
          delete filtered.payload.apiKeys;
        }
        break;
    }

    return filtered;
  }

  /**
   * Publish an event to Redis for GraphQL subscribers
   */
  async publishEvent(channel, data) {
    try {
      const redis = await this.redisService.getWorkingClient();
      await redis.publish(channel, JSON.stringify(data));
    } catch (error) {
      console.error(`[GraphQL] Failed to publish to channel ${channel}:`, error);
    }
  }

  /**
   * Create async iterator for GraphQL subscriptions
   */
  createAsyncIterator(channel, user = null) {
    const eventName = user ? `${channel}_${user.id}` : channel;
    
    return (async function* () {
      const queue = [];
      
      const onData = (data) => {
        queue.push(data);
      };
      
      // Subscribe to events
      SubscriptionManager.prototype.on.call(SubscriptionManager.prototype, eventName, onData);
      
      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift();
          } else {
            // Wait for next event
            await new Promise(resolve => {
              const once = (data) => {
                SubscriptionManager.prototype.off.call(SubscriptionManager.prototype, eventName, onData);
                resolve(data);
              };
              SubscriptionManager.prototype.once.call(SubscriptionManager.prototype, eventName, once);
            });
            yield queue.shift();
          }
        }
      } finally {
        // Clean up subscription
        SubscriptionManager.prototype.off.call(SubscriptionManager.prototype, eventName, onData);
      }
    })();
  }

  /**
   * Handle subscription lifecycle events
   */
  onSubscriptionConnect(connectionParams, webSocket, context) {
    // Validate authentication for subscription connection
    const token = connectionParams.authToken || connectionParams.authorization;
    
    if (!token) {
      throw new Error('Authentication required for subscriptions');
    }

    // Validate JWT token (reuse existing auth logic)
    try {
      const actorAuthService = context.app.locals.actorAuthService;
      const user = actorAuthService.verifyToken(token.replace('Bearer ', ''));
      
      console.log(`[GraphQL] User ${user.id} connected to subscriptions`);
      return { user };
    } catch (error) {
      throw new Error('Invalid authentication token');
    }
  }

  onSubscriptionDisconnect(webSocket, context) {
    console.log('[GraphQL] Subscription disconnected');
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
    this.removeAllListeners();
    this.subscriptions.clear();
    this.isInitialized = false;
  }
}

/**
 * Event Publishers - Bridge between backend services and GraphQL subscriptions
 */
class LeaseEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishLeaseStatusChanged(leaseId, oldStatus, newStatus, leaseData) {
    await this.subscriptionManager.publishEvent('lease_status_changed', {
      leaseId,
      oldStatus,
      newStatus,
      lease: leaseData,
      timestamp: new Date().toISOString()
    });
  }

  async publishLeaseCreated(leaseData) {
    await this.subscriptionManager.publishEvent('lease_created', {
      lease: leaseData,
      landlordId: leaseData.landlordId,
      tenantId: leaseData.tenantId,
      lessorId: leaseData.lessorId,
      timestamp: new Date().toISOString()
    });
  }

  async publishLeaseTerminated(leaseId, reason, leaseData) {
    await this.subscriptionManager.publishEvent('lease_terminated', {
      leaseId,
      reason,
      lease: leaseData,
      landlordId: leaseData.landlordId,
      tenantId: leaseData.tenantId,
      timestamp: new Date().toISOString()
    });
  }
}

class AssetEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishAssetUnlocked(assetId, assetData) {
    await this.subscriptionManager.publishEvent('asset_unlocked', {
      assetId,
      asset: assetData,
      lessorId: assetData.lessorId,
      timestamp: new Date().toISOString()
    });
  }

  async publishAssetConditionChanged(assetId, conditionData) {
    await this.subscriptionManager.publishEvent('asset_condition_changed', {
      assetId,
      condition: conditionData,
      timestamp: new Date().toISOString()
    });
  }

  async publishAssetHealthChanged(lessorId, healthData) {
    await this.subscriptionManager.publishEvent('asset_health_changed', {
      lessorId,
      health: healthData,
      timestamp: new Date().toISOString()
    });
  }
}

class ConditionReportEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishConditionReportSubmitted(leaseId, reportData) {
    await this.subscriptionManager.publishEvent('condition_report_submitted', {
      leaseId,
      report: reportData,
      timestamp: new Date().toISOString()
    });
  }

  async publishConditionReportVerified(assetId, reportData) {
    await this.subscriptionManager.publishEvent('condition_report_verified', {
      assetId,
      report: reportData,
      timestamp: new Date().toISOString()
    });
  }
}

class PaymentEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishPaymentReceived(leaseId, paymentData) {
    await this.subscriptionManager.publishEvent('payment_received', {
      leaseId,
      payment: paymentData,
      timestamp: new Date().toISOString()
    });
  }

  async publishPaymentOverdue(landlordId, paymentData) {
    await this.subscriptionManager.publishEvent('payment_overdue', {
      landlordId,
      payment: paymentData,
      timestamp: new Date().toISOString()
    });
  }
}

class MaintenanceEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishMaintenanceTicketCreated(ticketData) {
    await this.subscriptionManager.publishEvent('maintenance_ticket_created', {
      ticket: ticketData,
      landlordId: ticketData.landlordId,
      vendorId: ticketData.vendorId,
      timestamp: new Date().toISOString()
    });
  }

  async publishMaintenanceTicketUpdated(ticketData) {
    await this.subscriptionManager.publishEvent('maintenance_ticket_updated', {
      ticket: ticketData,
      vendorId: ticketData.vendorId,
      timestamp: new Date().toISOString()
    });
  }
}

class IoTEventPublisher {
  constructor(subscriptionManager) {
    this.subscriptionManager = subscriptionManager;
  }

  async publishIoTEvent(leaseId, eventData) {
    await this.subscriptionManager.publishEvent('iot_event', {
      leaseId,
      event: eventData,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Create and initialize all subscription publishers
 */
function createSubscriptionPublishers(subscriptionManager) {
  return {
    lease: new LeaseEventPublisher(subscriptionManager),
    asset: new AssetEventPublisher(subscriptionManager),
    conditionReport: new ConditionReportEventPublisher(subscriptionManager),
    payment: new PaymentEventPublisher(subscriptionManager),
    maintenance: new MaintenanceEventPublisher(subscriptionManager),
    iot: new IoTEventPublisher(subscriptionManager),
  };
}

module.exports = {
  SubscriptionManager,
  LeaseEventPublisher,
  AssetEventPublisher,
  ConditionReportPublisher,
  PaymentEventPublisher,
  MaintenanceEventPublisher,
  IoTEventPublisher,
  createSubscriptionPublishers,
};
