/**
 * RWA Error Handler and Recovery Service
 * Provides comprehensive error handling and recovery mechanisms for RWA operations
 */
class RwaErrorHandler {
  constructor(database, config) {
    this.database = database;
    this.config = config;
    this.errorCounts = new Map();
    this.circuitBreakers = new Map();
    this.retryQueues = new Map();
    
    // Circuit breaker configuration
    this.circuitBreakerThreshold = config.rwaErrorHandling?.circuitBreakerThreshold || 5;
    this.circuitBreakerTimeout = config.rwaErrorHandling?.circuitBreakerTimeout || 60000; // 1 minute
    this.maxRetryAttempts = config.rwaErrorHandling?.maxRetryAttempts || 3;
    this.retryDelay = config.rwaErrorHandling?.retryDelay || 1000;
    
    this.initializeErrorTracking();
  }

  /**
   * Initialize error tracking tables
   * @returns {void}
   */
  initializeErrorTracking() {
    try {
      this.database.db.exec(`
        CREATE TABLE IF NOT EXISTS rwa_error_log (
          id TEXT PRIMARY KEY,
          error_type TEXT NOT NULL,
          component TEXT NOT NULL,
          error_message TEXT NOT NULL,
          stack_trace TEXT,
          context_data TEXT, -- JSON blob with additional context
          severity TEXT DEFAULT 'error', -- error, warning, critical
          resolved INTEGER DEFAULT 0,
          resolution_strategy TEXT,
          created_at TEXT NOT NULL,
          resolved_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_rwa_error_log_type ON rwa_error_log(error_type);
        CREATE INDEX IF NOT EXISTS idx_rwa_error_log_component ON rwa_error_log(component);
        CREATE INDEX IF NOT EXISTS idx_rwa_error_log_severity ON rwa_error_log(severity);
        CREATE INDEX IF NOT EXISTS idx_rwa_error_log_created_at ON rwa_error_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_rwa_error_log_resolved ON rwa_error_log(resolved);
      `);

      console.log('[RwaErrorHandler] Error tracking initialized');
    } catch (error) {
      console.error('[RwaErrorHandler] Error initializing error tracking:', error);
    }
  }

  /**
   * Handle RWA operation error
   * @param {Error} error - Error object
   * @param {string} component - Component where error occurred
   * @param {object} context - Additional context data
   * @param {string} severity - Error severity
   * @returns {object} Error handling result
   */
  async handleError(error, component, context = {}, severity = 'error') {
    const errorId = this.generateErrorId();
    const errorType = this.classifyError(error);
    const timestamp = new Date().toISOString();
    
    // Log error
    await this.logError(errorId, errorType, component, error, context, severity);
    
    // Update error counts
    this.updateErrorCount(component, errorType);
    
    // Check circuit breaker
    if (this.isCircuitBreakerOpen(component)) {
      return {
        handled: false,
        action: 'circuit_breaker_open',
        message: `Circuit breaker is open for ${component}`,
        errorId,
        retryAfter: this.getCircuitBreakerRetryTime(component)
      };
    }
    
    // Determine recovery strategy
    const recoveryStrategy = this.determineRecoveryStrategy(errorType, component, context);
    
    // Execute recovery
    const recoveryResult = await this.executeRecoveryStrategy(recoveryStrategy, error, context);
    
    // Check if circuit breaker should be triggered
    this.checkCircuitBreakerThreshold(component);
    
    return {
      handled: true,
      errorId,
      errorType,
      component,
      recoveryStrategy,
      recoveryResult,
      timestamp
    };
  }

  /**
   * Generate unique error ID
   * @returns {string} Error ID
   */
  generateErrorId() {
    return `rwa_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Classify error type
   * @param {Error} error - Error object
   * @returns {string} Error type
   */
  classifyError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('network') || message.includes('connection')) {
      return 'network_error';
    }
    
    if (message.includes('timeout')) {
      return 'timeout_error';
    }
    
    if (message.includes('database') || message.includes('sql')) {
      return 'database_error';
    }
    
    if (message.includes('stellar') || message.includes('horizon')) {
      return 'blockchain_error';
    }
    
    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation_error';
    }
    
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return 'rate_limit_error';
    }
    
    if (message.includes('authentication') || message.includes('unauthorized')) {
      return 'auth_error';
    }
    
    return 'unknown_error';
  }

  /**
   * Log error to database
   * @param {string} errorId - Error ID
   * @param {string} errorType - Error type
   * @param {string} component - Component name
   * @param {Error} error - Error object
   * @param {object} context - Context data
   * @param {string} severity - Error severity
   * @returns {Promise<void>}
   */
  async logError(errorId, errorType, component, error, context, severity) {
    try {
      this.database.db.prepare(`
        INSERT INTO rwa_error_log (
          id, error_type, component, error_message, stack_trace,
          context_data, severity, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        errorId,
        errorType,
        component,
        error.message,
        error.stack || '',
        JSON.stringify(context),
        severity,
        new Date().toISOString()
      );
    } catch (logError) {
      console.error('[RwaErrorHandler] Error logging to database:', logError);
      // Fallback to console logging
      console.error(`[RwaErrorHandler] ${severity} in ${component}:`, {
        errorId,
        errorType,
        message: error.message,
        context
      });
    }
  }

  /**
   * Update error count for component
   * @param {string} component - Component name
   * @param {string} errorType - Error type
   * @returns {void}
   */
  updateErrorCount(component, errorType) {
    const key = `${component}:${errorType}`;
    const current = this.errorCounts.get(key) || { count: 0, firstOccurrence: Date.now() };
    current.count++;
    current.lastOccurrence = Date.now();
    this.errorCounts.set(key, current);
  }

  /**
   * Determine recovery strategy based on error type and context
   * @param {string} errorType - Error type
   * @param {string} component - Component name
   * @param {object} context - Context data
   * @returns {object} Recovery strategy
   */
  determineRecoveryStrategy(errorType, component, context) {
    const strategies = {
      network_error: {
        type: 'retry_with_backoff',
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000
      },
      timeout_error: {
        type: 'retry_with_backoff',
        maxAttempts: 2,
        baseDelay: 500,
        maxDelay: 5000
      },
      database_error: {
        type: 'fallback_to_cache',
        fallbackDuration: 300000 // 5 minutes
      },
      blockchain_error: {
        type: 'retry_with_exponential_backoff',
        maxAttempts: 5,
        baseDelay: 2000,
        maxDelay: 30000
      },
      validation_error: {
        type: 'skip_operation',
        reason: 'Invalid input data'
      },
      rate_limit_error: {
        type: 'wait_and_retry',
        waitTime: 60000 // 1 minute
      },
      auth_error: {
        type: 'reauthenticate',
        reauthRequired: true
      },
      unknown_error: {
        type: 'log_and_continue',
        continueWithDefault: true
      }
    };

    return strategies[errorType] || strategies.unknown_error;
  }

  /**
   * Execute recovery strategy
   * @param {object} strategy - Recovery strategy
   * @param {Error} error - Original error
   * @param {object} context - Context data
   * @returns {Promise<object>} Recovery result
   */
  async executeRecoveryStrategy(strategy, error, context) {
    switch (strategy.type) {
      case 'retry_with_backoff':
        return await this.retryWithBackoff(context, strategy);
      
      case 'retry_with_exponential_backoff':
        return await this.retryWithExponentialBackoff(context, strategy);
      
      case 'fallback_to_cache':
        return await this.fallbackToCache(context, strategy);
      
      case 'skip_operation':
        return { action: 'skipped', reason: strategy.reason };
      
      case 'wait_and_retry':
        return await this.waitAndRetry(context, strategy);
      
      case 'reauthenticate':
        return await this.reauthenticate(context, strategy);
      
      case 'log_and_continue':
        return { action: 'logged', continueWithDefault: strategy.continueWithDefault };
      
      default:
        return { action: 'unknown_strategy', strategy };
    }
  }

  /**
   * Retry operation with linear backoff
   * @param {object} context - Operation context
   * @param {object} strategy - Retry strategy
   * @returns {Promise<object>} Retry result
   */
  async retryWithBackoff(context, strategy) {
    const { operation, args = [] } = context;
    let lastError;
    
    for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
      try {
        if (typeof operation === 'function') {
          const result = await operation(...args);
          return { action: 'retry_success', attempt, result };
        }
      } catch (error) {
        lastError = error;
        if (attempt < strategy.maxAttempts) {
          const delay = Math.min(strategy.baseDelay * attempt, strategy.maxDelay);
          await this.sleep(delay);
        }
      }
    }
    
    return { action: 'retry_failed', attempts: strategy.maxAttempts, lastError };
  }

  /**
   * Retry operation with exponential backoff
   * @param {object} context - Operation context
   * @param {object} strategy - Retry strategy
   * @returns {Promise<object>} Retry result
   */
  async retryWithExponentialBackoff(context, strategy) {
    const { operation, args = [] } = context;
    let lastError;
    
    for (let attempt = 1; attempt <= strategy.maxAttempts; attempt++) {
      try {
        if (typeof operation === 'function') {
          const result = await operation(...args);
          return { action: 'retry_success', attempt, result };
        }
      } catch (error) {
        lastError = error;
        if (attempt < strategy.maxAttempts) {
          const delay = Math.min(
            strategy.baseDelay * Math.pow(2, attempt - 1),
            strategy.maxDelay
          );
          await this.sleep(delay);
        }
      }
    }
    
    return { action: 'retry_failed', attempts: strategy.maxAttempts, lastError };
  }

  /**
   * Fallback to cache when database fails
   * @param {object} context - Operation context
   * @param {object} strategy - Fallback strategy
   * @returns {Promise<object>} Fallback result
   */
  async fallbackToCache(context, strategy) {
    // This would integrate with the cache service
    // For now, return a placeholder result
    return {
      action: 'fallback_activated',
      fallbackType: 'cache',
      duration: strategy.fallbackDuration,
      message: 'Database unavailable, using cached data'
    };
  }

  /**
   * Wait and retry operation
   * @param {object} context - Operation context
   * @param {object} strategy - Wait strategy
   * @returns {Promise<object>} Wait result
   */
  async waitAndRetry(context, strategy) {
    await this.sleep(strategy.waitTime);
    
    const { operation, args = [] } = context;
    try {
      if (typeof operation === 'function') {
        const result = await operation(...args);
        return { action: 'wait_retry_success', result };
      }
    } catch (error) {
      return { action: 'wait_retry_failed', error };
    }
    
    return { action: 'wait_retry_no_operation' };
  }

  /**
   * Reauthenticate and retry
   * @param {object} context - Operation context
   * @param {object} strategy - Reauth strategy
   * @returns {Promise<object>} Reauth result
   */
  async reauthenticate(context, strategy) {
    // This would trigger reauthentication flow
    return {
      action: 'reauthentication_required',
      reauthRequired: strategy.reauthRequired,
      message: 'Authentication failed, reauthentication required'
    };
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if circuit breaker is open for component
   * @param {string} component - Component name
   * @returns {boolean} True if circuit breaker is open
   */
  isCircuitBreakerOpen(component) {
    const breaker = this.circuitBreakers.get(component);
    if (!breaker) return false;
    
    if (breaker.state === 'open') {
      // Check if timeout has passed
      if (Date.now() - breaker.openedAt > this.circuitBreakerTimeout) {
        // Move to half-open state
        breaker.state = 'half-open';
        breaker.halfOpenAttempts = 0;
        return false;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Check and update circuit breaker threshold
   * @param {string} component - Component name
   * @returns {void}
   */
  checkCircuitBreakerThreshold(component) {
    const breaker = this.circuitBreakers.get(component);
    if (!breaker) {
      // Initialize circuit breaker for component
      this.circuitBreakers.set(component, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        openedAt: null,
        halfOpenAttempts: 0
      });
      return;
    }
    
    // Check if we should open the circuit breaker
    if (breaker.state === 'closed' && breaker.failureCount >= this.circuitBreakerThreshold) {
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      console.warn(`[RwaErrorHandler] Circuit breaker opened for ${component}`);
    }
  }

  /**
   * Get circuit breaker retry time
   * @param {string} component - Component name
   * @returns {number} Retry time in milliseconds
   */
  getCircuitBreakerRetryTime(component) {
    const breaker = this.circuitBreakers.get(component);
    if (!breaker || breaker.state !== 'open') return 0;
    
    const timeUntilRetry = this.circuitBreakerTimeout - (Date.now() - breaker.openedAt);
    return Math.max(0, timeUntilRetry);
  }

  /**
   * Record circuit breaker success
   * @param {string} component - Component name
   * @returns {void}
   */
  recordCircuitBreakerSuccess(component) {
    const breaker = this.circuitBreakers.get(component);
    if (!breaker) return;
    
    if (breaker.state === 'half-open') {
      // Successful operation in half-open state, close the circuit
      breaker.state = 'closed';
      breaker.failureCount = 0;
      breaker.halfOpenAttempts = 0;
      console.log(`[RwaErrorHandler] Circuit breaker closed for ${component}`);
    }
  }

  /**
   * Record circuit breaker failure
   * @param {string} component - Component name
   * @returns {void}
   */
  recordCircuitBreakerFailure(component) {
    const breaker = this.circuitBreakers.get(component);
    if (!breaker) return;
    
    breaker.failureCount++;
    breaker.lastFailureTime = Date.now();
    
    if (breaker.state === 'half-open') {
      // Failed in half-open state, reopen circuit
      breaker.state = 'open';
      breaker.openedAt = Date.now();
      console.warn(`[RwaErrorHandler] Circuit breaker reopened for ${component}`);
    }
  }

  /**
   * Get error statistics
   * @param {object} filters - Filter options
   * @returns {object} Error statistics
   */
  getErrorStatistics(filters = {}) {
    try {
      let query = `
        SELECT error_type, component, severity, COUNT(*) as count,
               AVG(CASE WHEN resolved = 1 THEN 1 ELSE 0 END) as resolution_rate
        FROM rwa_error_log
        WHERE 1=1
      `;
      
      const params = [];
      
      if (filters.component) {
        query += ` AND component = ?`;
        params.push(filters.component);
      }
      
      if (filters.errorType) {
        query += ` AND error_type = ?`;
        params.push(filters.errorType);
      }
      
      if (filters.severity) {
        query += ` AND severity = ?`;
        params.push(filters.severity);
      }
      
      if (filters.since) {
        query += ` AND created_at >= ?`;
        params.push(filters.since);
      }
      
      query += ` GROUP BY error_type, component, severity ORDER BY count DESC`;
      
      const stats = this.database.db.prepare(query).all(...params);
      
      return {
        statistics: stats,
        circuitBreakers: this.getCircuitBreakerStatus(),
        errorCounts: Array.from(this.errorCounts.entries()).map(([key, count]) => ({
          component: key.split(':')[0],
          errorType: key.split(':')[1],
          ...count
        }))
      };
    } catch (error) {
      console.error('[RwaErrorHandler] Error getting statistics:', error);
      return { error: error.message };
    }
  }

  /**
   * Get circuit breaker status
   * @returns {object} Circuit breaker status
   */
  getCircuitBreakerStatus() {
    const status = {};
    
    for (const [component, breaker] of this.circuitBreakers) {
      status[component] = {
        state: breaker.state,
        failureCount: breaker.failureCount,
        lastFailureTime: breaker.lastFailureTime,
        retryAfter: this.getCircuitBreakerRetryTime(component)
      };
    }
    
    return status;
  }

  /**
   * Resolve error
   * @param {string} errorId - Error ID
   * @param {string} resolutionStrategy - Resolution strategy used
   * @returns {Promise<void>}
   */
  async resolveError(errorId, resolutionStrategy) {
    try {
      this.database.db.prepare(`
        UPDATE rwa_error_log 
        SET resolved = 1, resolution_strategy = ?, resolved_at = ?
        WHERE id = ?
      `).run(resolutionStrategy, new Date().toISOString(), errorId);
      
      console.log(`[RwaErrorHandler] Error ${errorId} resolved with strategy: ${resolutionStrategy}`);
    } catch (error) {
      console.error('[RwaErrorHandler] Error resolving error:', error);
    }
  }

  /**
   * Clean up old error logs
   * @param {number} daysToKeep - Number of days to keep logs
   * @returns {Promise<void>}
   */
  async cleanupOldErrors(daysToKeep = 30) {
    try {
      const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
      
      const result = this.database.db.prepare(`
        DELETE FROM rwa_error_log WHERE created_at < ? AND resolved = 1
      `).run(cutoffDate);
      
      console.log(`[RwaErrorHandler] Cleaned up ${result.changes} resolved error logs`);
    } catch (error) {
      console.error('[RwaErrorHandler] Error cleaning up old logs:', error);
    }
  }
}

module.exports = RwaErrorHandler;
