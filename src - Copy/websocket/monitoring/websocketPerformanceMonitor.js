const EventEmitter = require('events');

/**
 * WebSocket Performance Monitor
 * Tracks performance metrics for WebSocket operations and system health
 */
class WebSocketPerformanceMonitor extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    
    // Metrics storage
    this.metrics = {
      connections: {
        total: 0,
        active: 0,
        peak: 0,
        averageDuration: 0,
        totalConnections: 0,
        totalDuration: 0
      },
      messages: {
        sent: 0,
        received: 0,
        failed: 0,
        averageSize: 0,
        totalSize: 0,
        byType: {}
      },
      events: {
        processed: 0,
        blocked: 0,
        failed: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0,
        byType: {}
      },
      performance: {
        latency: [],
        throughput: [],
        memoryUsage: [],
        cpuUsage: [],
        errorRate: 0,
        lastUpdated: null
      },
      security: {
        authenticationAttempts: 0,
        authenticationFailures: 0,
        rateLimitHits: 0,
        dataLeakageBlocked: 0,
        securityViolations: 0
      },
      health: {
        uptime: Date.now(),
        lastHealthCheck: null,
        status: 'healthy',
        alerts: []
      }
    };
    
    // Performance thresholds
    this.thresholds = {
      maxLatency: config.websocket?.maxLatency || 100, // ms
      maxMemoryUsage: config.websocket?.maxMemoryUsage || 0.8, // 80%
      maxErrorRate: config.websocket?.maxErrorRate || 0.05, // 5%
      maxConnections: config.websocket?.maxConnections || 1000,
      maxMessageSize: config.websocket?.maxMessageSize || 1024 * 1024 // 1MB
    };
    
    // Monitoring intervals
    this.monitoringInterval = config.websocket?.monitoringInterval || 30000; // 30 seconds
    this.alertCooldown = config.websocket?.alertCooldown || 300000; // 5 minutes
    this.lastAlerts = new Map(); // alertType -> timestamp
    
    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Start performance monitoring
   */
  startMonitoring() {
    setInterval(() => {
      this.collectMetrics();
      this.checkThresholds();
      this.updateHealthStatus();
    }, this.monitoringInterval);
    
    console.log('[WebSocketPerformanceMonitor] Performance monitoring started');
  }

  /**
   * Record connection metrics
   * @param {string} socketId - Socket ID
   * @param {string} pubkey - User public key
   * @param {string} action - Action (connect/disconnect)
   */
  recordConnection(socketId, pubkey, action) {
    if (action === 'connect') {
      this.metrics.connections.total++;
      this.metrics.connections.active++;
      
      // Track peak connections
      if (this.metrics.connections.active > this.metrics.connections.peak) {
        this.metrics.connections.peak = this.metrics.connections.active;
      }
      
      // Record connection start time
      if (!this.connectionStartTimes) {
        this.connectionStartTimes = new Map();
      }
      this.connectionStartTimes.set(socketId, Date.now());
      
    } else if (action === 'disconnect') {
      this.metrics.connections.active = Math.max(0, this.metrics.connections.active - 1);
      
      // Calculate connection duration
      if (this.connectionStartTimes && this.connectionStartTimes.has(socketId)) {
        const startTime = this.connectionStartTimes.get(socketId);
        const duration = Date.now() - startTime;
        
        this.metrics.connections.totalDuration += duration;
        this.metrics.connections.totalConnections++;
        this.metrics.connections.averageDuration = 
          this.metrics.connections.totalDuration / this.metrics.connections.totalConnections;
        
        this.connectionStartTimes.delete(socketId);
      }
    }
  }

  /**
   * Record message metrics
   * @param {string} direction - Direction (sent/received)
   * @param {string} type - Message type
   * @param {number} size - Message size in bytes
   * @param {boolean} success - Whether operation was successful
   */
  recordMessage(direction, type, size, success = true) {
    if (direction === 'sent') {
      this.metrics.messages.sent++;
      if (!success) this.metrics.messages.failed++;
    } else if (direction === 'received') {
      this.metrics.messages.received++;
      if (!success) this.metrics.messages.failed++;
    }
    
    // Track by type
    if (!this.metrics.messages.byType[type]) {
      this.metrics.messages.byType[type] = {
        sent: 0,
        received: 0,
        failed: 0,
        totalSize: 0
      };
    }
    
    this.metrics.messages.byType[type][direction]++;
    if (!success) this.metrics.messages.byType[type].failed++;
    this.metrics.messages.byType[type].totalSize += size;
    
    // Update average size
    this.metrics.messages.totalSize += size;
    const totalMessages = this.metrics.messages.sent + this.metrics.messages.received;
    this.metrics.messages.averageSize = totalMessages > 0 ? this.metrics.messages.totalSize / totalMessages : 0;
  }

  /**
   * Record event processing metrics
   * @param {string} eventType - Event type
   * @param {number} processingTime - Processing time in milliseconds
   * @param {boolean} success - Whether processing was successful
   * @param {string} blockReason - Reason for blocking (if applicable)
   */
  recordEvent(eventType, processingTime, success, blockReason = null) {
    if (success) {
      this.metrics.events.processed++;
    } else {
      if (blockReason) {
        this.metrics.events.blocked++;
      } else {
        this.metrics.events.failed++;
      }
    }
    
    // Track by type
    if (!this.metrics.events.byType[eventType]) {
      this.metrics.events.byType[eventType] = {
        processed: 0,
        blocked: 0,
        failed: 0,
        totalProcessingTime: 0
      };
    }
    
    this.metrics.events.totalProcessingTime += processingTime;
    this.metrics.events.averageProcessingTime = 
      this.metrics.events.totalProcessingTime / (this.metrics.events.processed + this.metrics.events.failed);
    
    this.metrics.events.byType[eventType].totalProcessingTime += processingTime;
    if (success) {
      this.metrics.events.byType[eventType].processed++;
    } else if (blockReason) {
      this.metrics.events.byType[eventType].blocked++;
    } else {
      this.metrics.events.byType[eventType].failed++;
    }
  }

  /**
   * Record security metrics
   * @param {string} type - Security event type
   * @param {object} details - Event details
   */
  recordSecurityEvent(type, details = {}) {
    switch (type) {
      case 'authentication_attempt':
        this.metrics.security.authenticationAttempts++;
        break;
      case 'authentication_failure':
        this.metrics.security.authenticationFailures++;
        break;
      case 'rate_limit_hit':
        this.metrics.security.rateLimitHits++;
        break;
      case 'data_leakage_blocked':
        this.metrics.security.dataLeakageBlocked++;
        break;
      case 'security_violation':
        this.metrics.security.securityViolations++;
        break;
    }
    
    // Emit security event for alerting
    this.emit('security_event', {
      type,
      timestamp: new Date().toISOString(),
      details
    });
  }

  /**
   * Record latency measurement
   * @param {number} latency - Latency in milliseconds
   * @param {string} operation - Operation type
   */
  recordLatency(latency, operation = 'general') {
    this.metrics.performance.latency.push({
      value: latency,
      operation,
      timestamp: Date.now()
    });
    
    // Keep only last 1000 measurements
    if (this.metrics.performance.latency.length > 1000) {
      this.metrics.performance.latency.shift();
    }
  }

  /**
   * Record throughput measurement
   * @param {number} throughput - Messages per second
   */
  recordThroughput(throughput) {
    this.metrics.performance.throughput.push({
      value: throughput,
      timestamp: Date.now()
    });
    
    // Keep only last 100 measurements
    if (this.metrics.performance.throughput.length > 100) {
      this.metrics.performance.throughput.shift();
    }
  }

  /**
   * Collect system metrics
   */
  collectMetrics() {
    try {
      // Memory usage
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
      const memoryUsagePercent = memoryUsageMB / (memoryUsage.heapTotal / 1024 / 1024);
      
      this.metrics.performance.memoryUsage.push({
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
        percent: memoryUsagePercent,
        timestamp: Date.now()
      });
      
      // Keep only last 100 measurements
      if (this.metrics.performance.memoryUsage.length > 100) {
        this.metrics.performance.memoryUsage.shift();
      }
      
      // CPU usage (simplified)
      const cpuUsage = process.cpuUsage();
      this.metrics.performance.cpuUsage.push({
        user: cpuUsage.user,
        system: cpuUsage.system,
        timestamp: Date.now()
      });
      
      if (this.metrics.performance.cpuUsage.length > 100) {
        this.metrics.performance.cpuUsage.shift();
      }
      
      // Calculate error rate
      const totalOperations = this.metrics.messages.sent + this.metrics.messages.received + this.metrics.events.processed;
      const totalErrors = this.metrics.messages.failed + this.metrics.events.failed;
      this.metrics.performance.errorRate = totalOperations > 0 ? totalErrors / totalOperations : 0;
      
      this.metrics.performance.lastUpdated = new Date().toISOString();
      
    } catch (error) {
      console.error('[WebSocketPerformanceMonitor] Error collecting metrics:', error);
    }
  }

  /**
   * Check performance thresholds and emit alerts
   */
  checkThresholds() {
    const now = Date.now();
    
    // Check latency threshold
    const recentLatency = this.getAverageLatency();
    if (recentLatency > this.thresholds.maxLatency) {
      this.checkAndEmitAlert('high_latency', `Average latency (${recentLatency.toFixed(2)}ms) exceeds threshold (${this.thresholds.maxLatency}ms)`, now);
    }
    
    // Check memory usage threshold
    const recentMemoryUsage = this.getAverageMemoryUsage();
    if (recentMemoryUsage > this.thresholds.maxMemoryUsage) {
      this.checkAndEmitAlert('high_memory', `Memory usage (${(recentMemoryUsage * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.maxMemoryUsage * 100).toFixed(2)}%)`, now);
    }
    
    // Check error rate threshold
    if (this.metrics.performance.errorRate > this.thresholds.maxErrorRate) {
      this.checkAndEmitAlert('high_error_rate', `Error rate (${(this.metrics.performance.errorRate * 100).toFixed(2)}%) exceeds threshold (${(this.thresholds.maxErrorRate * 100).toFixed(2)}%)`, now);
    }
    
    // Check connection threshold
    if (this.metrics.connections.active > this.thresholds.maxConnections) {
      this.checkAndEmitAlert('high_connections', `Active connections (${this.metrics.connections.active}) exceeds threshold (${this.thresholds.maxConnections})`, now);
    }
    
    // Check security events
    const recentSecurityEvents = this.metrics.security.authenticationFailures + this.metrics.security.securityViolations;
    if (recentSecurityEvents > 10) { // Arbitrary threshold
      this.checkAndEmitAlert('security_issues', `High number of security events (${recentSecurityEvents}) detected`, now);
    }
  }

  /**
   * Check and emit alert with cooldown
   * @param {string} alertType - Alert type
   * @param {string} message - Alert message
   * @param {number} timestamp - Timestamp
   */
  checkAndEmitAlert(alertType, message, timestamp) {
    const lastAlertTime = this.lastAlerts.get(alertType);
    
    if (!lastAlertTime || (timestamp - lastAlertTime) > this.alertCooldown) {
      const alert = {
        type: alertType,
        message,
        severity: this.getAlertSeverity(alertType),
        timestamp: new Date(timestamp).toISOString(),
        metrics: this.getRelevantMetrics(alertType)
      };
      
      this.metrics.health.alerts.push(alert);
      
      // Keep only last 50 alerts
      if (this.metrics.health.alerts.length > 50) {
        this.metrics.health.alerts.shift();
      }
      
      this.lastAlerts.set(alertType, timestamp);
      
      // Emit alert for external handling
      this.emit('performance_alert', alert);
      
      console.warn(`[WebSocketPerformanceMonitor] Alert: ${message}`);
    }
  }

  /**
   * Get alert severity based on type
   * @param {string} alertType - Alert type
   * @returns {string} Severity level
   */
  getAlertSeverity(alertType) {
    const severityMap = {
      'high_latency': 'warning',
      'high_memory': 'critical',
      'high_error_rate': 'critical',
      'high_connections': 'warning',
      'security_issues': 'critical'
    };
    
    return severityMap[alertType] || 'info';
  }

  /**
   * Get relevant metrics for alert
   * @param {string} alertType - Alert type
   * @returns {object} Relevant metrics
   */
  getRelevantMetrics(alertType) {
    const relevant = {};
    
    switch (alertType) {
      case 'high_latency':
        relevant.averageLatency = this.getAverageLatency();
        relevant.recentLatency = this.getRecentLatency();
        break;
      case 'high_memory':
        relevant.averageMemoryUsage = this.getAverageMemoryUsage();
        relevant.recentMemoryUsage = this.getRecentMemoryUsage();
        break;
      case 'high_error_rate':
        relevant.errorRate = this.metrics.performance.errorRate;
        relevant.totalErrors = this.metrics.messages.failed + this.metrics.events.failed;
        break;
      case 'high_connections':
        relevant.activeConnections = this.metrics.connections.active;
        relevant.peakConnections = this.metrics.connections.peak;
        break;
      case 'security_issues':
        relevant.authenticationFailures = this.metrics.security.authenticationFailures;
        relevant.securityViolations = this.metrics.security.securityViolations;
        break;
    }
    
    return relevant;
  }

  /**
   * Update overall health status
   */
  updateHealthStatus() {
    const now = new Date().toISOString();
    this.metrics.health.lastHealthCheck = now;
    
    // Determine health status based on metrics and alerts
    const recentAlerts = this.metrics.health.alerts.filter(
      alert => (Date.now() - new Date(alert.timestamp).getTime()) < 300000 // Last 5 minutes
    );
    
    const criticalAlerts = recentAlerts.filter(alert => alert.severity === 'critical');
    const warningAlerts = recentAlerts.filter(alert => alert.severity === 'warning');
    
    if (criticalAlerts.length > 0) {
      this.metrics.health.status = 'critical';
    } else if (warningAlerts.length > 3) {
      this.metrics.health.status = 'degraded';
    } else if (warningAlerts.length > 0) {
      this.metrics.health.status = 'warning';
    } else {
      this.metrics.health.status = 'healthy';
    }
    
    // Emit health status change
    this.emit('health_status', {
      status: this.metrics.health.status,
      timestamp: now,
      alerts: recentAlerts.length,
      metrics: {
        activeConnections: this.metrics.connections.active,
        errorRate: this.metrics.performance.errorRate,
        averageLatency: this.getAverageLatency(),
        memoryUsage: this.getAverageMemoryUsage()
      }
    });
  }

  /**
   * Get average latency
   * @returns {number} Average latency in milliseconds
   */
  getAverageLatency() {
    if (this.metrics.performance.latency.length === 0) return 0;
    
    const sum = this.metrics.performance.latency.reduce((acc, curr) => acc + curr.value, 0);
    return sum / this.metrics.performance.latency.length;
  }

  /**
   * Get recent latency (last 10 measurements)
   * @returns {number} Recent average latency
   */
  getRecentLatency() {
    const recent = this.metrics.performance.latency.slice(-10);
    if (recent.length === 0) return 0;
    
    const sum = recent.reduce((acc, curr) => acc + curr.value, 0);
    return sum / recent.length;
  }

  /**
   * Get average memory usage
   * @returns {number} Average memory usage as percentage
   */
  getAverageMemoryUsage() {
    if (this.metrics.performance.memoryUsage.length === 0) return 0;
    
    const sum = this.metrics.performance.memoryUsage.reduce((acc, curr) => acc + curr.percent, 0);
    return sum / this.metrics.performance.memoryUsage.length;
  }

  /**
   * Get recent memory usage (last 10 measurements)
   * @returns {number} Recent average memory usage
   */
  getRecentMemoryUsage() {
    const recent = this.metrics.performance.memoryUsage.slice(-10);
    if (recent.length === 0) return 0;
    
    const sum = recent.reduce((acc, curr) => acc + curr.percent, 0);
    return sum / recent.length;
  }

  /**
   * Get throughput metrics
   * @returns {object} Throughput metrics
   */
  getThroughputMetrics() {
    if (this.metrics.performance.throughput.length === 0) {
      return {
        current: 0,
        average: 0,
        peak: 0
      };
    }
    
    const values = this.metrics.performance.throughput.map(t => t.value);
    const current = values[values.length - 1] || 0;
    const average = values.reduce((acc, curr) => acc + curr, 0) / values.length;
    const peak = Math.max(...values);
    
    return { current, average, peak };
  }

  /**
   * Get comprehensive performance report
   * @returns {object} Performance report
   */
  getPerformanceReport() {
    const uptime = Date.now() - this.metrics.health.uptime;
    
    return {
      uptime: {
        milliseconds: uptime,
        humanReadable: this.formatUptime(uptime)
      },
      connections: {
        ...this.metrics.connections,
        averageDurationFormatted: this.formatDuration(this.metrics.connections.averageDuration)
      },
      messages: {
        ...this.metrics.messages,
        successRate: this.calculateSuccessRate()
      },
      events: {
        ...this.metrics.events,
        averageProcessingTimeFormatted: this.formatDuration(this.metrics.events.averageProcessingTime)
      },
      performance: {
        latency: {
          average: this.getAverageLatency(),
          recent: this.getRecentLatency(),
          formatted: this.formatDuration(this.getAverageLatency())
        },
        memory: {
          average: this.getAverageMemoryUsage(),
          recent: this.getRecentMemoryUsage(),
          formatted: `${(this.getAverageMemoryUsage() * 100).toFixed(2)}%`
        },
        throughput: this.getThroughputMetrics(),
        errorRate: {
          value: this.metrics.performance.errorRate,
          formatted: `${(this.metrics.performance.errorRate * 100).toFixed(2)}%`
        }
      },
      security: { ...this.metrics.security },
      health: {
        ...this.metrics.health,
        uptimeFormatted: this.formatUptime(uptime)
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Calculate success rate
   * @returns {number} Success rate as percentage
   */
  calculateSuccessRate() {
    const total = this.metrics.messages.sent + this.metrics.messages.received;
    const successful = total - this.metrics.messages.failed;
    
    return total > 0 ? (successful / total) * 100 : 100;
  }

  /**
   * Format duration in human readable format
   * @param {number} duration - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(duration) {
    if (duration < 1000) {
      return `${duration.toFixed(2)}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(2)}s`;
    } else {
      return `${(duration / 60000).toFixed(2)}m`;
    }
  }

  /**
   * Format uptime in human readable format
   * @param {number} uptime - Uptime in milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(uptime) {
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((uptime % (60 * 60 * 1000)) / (60 * 1000));
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.length > 0 ? parts.join(' ') : '0m';
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics = {
      connections: {
        total: 0,
        active: 0,
        peak: 0,
        averageDuration: 0,
        totalConnections: 0,
        totalDuration: 0
      },
      messages: {
        sent: 0,
        received: 0,
        failed: 0,
        averageSize: 0,
        totalSize: 0,
        byType: {}
      },
      events: {
        processed: 0,
        blocked: 0,
        failed: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0,
        byType: {}
      },
      performance: {
        latency: [],
        throughput: [],
        memoryUsage: [],
        cpuUsage: [],
        errorRate: 0,
        lastUpdated: null
      },
      security: {
        authenticationAttempts: 0,
        authenticationFailures: 0,
        rateLimitHits: 0,
        dataLeakageBlocked: 0,
        securityViolations: 0
      },
      health: {
        uptime: Date.now(),
        lastHealthCheck: null,
        status: 'healthy',
        alerts: []
      }
    };
    
    this.lastAlerts.clear();
    if (this.connectionStartTimes) {
      this.connectionStartTimes.clear();
    }
    
    console.log('[WebSocketPerformanceMonitor] Metrics reset');
  }

  /**
   * Get metrics for specific time range
   * @param {number} minutes - Time range in minutes
   * @returns {object} Metrics for time range
   */
  getMetricsForTimeRange(minutes) {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    
    return {
      connections: {
        averageDuration: this.getAverageMetricInRange(this.metrics.connections.averageDuration, cutoffTime)
      },
      messages: {
        sent: this.getCountInRange(this.metrics.messages.sent, cutoffTime),
        received: this.getCountInRange(this.metrics.messages.received, cutoffTime),
        failed: this.getCountInRange(this.metrics.messages.failed, cutoffTime)
      },
      events: {
        processed: this.getCountInRange(this.metrics.events.processed, cutoffTime),
        blocked: this.getCountInRange(this.metrics.events.blocked, cutoffTime),
        failed: this.getCountInRange(this.metrics.events.failed, cutoffTime)
      },
      alerts: this.metrics.health.alerts.filter(
        alert => new Date(alert.timestamp).getTime() > cutoffTime
      )
    };
  }

  /**
   * Get average metric in time range (simplified)
   * @param {number} value - Current value
   * @param {number} cutoffTime - Cutoff time
   * @returns {number} Average value
   */
  getAverageMetricInRange(value, cutoffTime) {
    // This is a simplified implementation
    // In production, you would store time-series data
    return value;
  }

  /**
   * Get count in time range (simplified)
   * @param {number} count - Current count
   * @param {number} cutoffTime - Cutoff time
   * @returns {number} Count in range
   */
  getCountInRange(count, cutoffTime) {
    // This is a simplified implementation
    // In production, you would store time-series data
    return count;
  }
}

module.exports = WebSocketPerformanceMonitor;
