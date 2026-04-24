/**
 * RWA Performance Monitor
 * Tracks performance metrics for RWA cache operations and system health
 */
class RwaPerformanceMonitor {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.metrics = {
      cacheOperations: {
        hits: 0,
        misses: 0,
        fallbacks: 0,
        errors: 0,
        avgResponseTime: 0,
        totalOperations: 0
      },
      blockchainOperations: {
        queries: 0,
        errors: 0,
        avgResponseTime: 0,
        totalQueries: 0
      },
      syncOperations: {
        jobs: 0,
        completed: 0,
        failed: 0,
        avgProcessingTime: 0,
        totalJobs: 0
      },
      eventProcessing: {
        eventsProcessed: 0,
        eventsFailed: 0,
        avgProcessingTime: 0,
        totalEvents: 0
      },
      apiEndpoints: {
        requests: 0,
        errors: 0,
        avgResponseTime: 0,
        totalRequests: 0
      }
    };
    
    this.responseTimes = {
      cache: [],
      blockchain: [],
      sync: [],
      events: [],
      api: []
    };
    
    this.maxResponseTimeSamples = 1000;
    this.metricsFlushInterval = config.rwaPerformance?.flushInterval || 60000; // 1 minute
    this.alertThresholds = config.rwaPerformance?.alertThresholds || {
      avgResponseTime: 100, // ms
      errorRate: 0.05, // 5%
      cacheHitRatio: 0.8 // 80%
    };
    
    this.startMetricsFlush();
  }

  /**
   * Record cache operation
   * @param {string} operation - Operation type (hit, miss, fallback, error)
   * @param {number} responseTime - Response time in milliseconds
   * @returns {void}
   */
  recordCacheOperation(operation, responseTime) {
    this.metrics.cacheOperations.totalOperations++;
    
    switch (operation) {
      case 'hit':
        this.metrics.cacheOperations.hits++;
        break;
      case 'miss':
        this.metrics.cacheOperations.misses++;
        break;
      case 'fallback':
        this.metrics.cacheOperations.fallbacks++;
        break;
      case 'error':
        this.metrics.cacheOperations.errors++;
        break;
    }
    
    this.updateResponseTime('cache', responseTime);
    this.checkPerformanceAlerts();
  }

  /**
   * Record blockchain operation
   * @param {boolean} success - Whether operation was successful
   * @param {number} responseTime - Response time in milliseconds
   * @returns {void}
   */
  recordBlockchainOperation(success, responseTime) {
    this.metrics.blockchainOperations.totalQueries++;
    
    if (success) {
      this.metrics.blockchainOperations.queries++;
    } else {
      this.metrics.blockchainOperations.errors++;
    }
    
    this.updateResponseTime('blockchain', responseTime);
  }

  /**
   * Record sync operation
   * @param {boolean} success - Whether job was successful
   * @param {number} processingTime - Processing time in milliseconds
   * @returns {void}
   */
  recordSyncOperation(success, processingTime) {
    this.metrics.syncOperations.totalJobs++;
    
    if (success) {
      this.metrics.syncOperations.completed++;
    } else {
      this.metrics.syncOperations.failed++;
    }
    
    this.updateResponseTime('sync', processingTime);
  }

  /**
   * Record event processing
   * @param {boolean} success - Whether event was processed successfully
   * @param {number} processingTime - Processing time in milliseconds
   * @returns {void}
   */
  recordEventProcessing(success, processingTime) {
    this.metrics.eventProcessing.totalEvents++;
    
    if (success) {
      this.metrics.eventProcessing.eventsProcessed++;
    } else {
      this.metrics.eventProcessing.eventsFailed++;
    }
    
    this.updateResponseTime('events', processingTime);
  }

  /**
   * Record API endpoint request
   * @param {boolean} success - Whether request was successful
   * @param {number} responseTime - Response time in milliseconds
   * @param {string} endpoint - Endpoint name
   * @returns {void}
   */
  recordApiRequest(success, responseTime, endpoint) {
    this.metrics.apiEndpoints.totalRequests++;
    
    if (success) {
      this.metrics.apiEndpoints.requests++;
    } else {
      this.metrics.apiEndpoints.errors++;
    }
    
    this.updateResponseTime('api', responseTime);
  }

  /**
   * Update response time metrics
   * @param {string} category - Metric category
   * @param {number} responseTime - Response time in milliseconds
   * @returns {void}
   */
  updateResponseTime(category, responseTime) {
    const responseTimes = this.responseTimes[category];
    
    responseTimes.push(responseTime);
    
    // Keep only the most recent samples
    if (responseTimes.length > this.maxResponseTimeSamples) {
      responseTimes.shift();
    }
    
    // Update average response time
    const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    
    switch (category) {
      case 'cache':
        this.metrics.cacheOperations.avgResponseTime = avgResponseTime;
        break;
      case 'blockchain':
        this.metrics.blockchainOperations.avgResponseTime = avgResponseTime;
        break;
      case 'sync':
        this.metrics.syncOperations.avgProcessingTime = avgResponseTime;
        break;
      case 'events':
        this.metrics.eventProcessing.avgProcessingTime = avgResponseTime;
        break;
      case 'api':
        this.metrics.apiEndpoints.avgResponseTime = avgResponseTime;
        break;
    }
  }

  /**
   * Get current metrics
   * @returns {object} Current performance metrics
   */
  getMetrics() {
    const now = new Date().toISOString();
    
    return {
      timestamp: now,
      cache: {
        ...this.metrics.cacheOperations,
        hitRatio: this.calculateHitRatio(),
        missRatio: this.calculateMissRatio(),
        fallbackRatio: this.calculateFallbackRatio(),
        errorRate: this.calculateCacheErrorRate()
      },
      blockchain: {
        ...this.metrics.blockchainOperations,
        errorRate: this.calculateBlockchainErrorRate()
      },
      sync: {
        ...this.metrics.syncOperations,
        successRate: this.calculateSyncSuccessRate()
      },
      events: {
        ...this.metrics.eventProcessing,
        successRate: this.calculateEventSuccessRate()
      },
      api: {
        ...this.metrics.apiEndpoints,
        errorRate: this.calculateApiErrorRate()
      }
    };
  }

  /**
   * Calculate cache hit ratio
   * @returns {number} Hit ratio as percentage
   */
  calculateHitRatio() {
    const { hits, totalOperations } = this.metrics.cacheOperations;
    return totalOperations > 0 ? (hits / totalOperations) * 100 : 0;
  }

  /**
   * Calculate cache miss ratio
   * @returns {number} Miss ratio as percentage
   */
  calculateMissRatio() {
    const { misses, totalOperations } = this.metrics.cacheOperations;
    return totalOperations > 0 ? (misses / totalOperations) * 100 : 0;
  }

  /**
   * Calculate cache fallback ratio
   * @returns {number} Fallback ratio as percentage
   */
  calculateFallbackRatio() {
    const { fallbacks, totalOperations } = this.metrics.cacheOperations;
    return totalOperations > 0 ? (fallbacks / totalOperations) * 100 : 0;
  }

  /**
   * Calculate cache error rate
   * @returns {number} Error rate as percentage
   */
  calculateCacheErrorRate() {
    const { errors, totalOperations } = this.metrics.cacheOperations;
    return totalOperations > 0 ? (errors / totalOperations) * 100 : 0;
  }

  /**
   * Calculate blockchain error rate
   * @returns {number} Error rate as percentage
   */
  calculateBlockchainErrorRate() {
    const { errors, totalQueries } = this.metrics.blockchainOperations;
    return totalQueries > 0 ? (errors / totalQueries) * 100 : 0;
  }

  /**
   * Calculate sync success rate
   * @returns {number} Success rate as percentage
   */
  calculateSyncSuccessRate() {
    const { completed, totalJobs } = this.metrics.syncOperations;
    return totalJobs > 0 ? (completed / totalJobs) * 100 : 0;
  }

  /**
   * Calculate event success rate
   * @returns {number} Success rate as percentage
   */
  calculateEventSuccessRate() {
    const { eventsProcessed, totalEvents } = this.metrics.eventProcessing;
    return totalEvents > 0 ? (eventsProcessed / totalEvents) * 100 : 0;
  }

  /**
   * Calculate API error rate
   * @returns {number} Error rate as percentage
   */
  calculateApiErrorRate() {
    const { errors, totalRequests } = this.metrics.apiEndpoints;
    return totalRequests > 0 ? (errors / totalRequests) * 100 : 0;
  }

  /**
   * Check for performance alerts
   * @returns {Array} Array of alerts
   */
  checkPerformanceAlerts() {
    const alerts = [];
    const metrics = this.getMetrics();
    
    // Check cache hit ratio
    if (metrics.cache.hitRatio < this.alertThresholds.cacheHitRatio * 100) {
      alerts.push({
        type: 'cache_hit_ratio_low',
        severity: 'warning',
        message: `Cache hit ratio (${metrics.cache.hitRatio.toFixed(2)}%) is below threshold (${this.alertThresholds.cacheHitRatio * 100}%)`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Check cache response time
    if (metrics.cache.avgResponseTime > this.alertThresholds.avgResponseTime) {
      alerts.push({
        type: 'cache_response_time_high',
        severity: 'warning',
        message: `Cache response time (${metrics.cache.avgResponseTime.toFixed(2)}ms) is above threshold (${this.alertThresholds.avgResponseTime}ms)`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Check blockchain error rate
    if (metrics.blockchain.errorRate > this.alertThresholds.errorRate * 100) {
      alerts.push({
        type: 'blockchain_error_rate_high',
        severity: 'critical',
        message: `Blockchain error rate (${metrics.blockchain.errorRate.toFixed(2)}%) is above threshold (${this.alertThresholds.errorRate * 100}%)`,
        timestamp: new Date().toISOString()
      });
    }
    
    // Check sync success rate
    if (metrics.sync.successRate < (1 - this.alertThresholds.errorRate) * 100) {
      alerts.push({
        type: 'sync_success_rate_low',
        severity: 'warning',
        message: `Sync success rate (${metrics.sync.successRate.toFixed(2)}%) is below threshold (${(1 - this.alertThresholds.errorRate) * 100}%)`,
        timestamp: new Date().toISOString()
      });
    }
    
    return alerts;
  }

  /**
   * Store metrics in database
   * @returns {Promise<void>}
   */
  async storeMetrics() {
    try {
      const metrics = this.getMetrics();
      const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      // Update daily metrics
      this.database.db.prepare(`
        INSERT OR REPLACE INTO rwa_performance_metrics (
          id, metric_date, total_queries, cache_hits, cache_misses,
          blockchain_fallbacks, avg_query_time_ms, avg_sync_time_ms,
          total_sync_errors, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `daily_${date}`,
        date,
        metrics.api.totalRequests,
        metrics.cache.hits,
        metrics.cache.misses,
        metrics.cache.fallbacks,
        metrics.api.avgResponseTime,
        metrics.sync.avgProcessingTime,
        metrics.sync.failed,
        new Date().toISOString(),
        new Date().toISOString()
      );
      
      console.log('[RwaPerformanceMonitor] Metrics stored successfully');
    } catch (error) {
      console.error('[RwaPerformanceMonitor] Error storing metrics:', error);
    }
  }

  /**
   * Get historical metrics
   * @param {number} days - Number of days to retrieve
   * @returns {Array} Array of historical metrics
   */
  getHistoricalMetrics(days = 7) {
    try {
      const metrics = this.database.db.prepare(`
        SELECT * FROM rwa_performance_metrics
        WHERE metric_date >= date('now', '-${days} days')
        ORDER BY metric_date DESC
      `).all();
      
      return metrics;
    } catch (error) {
      console.error('[RwaPerformanceMonitor] Error getting historical metrics:', error);
      return [];
    }
  }

  /**
   * Get performance summary
   * @returns {object} Performance summary
   */
  getPerformanceSummary() {
    const metrics = this.getMetrics();
    const alerts = this.checkPerformanceAlerts();
    const historical = this.getHistoricalMetrics(7);
    
    return {
      current: metrics,
      alerts,
      summary: {
        overallHealth: this.calculateOverallHealth(metrics),
        recommendations: this.generateRecommendations(metrics, alerts),
        trends: this.analyzeTrends(historical)
      }
    };
  }

  /**
   * Calculate overall health score
   * @param {object} metrics - Current metrics
   * @returns {string} Health status (excellent, good, fair, poor)
   */
  calculateOverallHealth(metrics) {
    let score = 100;
    
    // Deduct points for low cache hit ratio
    if (metrics.cache.hitRatio < 80) score -= 20;
    else if (metrics.cache.hitRatio < 90) score -= 10;
    
    // Deduct points for high error rates
    if (metrics.blockchain.errorRate > 5) score -= 20;
    else if (metrics.blockchain.errorRate > 2) score -= 10;
    
    if (metrics.api.errorRate > 5) score -= 20;
    else if (metrics.api.errorRate > 2) score -= 10;
    
    // Deduct points for slow response times
    if (metrics.cache.avgResponseTime > 100) score -= 15;
    else if (metrics.cache.avgResponseTime > 50) score -= 5;
    
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    return 'poor';
  }

  /**
   * Generate performance recommendations
   * @param {object} metrics - Current metrics
   * @param {Array} alerts - Current alerts
   * @returns {Array} Array of recommendations
   */
  generateRecommendations(metrics, alerts) {
    const recommendations = [];
    
    if (metrics.cache.hitRatio < 80) {
      recommendations.push({
        type: 'cache_optimization',
        priority: 'high',
        message: 'Consider increasing cache TTL or implementing more aggressive caching strategies'
      });
    }
    
    if (metrics.blockchain.errorRate > 2) {
      recommendations.push({
        type: 'blockchain_reliability',
        priority: 'high',
        message: 'Review blockchain connectivity and implement better error handling'
      });
    }
    
    if (metrics.cache.avgResponseTime > 50) {
      recommendations.push({
        type: 'performance_optimization',
        priority: 'medium',
        message: 'Consider optimizing cache queries or adding database indexes'
      });
    }
    
    if (metrics.sync.successRate < 95) {
      recommendations.push({
        type: 'sync_reliability',
        priority: 'medium',
        message: 'Review sync job error handling and retry logic'
      });
    }
    
    return recommendations;
  }

  /**
   * Analyze performance trends
   * @param {Array} historical - Historical metrics
   * @returns {object} Trend analysis
   */
  analyzeTrends(historical) {
    if (historical.length < 2) {
      return { status: 'insufficient_data' };
    }
    
    const latest = historical[0];
    const previous = historical[1];
    
    const trends = {
      cacheHitRatio: this.calculateTrend(latest.cache_hits, previous.cache_hits, latest.total_queries, previous.total_queries),
      responseTime: this.calculateTrend(latest.avg_query_time_ms, previous.avg_query_time_ms),
      errorRate: this.calculateTrend(latest.total_sync_errors, previous.total_sync_errors)
    };
    
    return {
      status: 'analyzed',
      trends,
      overall: this.getOverallTrend(trends)
    };
  }

  /**
   * Calculate trend between two values
   * @param {number} current - Current value
   * @param {number} previous - Previous value
   * @param {number} currentTotal - Current total (for ratios)
   * @param {number} previousTotal - Previous total (for ratios)
   * @returns {string} Trend direction (improving, declining, stable)
   */
  calculateTrend(current, previous, currentTotal, previousTotal) {
    if (currentTotal && previousTotal) {
      const currentRatio = current / currentTotal;
      const previousRatio = previous / previousTotal;
      const change = (currentRatio - previousRatio) / previousRatio;
      
      if (Math.abs(change) < 0.05) return 'stable';
      return change > 0 ? 'improving' : 'declining';
    }
    
    const change = (current - previous) / previous;
    if (Math.abs(change) < 0.05) return 'stable';
    return change > 0 ? 'improving' : 'declining';
  }

  /**
   * Get overall trend
   * @param {object} trends - Individual trends
   * @returns {string} Overall trend
   */
  getOverallTrend(trends) {
    const trendValues = Object.values(trends);
    const improving = trendValues.filter(t => t === 'improving').length;
    const declining = trendValues.filter(t => t === 'declining').length;
    
    if (declining > improving) return 'declining';
    if (improving > declining) return 'improving';
    return 'stable';
  }

  /**
   * Reset metrics
   * @returns {void}
   */
  resetMetrics() {
    this.metrics = {
      cacheOperations: {
        hits: 0,
        misses: 0,
        fallbacks: 0,
        errors: 0,
        avgResponseTime: 0,
        totalOperations: 0
      },
      blockchainOperations: {
        queries: 0,
        errors: 0,
        avgResponseTime: 0,
        totalQueries: 0
      },
      syncOperations: {
        jobs: 0,
        completed: 0,
        failed: 0,
        avgProcessingTime: 0,
        totalJobs: 0
      },
      eventProcessing: {
        eventsProcessed: 0,
        eventsFailed: 0,
        avgProcessingTime: 0,
        totalEvents: 0
      },
      apiEndpoints: {
        requests: 0,
        errors: 0,
        avgResponseTime: 0,
        totalRequests: 0
      }
    };
    
    this.responseTimes = {
      cache: [],
      blockchain: [],
      sync: [],
      events: [],
      api: []
    };
  }

  /**
   * Start metrics flush interval
   * @returns {void}
   */
  startMetricsFlush() {
    setInterval(() => {
      this.storeMetrics();
    }, this.metricsFlushInterval);
  }

  /**
   * Create performance metrics table if not exists
   * @returns {void}
   */
  createMetricsTable() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS rwa_performance_metrics (
          id TEXT PRIMARY KEY,
          metric_date TEXT NOT NULL UNIQUE,
          total_queries INTEGER DEFAULT 0,
          cache_hits INTEGER DEFAULT 0,
          cache_misses INTEGER DEFAULT 0,
          blockchain_fallbacks INTEGER DEFAULT 0,
          avg_query_time_ms REAL DEFAULT 0,
          avg_sync_time_ms REAL DEFAULT 0,
          total_sync_errors INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_rwa_performance_metrics_date ON rwa_performance_metrics(metric_date);
      `);

    } catch (error) {
      console.error('[RwaPerformanceMonitor] Error creating metrics table:', error);
    }
  }

  /**
   * Initialize the performance monitor
   * @returns {void}
   */
  initialize() {
    this.createMetricsTable();
    console.log('[RwaPerformanceMonitor] Performance monitor initialized');
  }
}

module.exports = RwaPerformanceMonitor;
