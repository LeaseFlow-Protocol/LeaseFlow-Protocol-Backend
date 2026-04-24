const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const WebSocketAuthMiddleware = require('../middleware/websocketAuth');
const { LeaseEventValidator } = require('../schemas/leaseEventSchemas');
const EventEmitter = require('events');

/**
 * WebSocket Gateway for Live Lease State Transitions
 * Handles real-time communication between the backend and frontend clients
 */
class LeaseWebSocketGateway extends EventEmitter {
  constructor(config, database) {
    super();
    this.config = config;
    this.database = database;
    this.io = null;
    this.redisClient = null;
    this.pubClient = null;
    this.subClient = null;
    this.authMiddleware = null;
    this.eventValidator = new LeaseEventValidator();
    
    // Connection tracking
    this.connectedClients = new Map(); // socketId -> client info
    this.userNamespaces = new Map(); // pubkey -> namespace
    this.heartbeatIntervals = new Map(); // socketId -> interval
    
    // Configuration
    this.heartbeatInterval = config.websocket?.heartbeatInterval || 30000; // 30 seconds
    this.heartbeatTimeout = config.websocket?.heartbeatTimeout || 10000; // 10 seconds
    this.maxConnections = config.websocket?.maxConnections || 1000;
    this.connectionTimeout = config.websocket?.connectionTimeout || 120000; // 2 minutes
    
    // Metrics
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      lastActivity: null
    };
  }

  /**
   * Initialize the WebSocket gateway
   * @param {object} httpServer - HTTP server instance
   * @returns {Promise<void>}
   */
  async initialize(httpServer) {
    try {
      console.log('[LeaseWebSocketGateway] Initializing WebSocket gateway...');

      // Initialize Redis adapter for scaling
      await this.initializeRedisAdapter();

      // Create Socket.IO server with Redis adapter
      this.io = new Server(httpServer, {
        cors: {
          origin: this.config.cors?.allowedOrigins || ['http://localhost:3000'],
          methods: ['GET', 'POST'],
          credentials: true
        },
        adapter: createAdapter(this.pubClient, this.subClient),
        transports: ['websocket', 'polling'],
        pingTimeout: this.heartbeatTimeout,
        pingInterval: this.heartbeatInterval,
        maxHttpBufferSize: 1e6, // 1MB
        allowEIO3: true
      });

      // Initialize authentication middleware
      this.authMiddleware = new WebSocketAuthMiddleware(this.config);

      // Set up namespaces and event handlers
      this.setupNamespaces();
      this.setupEventHandlers();
      this.setupHeartbeatMonitoring();

      // Start cleanup intervals
      this.startCleanupIntervals();

      console.log('[LeaseWebSocketGateway] WebSocket gateway initialized successfully');
      this.emit('initialized');

    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error initializing gateway:', error);
      throw error;
    }
  }

  /**
   * Initialize Redis adapter for multi-instance scaling
   * @returns {Promise<void>}
   */
  async initializeRedisAdapter() {
    try {
      const redisConfig = this.config.redis || {
        host: 'localhost',
        port: 6379
      };

      // Create Redis clients for adapter
      this.pubClient = createClient(redisConfig);
      this.subClient = createClient(redisConfig);

      await Promise.all([
        this.pubClient.connect(),
        this.subClient.connect()
      ]);

      console.log('[LeaseWebSocketGateway] Redis adapter initialized');
    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error initializing Redis adapter:', error);
      throw error;
    }
  }

  /**
   * Set up WebSocket namespaces
   */
  setupNamespaces() {
    // Main namespace for general lease events
    const mainNamespace = this.io.of('/leases');
    mainNamespace.use(this.authMiddleware.createAuthMiddleware(this.io));
    this.setupMainNamespaceHandlers(mainNamespace);

    // User-specific namespaces
    this.io.of(/^\/user\/G[A-Z0-9]{55}$/).use((socket, next) => {
      const pubkey = socket.user.pubkey;
      const namespace = socket.nsp.name;
      
      // Validate that the user can only access their own namespace
      if (!namespace.endsWith(`/${pubkey}`)) {
        return next(new Error('Unauthorized access to user namespace'));
      }
      
      next();
    });

    // Set up handlers for user namespaces
    this.io.of(/^\/user\/G[A-Z0-9]{55}$/).on('connection', (socket) => {
      this.handleUserNamespaceConnection(socket);
    });

    console.log('[LeaseWebSocketGateway] Namespaces configured');
  }

  /**
   * Set up main namespace handlers
   * @param {object} namespace - Socket.IO namespace
   */
  setupMainNamespaceHandlers(namespace) {
    namespace.on('connection', (socket) => {
      this.handleMainNamespaceConnection(socket);
    });
  }

  /**
   * Handle connection to main namespace
   * @param {object} socket - Socket.IO socket
   */
  handleMainNamespaceConnection(socket) {
    const pubkey = socket.user.pubkey;
    
    console.log(`[LeaseWebSocketGateway] Main namespace connection: ${pubkey} (${socket.id})`);

    // Track connection
    this.trackConnection(socket, 'main');

    // Send connection acknowledgment
    socket.emit('connection_ack', {
      type: 'connection_ack',
      status: 'connected',
      timestamp: new Date().toISOString(),
      clientId: socket.id,
      pubkey: pubkey
    });

    // Set up event handlers
    this.setupSocketEventHandlers(socket);

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socket, reason);
    });
  }

  /**
   * Handle connection to user namespace
   * @param {object} socket - Socket.IO socket
   */
  handleUserNamespaceConnection(socket) {
    const pubkey = socket.user.pubkey;
    const namespace = socket.nsp.name;
    
    console.log(`[LeaseWebSocketGateway] User namespace connection: ${pubkey} to ${namespace}`);

    // Track connection
    this.trackConnection(socket, 'user');

    // Send connection acknowledgment
    socket.emit('connection_ack', {
      type: 'connection_ack',
      status: 'connected',
      timestamp: new Date().toISOString(),
      clientId: socket.id,
      pubkey: pubkey,
      namespace: namespace
    });

    // Set up event handlers
    this.setupSocketEventHandlers(socket);

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socket, reason);
    });
  }

  /**
   * Track socket connection
   * @param {object} socket - Socket.IO socket
   * @param {string} type - Connection type (main/user)
   */
  trackConnection(socket, type) {
    const clientInfo = {
      id: socket.id,
      pubkey: socket.user.pubkey,
      namespace: socket.nsp.name,
      type: type,
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      heartbeatMissed: 0
    };

    this.connectedClients.set(socket.id, clientInfo);
    this.metrics.activeConnections++;
    this.metrics.lastActivity = new Date().toISOString();

    // Start heartbeat for this connection
    this.startHeartbeat(socket);

    console.log(`[LeaseWebSocketGateway] Tracked connection: ${socket.id} (${socket.user.pubkey})`);
  }

  /**
   * Set up socket event handlers
   * @param {object} socket - Socket.IO socket
   */
  setupSocketEventHandlers(socket) {
    // Heartbeat ping/pong
    socket.on('ping', () => {
      this.handlePing(socket);
    });

    // Lease event subscriptions
    socket.on('subscribe_lease', (data) => {
      this.handleLeaseSubscription(socket, data);
    });

    socket.on('unsubscribe_lease', (data) => {
      this.handleLeaseUnsubscription(socket, data);
    });

    // User activity tracking
    socket.on('activity', (data) => {
      this.handleUserActivity(socket, data);
    });

    // Error handling
    socket.on('error', (error) => {
      this.handleSocketError(socket, error);
    });
  }

  /**
   * Start heartbeat monitoring for a socket
   * @param {object} socket - Socket.IO socket
   */
  startHeartbeat(socket) {
    const interval = setInterval(() => {
      const clientInfo = this.connectedClients.get(socket.id);
      if (!clientInfo) {
        clearInterval(interval);
        return;
      }

      // Check if socket is still connected
      if (!socket.connected) {
        clearInterval(interval);
        return;
      }

      // Send ping
      socket.emit('ping', {
        type: 'ping',
        timestamp: new Date().toISOString(),
        clientId: socket.id
      });

      // Update heartbeat timestamp
      clientInfo.lastPingSent = new Date().toISOString();

    }, this.heartbeatInterval);

    this.heartbeatIntervals.set(socket.id, interval);

    // Set up pong handler
    socket.on('pong', (data) => {
      this.handlePong(socket, data);
    });
  }

  /**
   * Handle ping from client
   * @param {object} socket - Socket.IO socket
   */
  handlePing(socket) {
    const clientInfo = this.connectedClients.get(socket.id);
    if (clientInfo) {
      clientInfo.lastActivity = new Date().toISOString();
      clientInfo.heartbeatMissed = 0;
    }

    // Respond with pong
    socket.emit('pong', {
      type: 'pong',
      timestamp: new Date().toISOString(),
      clientId: socket.id
    });
  }

  /**
   * Handle pong from client
   * @param {object} socket - Socket.IO socket
   * @param {object} data - Pong data
   */
  handlePong(socket, data) {
    const clientInfo = this.connectedClients.get(socket.id);
    if (clientInfo) {
      clientInfo.lastActivity = new Date().toISOString();
      clientInfo.heartbeatMissed = 0;
      clientInfo.lastPongReceived = new Date().toISOString();
    }
  }

  /**
   * Handle lease subscription
   * @param {object} socket - Socket.IO socket
   * @param {object} data - Subscription data
   */
  handleLeaseSubscription(socket, data) {
    try {
      const { leaseId } = data;
      
      if (!leaseId) {
        socket.emit('error', {
          type: 'error',
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'leaseId is required'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Validate that user has access to this lease
      const pubkey = socket.user.pubkey;
      if (!this.validateLeaseAccess(pubkey, leaseId)) {
        socket.emit('error', {
          type: 'error',
          error: {
            code: 'UNAUTHORIZED_ACCESS',
            message: 'Unauthorized access to lease'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Add to lease room
      socket.join(`lease:${leaseId}`);

      // Update client info
      const clientInfo = this.connectedClients.get(socket.id);
      if (clientInfo) {
        if (!clientInfo.subscriptions) {
          clientInfo.subscriptions = new Set();
        }
        clientInfo.subscriptions.add(leaseId);
      }

      console.log(`[LeaseWebSocketGateway] ${pubkey} subscribed to lease: ${leaseId}`);

      // Send subscription confirmation
      socket.emit('subscription_confirmed', {
        type: 'subscription_confirmed',
        leaseId: leaseId,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error handling lease subscription:', error);
      socket.emit('error', {
        type: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to subscribe to lease'
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle lease unsubscription
   * @param {object} socket - Socket.IO socket
   * @param {object} data - Unsubscription data
   */
  handleLeaseUnsubscription(socket, data) {
    try {
      const { leaseId } = data;
      
      if (!leaseId) {
        return;
      }

      // Remove from lease room
      socket.leave(`lease:${leaseId}`);

      // Update client info
      const clientInfo = this.connectedClients.get(socket.id);
      if (clientInfo && clientInfo.subscriptions) {
        clientInfo.subscriptions.delete(leaseId);
      }

      console.log(`[LeaseWebSocketGateway] ${socket.user.pubkey} unsubscribed from lease: ${leaseId}`);

    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error handling lease unsubscription:', error);
    }
  }

  /**
   * Handle user activity
   * @param {object} socket - Socket.IO socket
   * @param {object} data - Activity data
   */
  handleUserActivity(socket, data) {
    const clientInfo = this.connectedClients.get(socket.id);
    if (clientInfo) {
      clientInfo.lastActivity = new Date().toISOString();
      this.metrics.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Handle socket error
   * @param {object} socket - Socket.IO socket
   * @param {object} error - Error object
   */
  handleSocketError(socket, error) {
    console.error(`[LeaseWebSocketGateway] Socket error for ${socket.id}:`, error);
    this.metrics.errors++;
  }

  /**
   * Handle socket disconnect
   * @param {object} socket - Socket.IO socket
   * @param {string} reason - Disconnect reason
   */
  handleDisconnect(socket, reason) {
    const clientInfo = this.connectedClients.get(socket.id);
    
    if (clientInfo) {
      console.log(`[LeaseWebSocketGateway] Disconnected: ${clientInfo.pubkey} (${socket.id}) - ${reason}`);
      
      // Clean up heartbeat
      const interval = this.heartbeatIntervals.get(socket.id);
      if (interval) {
        clearInterval(interval);
        this.heartbeatIntervals.delete(socket.id);
      }
      
      // Remove from tracking
      this.connectedClients.delete(socket.id);
      this.metrics.activeConnections--;
    }
  }

  /**
   * Validate lease access for user
   * @param {string} pubkey - User's Stellar public key
   * @param {string} leaseId - Lease ID
   * @returns {boolean} True if user has access
   */
  validateLeaseAccess(pubkey, leaseId) {
    try {
      // Query database to check if user is lessor or lessee
      const lease = this.database.db.prepare(`
        SELECT id, landlord_id, tenant_id
        FROM leases
        WHERE id = ? AND (landlord_id = ? OR tenant_id = ?)
      `).get(leaseId, pubkey, pubkey);

      return !!lease;
    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error validating lease access:', error);
      return false;
    }
  }

  /**
   * Broadcast lease event to relevant parties
   * @param {object} eventData - Lease event data
   * @returns {Promise<void>}
   */
  async broadcastLeaseEvent(eventData) {
    try {
      // Validate event data
      const validation = this.eventValidator.validate(eventData.eventType, eventData);
      if (!validation.valid) {
        console.error('[LeaseWebSocketGateway] Invalid event data:', validation.errors);
        return;
      }

      const leaseId = eventData.leaseId;
      const eventType = eventData.eventType;

      // Get lease participants
      const lease = this.database.db.prepare(`
        SELECT landlord_id, tenant_id
        FROM leases
        WHERE id = ?
      `).get(leaseId);

      if (!lease) {
        console.error(`[LeaseWebSocketGateway] Lease not found: ${leaseId}`);
        return;
      }

      // Broadcast to lease room
      this.io.to(`lease:${leaseId}`).emit('lease_event', eventData);
      this.metrics.messagesSent++;

      // Also broadcast to user-specific namespaces
      this.broadcastToUserNamespace(lease.landlord_id, eventData);
      this.broadcastToUserNamespace(lease.tenant_id, eventData);

      console.log(`[LeaseWebSocketGateway] Broadcasted ${eventType} for lease ${leaseId}`);

    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error broadcasting lease event:', error);
      this.metrics.errors++;
    }
  }

  /**
   * Broadcast to user-specific namespace
   * @param {string} pubkey - User's Stellar public key
   * @param {object} eventData - Event data to broadcast
   */
  broadcastToUserNamespace(pubkey, eventData) {
    const userNamespace = this.io.of(`/user/${pubkey}`);
    if (userNamespace) {
      userNamespace.emit('lease_event', eventData);
      this.metrics.messagesSent++;
    }
  }

  /**
   * Set up event handlers for external events
   */
  setupEventHandlers() {
    // Listen for events from Soroban indexer
    this.on('soroban_event', (eventData) => {
      this.handleSorobanEvent(eventData);
    });

    // Listen for lease state changes
    this.on('lease_state_change', (eventData) => {
      this.broadcastLeaseEvent(eventData);
    });

    console.log('[LeaseWebSocketGateway] Event handlers configured');
  }

  /**
   * Handle Soroban indexer events
   * @param {object} eventData - Soroban event data
   */
  handleSorobanEvent(eventData) {
    try {
      // Transform Soroban event to lease event format
      const leaseEvent = this.transformSorobanEvent(eventData);
      
      if (leaseEvent) {
        this.broadcastLeaseEvent(leaseEvent);
      }
    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error handling Soroban event:', error);
    }
  }

  /**
   * Transform Soroban event to lease event format
   * @param {object} sorobanEvent - Raw Soroban event
   * @returns {object|null} Transformed lease event
   */
  transformSorobanEvent(sorobanEvent) {
    // This would contain the logic to transform Soroban events
    // into the standardized lease event format
    // Implementation depends on the actual Soroban event structure
    
    try {
      const eventType = this.mapSorobanEventType(sorobanEvent.type);
      if (!eventType) {
        return null;
      }

      return {
        eventType,
        timestamp: new Date().toISOString(),
        leaseId: sorobanEvent.leaseId,
        transactionHash: sorobanEvent.transactionHash,
        network: sorobanEvent.network || 'testnet',
        data: sorobanEvent.data
      };
    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error transforming Soroban event:', error);
      return null;
    }
  }

  /**
   * Map Soroban event type to lease event type
   * @param {string} sorobanType - Soroban event type
   * @returns {string|null} Mapped lease event type
   */
  mapSorobanEventType(sorobanType) {
    const mapping = {
      'security_deposit_locked': 'SecurityDepositLocked',
      'lease_renewed': 'LeaseRenewed',
      'lease_terminated': 'LeaseTerminated',
      'lease_created': 'LeaseCreated',
      'rent_payment_received': 'RentPaymentReceived',
      'rent_payment_late': 'RentPaymentLate',
      'security_deposit_refunded': 'SecurityDepositRefunded'
    };

    return mapping[sorobanType] || null;
  }

  /**
   * Set up heartbeat monitoring
   */
  setupHeartbeatMonitoring() {
    // Check for zombie connections every minute
    setInterval(() => {
      this.checkZombieConnections();
    }, 60000);
  }

  /**
   * Check for zombie connections and clean them up
   */
  checkZombieConnections() {
    const now = Date.now();
    const zombieThreshold = this.heartbeatTimeout * 2; // 2x heartbeat timeout

    for (const [socketId, clientInfo] of this.connectedClients) {
      const lastActivity = new Date(clientInfo.lastActivity).getTime();
      
      if (now - lastActivity > zombieThreshold) {
        console.log(`[LeaseWebSocketGateway] Found zombie connection: ${socketId}`);
        
        // Force disconnect
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }
      }
    }
  }

  /**
   * Start cleanup intervals
   */
  startCleanupIntervals() {
    // Clean up old connections every 5 minutes
    setInterval(() => {
      this.cleanupOldConnections();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up old connections
   */
  cleanupOldConnections() {
    const now = Date.now();
    const oldThreshold = this.connectionTimeout;
    let cleaned = 0;

    for (const [socketId, clientInfo] of this.connectedClients) {
      const connectedAt = new Date(clientInfo.connectedAt).getTime();
      
      if (now - connectedAt > oldThreshold) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[LeaseWebSocketGateway] Cleaned up ${cleaned} old connections`);
    }
  }

  /**
   * Get gateway statistics
   * @returns {object} Gateway statistics
   */
  getStats() {
    const authStats = this.authMiddleware ? this.authMiddleware.getStats() : null;
    
    return {
      ...this.metrics,
      activeConnections: this.connectedClients.size,
      authStats,
      heartbeatIntervals: this.heartbeatIntervals.size,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get connected clients information
   * @returns {Array} Array of connected client info
   */
  getConnectedClients() {
    return Array.from(this.connectedClients.values()).map(client => ({
      id: client.id,
      pubkey: client.pubkey,
      namespace: client.namespace,
      type: client.type,
      connectedAt: client.connectedAt,
      lastActivity: client.lastActivity,
      subscriptionCount: client.subscriptions ? client.subscriptions.size : 0
    }));
  }

  /**
   * Shutdown the WebSocket gateway
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      console.log('[LeaseWebSocketGateway] Shutting down WebSocket gateway...');

      // Clear all heartbeat intervals
      for (const interval of this.heartbeatIntervals.values()) {
        clearInterval(interval);
      }
      this.heartbeatIntervals.clear();

      // Disconnect all clients
      this.io.disconnectSockets(true);

      // Close Socket.IO server
      this.io.close();

      // Close Redis connections
      if (this.pubClient) {
        await this.pubClient.quit();
      }
      if (this.subClient) {
        await this.subClient.quit();
      }

      console.log('[LeaseWebSocketGateway] WebSocket gateway shutdown complete');
    } catch (error) {
      console.error('[LeaseWebSocketGateway] Error during shutdown:', error);
    }
  }
}

module.exports = LeaseWebSocketGateway;
