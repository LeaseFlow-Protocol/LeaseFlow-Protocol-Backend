const LeaseWebSocketGateway = require('./gateway/leaseWebSocketGateway');
const SorobanEventEmitter = require('./integration/sorobanEventEmitter');
const WebSocketPerformanceMonitor = require('./monitoring/websocketPerformanceMonitor');

/**
 * WebSocket System Integration
 * Integrates all WebSocket components into a cohesive system
 */
class WebSocketSystem {
  constructor(config, database) {
    this.config = config;
    this.database = database;
    
    this.gateway = null;
    this.sorobanEmitter = null;
    this.performanceMonitor = null;
    
    this.isInitialized = false;
    this.isRunning = false;
  }

  /**
   * Initialize the WebSocket system
   * @param {object} httpServer - HTTP server instance
   * @returns {Promise<void>}
   */
  async initialize(httpServer) {
    try {
      console.log('[WebSocketSystem] Initializing WebSocket system...');

      // Initialize performance monitor
      this.performanceMonitor = new WebSocketPerformanceMonitor(this.config);
      
      // Initialize WebSocket gateway
      this.gateway = new LeaseWebSocketGateway(this.config, this.database);
      await this.gateway.initialize(httpServer);
      
      // Initialize Soroban event emitter
      this.sorobanEmitter = new SorobanEventEmitter(this.config, this.database, this.gateway);
      
      // Set up event listeners
      this.setupEventListeners();
      
      this.isInitialized = true;
      console.log('[WebSocketSystem] WebSocket system initialized successfully');
      
    } catch (error) {
      console.error('[WebSocketSystem] Error initializing WebSocket system:', error);
      throw error;
    }
  }

  /**
   * Start the WebSocket system
   * @returns {Promise<void>}
   */
  async start() {
    try {
      if (!this.isInitialized) {
        throw new Error('WebSocket system not initialized');
      }

      console.log('[WebSocketSystem] Starting WebSocket system...');
      
      // Start Soroban event emitter
      await this.sorobanEmitter.start();
      
      this.isRunning = true;
      console.log('[WebSocketSystem] WebSocket system started successfully');
      
    } catch (error) {
      console.error('[WebSocketSystem] Error starting WebSocket system:', error);
      throw error;
    }
  }

  /**
   * Stop the WebSocket system
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      console.log('[WebSocketSystem] Stopping WebSocket system...');
      
      this.isRunning = false;
      
      // Stop Soroban event emitter
      if (this.sorobanEmitter) {
        await this.sorobanEmitter.stop();
      }
      
      // Shutdown WebSocket gateway
      if (this.gateway) {
        await this.gateway.shutdown();
      }
      
      console.log('[WebSocketSystem] WebSocket system stopped successfully');
      
    } catch (error) {
      console.error('[WebSocketSystem] Error stopping WebSocket system:', error);
    }
  }

  /**
   * Set up event listeners between components
   */
  setupEventListeners() {
    // Forward Soroban events to gateway
    this.sorobanEmitter.on('lease_event', (eventData) => {
      this.gateway.emit('soroban_event', eventData);
    });

    // Forward gateway events to performance monitor
    this.gateway.on('connection', (socket) => {
      this.performanceMonitor.recordConnection(socket.id, socket.user.pubkey, 'connect');
    });

    this.gateway.on('disconnect', (socket) => {
      this.performanceMonitor.recordConnection(socket.id, socket.user.pubkey, 'disconnect');
    });

    // Forward security events to performance monitor
    this.gateway.on('security_violation', (violation) => {
      this.performanceMonitor.recordSecurityEvent('security_violation', violation);
    });

    // Forward performance alerts
    this.performanceMonitor.on('performance_alert', (alert) => {
      console.warn(`[WebSocketSystem] Performance alert: ${alert.message}`);
      // Could send to external monitoring system
    });

    // Forward health status changes
    this.performanceMonitor.on('health_status', (health) => {
      console.log(`[WebSocketSystem] Health status: ${health.status}`);
      // Could update external health check endpoint
    });

    console.log('[WebSocketSystem] Event listeners configured');
  }

  /**
   * Get system statistics
   * @returns {object} System statistics
   */
  getStats() {
    const stats = {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      timestamp: new Date().toISOString()
    };

    if (this.gateway) {
      stats.gateway = this.gateway.getStats();
    }

    if (this.sorobanEmitter) {
      stats.sorobanEmitter = this.sorobanEmitter.getMetrics();
    }

    if (this.performanceMonitor) {
      stats.performance = this.performanceMonitor.getPerformanceReport();
    }

    return stats;
  }

  /**
   * Get health status
   * @returns {object} Health status
   */
  getHealthStatus() {
    const health = {
      status: 'unknown',
      components: {},
      timestamp: new Date().toISOString()
    };

    // Check gateway health
    if (this.gateway) {
      const gatewayStats = this.gateway.getStats();
      health.components.gateway = {
        status: 'healthy',
        activeConnections: gatewayStats.activeConnections,
        messagesSent: gatewayStats.messagesSent,
        errors: gatewayStats.errors
      };
    }

    // Check Soroban emitter health
    if (this.sorobanEmitter) {
      const sorobanStats = this.sorobanEmitter.getMetrics();
      health.components.sorobanEmitter = {
        status: sorobanStats.isListening ? 'healthy' : 'unhealthy',
        eventsProcessed: sorobanStats.eventsProcessed,
        eventsFailed: sorobanStats.eventsFailed,
        bufferSize: sorobanStats.bufferSize
      };
    }

    // Check performance monitor health
    if (this.performanceMonitor) {
      const perfReport = this.performanceMonitor.getPerformanceReport();
      health.components.performanceMonitor = {
        status: perfReport.health.status,
        uptime: perfReport.uptime.humanReadable,
        errorRate: perfReport.performance.errorRate.formatted,
        memoryUsage: perfReport.performance.memory.formatted
      };
    }

    // Determine overall health
    const componentStatuses = Object.values(health.components).map(c => c.status);
    if (componentStatuses.every(status => status === 'healthy')) {
      health.status = 'healthy';
    } else if (componentStatuses.some(status => status === 'critical' || status === 'unhealthy')) {
      health.status = 'critical';
    } else if (componentStatuses.some(status => status === 'warning' || status === 'degraded')) {
      health.status = 'warning';
    } else {
      health.status = 'healthy';
    }

    return health;
  }

  /**
   * Broadcast lease event (external API)
   * @param {object} eventData - Event data
   * @returns {Promise<boolean>} Success status
   */
  async broadcastLeaseEvent(eventData) {
    if (!this.isRunning) {
      console.warn('[WebSocketSystem] Cannot broadcast event - system not running');
      return false;
    }

    try {
      await this.gateway.broadcastLeaseEvent(eventData);
      return true;
    } catch (error) {
      console.error('[WebSocketSystem] Error broadcasting lease event:', error);
      return false;
    }
  }

  /**
   * Get connected clients
   * @returns {Array} Array of connected client information
   */
  getConnectedClients() {
    if (!this.gateway) {
      return [];
    }

    return this.gateway.getConnectedClients();
  }

  /**
   * Get performance metrics
   * @returns {object} Performance metrics
   */
  getPerformanceMetrics() {
    if (!this.performanceMonitor) {
      return {};
    }

    return this.performanceMonitor.getPerformanceReport();
  }

  /**
   * Get security metrics
   * @returns {object} Security metrics
   */
  getSecurityMetrics() {
    const metrics = {};

    if (this.gateway) {
      const authStats = this.gateway.authMiddleware ? this.gateway.authMiddleware.getStats() : null;
      metrics.gateway = {
        activeConnections: authStats?.totalConnections || 0,
        uniqueUsers: authStats?.uniqueUsers || 0
      };
    }

    if (this.performanceMonitor) {
      const perfMetrics = this.performanceMonitor.getPerformanceReport();
      metrics.security = perfMetrics.security;
    }

    return metrics;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    if (this.performanceMonitor) {
      this.performanceMonitor.resetMetrics();
    }

    if (this.gateway && this.gateway.authMiddleware) {
      this.gateway.authMiddleware.resetMetrics();
    }

    if (this.sorobanEmitter) {
      this.sorobanEmitter.resetMetrics();
    }

    console.log('[WebSocketSystem] Metrics reset');
  }

  /**
   * Handle external Soroban event
   * @param {object} sorobanEvent - Soroban event data
   * @returns {Promise<void>}
   */
  async handleSorobanEvent(sorobanEvent) {
    if (!this.isRunning) {
      console.warn('[WebSocketSystem] Cannot handle Soroban event - system not running');
      return;
    }

    try {
      await this.sorobanEmitter.handleSorobanEvent(sorobanEvent);
    } catch (error) {
      console.error('[WebSocketSystem] Error handling Soroban event:', error);
    }
  }

  /**
   * Get system configuration
   * @returns {object} System configuration
   */
  getConfiguration() {
    return {
      websocket: {
        enabled: this.config.websocket?.enabled !== false,
        heartbeatInterval: this.config.websocket?.heartbeatInterval || 30000,
        heartbeatTimeout: this.config.websocket?.heartbeatTimeout || 10000,
        maxConnections: this.config.websocket?.maxConnections || 1000,
        dataLeakageProtection: this.config.websocket?.dataLeakageProtection !== false
      },
      redis: {
        enabled: !!this.config.redis,
        host: this.config.redis?.host || 'localhost',
        port: this.config.redis?.port || 6379
      },
      performance: {
        monitoringInterval: this.config.websocket?.monitoringInterval || 30000,
        maxLatency: this.config.websocket?.maxLatency || 100,
        maxErrorRate: this.config.websocket?.maxErrorRate || 0.05
      }
    };
  }
}

module.exports = WebSocketSystem;
