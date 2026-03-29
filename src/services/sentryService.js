const Sentry = require('@sentry/node');

/**
 * Sentry Error Tracking Service
 * Task 2: Monitoring & Reliability - Enhanced Error Reporting with User Context
 */
class SentryService {
  /**
   * Initialize Sentry
   * @param {Object} config - Sentry configuration
   */
  initialize(config) {
    if (!config?.dsn) {
      console.warn('[Sentry] DSN not provided. Error tracking disabled.');
      return;
    }

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment || 'development',
      tracesSampleRate: config.tracesSampleRate || 0.1,
      sampleRate: config.sampleRate || 1.0,
      
      // Add contextual data to error reports
      beforeSend(event, hint) {
        // Enrich error events with custom context
        if (event.exception) {
          console.error('[Sentry] Captured exception:', event.exception);
        }
        return event;
      },

      // Add integrations for better stack traces
      integrations: [
        Sentry.httpIntegration(),
        Sentry.onUncaughtExceptionIntegration(),
        Sentry.onUnhandledRejectionIntegration(),
      ],
    });

    console.log('[Sentry] Initialized successfully');
  }

  /**
   * Set user context for error tracking
   * @param {Object} userContext - User identification data
   * @param {string} userContext.publicKey - User's Stellar public key
   * @param {string} userContext.leaseId - Current lease ID (if applicable)
   * @param {string} userContext.userId - Internal user ID
   * @param {string} userContext.email - User email
   * @param {string} userContext.role - User role (tenant, landlord, admin)
   */
  setUserContext(userContext) {
    if (!userContext) return;

    const sentryUser = {
      id: userContext.userId || userContext.publicKey,
      publicKey: userContext.publicKey,
      leaseId: userContext.leaseId,
      email: userContext.email,
      role: userContext.role,
    };

    Sentry.setUser(sentryUser);
  }

  /**
   * Set lease context for error tracking
   * @param {Object} leaseContext - Lease identification data
   * @param {string} leaseContext.leaseId - Lease ID
   * @param {string} leaseContext.status - Lease status
   * @param {string} leaseContext.rentAmount - Rent amount
   * @param {string} leaseContext.currency - Currency code
   */
  setLeaseContext(leaseContext) {
    if (!leaseContext) return;

    Sentry.setTag('lease_id', leaseContext.leaseId);
    
    if (leaseContext.status) {
      Sentry.setTag('lease_status', leaseContext.status);
    }
    
    if (leaseContext.rentAmount) {
      Sentry.setTag('lease_rent_amount', leaseContext.rentAmount);
    }
    
    if (leaseContext.currency) {
      Sentry.setTag('lease_currency', leaseContext.currency);
    }
  }

  /**
   * Set additional tags for error categorization
   * @param {string} key - Tag key
   * @param {string} value - Tag value
   */
  setTag(key, value) {
    Sentry.setTag(key, value);
  }

  /**
   * Set multiple tags at once
   * @param {Object} tags - Key-value pairs of tags
   */
  setTags(tags) {
    Object.entries(tags).forEach(([key, value]) => {
      Sentry.setTag(key, value);
    });
  }

  /**
   * Capture an exception with enriched context
   * @param {Error} error - Error object
   * @param {Object} options - Additional options
   * @param {string} options.publicKey - User's public key
   * @param {string} options.leaseId - Lease ID
   * @param {Object} options.extra - Extra context data
   */
  captureException(error, options = {}) {
    // Enrich with user context if provided
    if (options.publicKey || options.leaseId) {
      this.setUserContext({
        publicKey: options.publicKey,
        leaseId: options.leaseId,
      });
    }

    // Add extra context
    if (options.extra) {
      Object.entries(options.extra).forEach(([key, value]) => {
        Sentry.setExtra(key, value);
      });
    }

    // Capture the exception
    const eventId = Sentry.captureException(error);
    
    console.error(`[Sentry] Exception captured: ${error.message}`, {
      eventId,
      publicKey: options.publicKey,
      leaseId: options.leaseId,
    });

    return eventId;
  }

  /**
   * Capture a message (for logging/info purposes)
   * @param {string} message - Message to capture
   * @param {string} level - Log level (debug, info, warning, error)
   * @param {Object} options - Additional options
   */
  captureMessage(message, level = 'info', options = {}) {
    if (options.publicKey || options.leaseId) {
      this.setUserContext({
        publicKey: options.publicKey,
        leaseId: options.leaseId,
      });
    }

    const eventId = Sentry.captureMessage(message, level);
    
    if (level === 'error' || level === 'warning') {
      console.warn(`[Sentry] Message captured: ${message}`, {
        eventId,
        level,
        publicKey: options.publicKey,
        leaseId: options.leaseId,
      });
    }

    return eventId;
  }

  /**
   * Start a performance transaction
   * @param {Object} options - Transaction options
   * @param {string} options.name - Transaction name
   * @param {string} options.op - Operation type
   */
  startTransaction(options) {
    const transaction = Sentry.startTransaction({
      name: options.name,
      op: options.op || 'request',
      ...options,
    });

    // Make the transaction available for the current scope
    Sentry.getCurrentScope().setSpan(transaction);

    return transaction;
  }

  /**
   * Add breadcrumb for debugging trail
   * @param {Object} breadcrumb - Breadcrumb data
   * @param {string} breadcrumb.message - Message
   * @param {string} breadcrumb.category - Category
   * @param {string} breadcrumb.level - Level
   * @param {Object} breadcrumb.data - Additional data
   */
  addBreadcrumb(breadcrumb) {
    Sentry.addBreadcrumb(breadcrumb);
  }

  /**
   * Clear user context (call when user logs out)
   */
  clearUserContext() {
    Sentry.setUser(null);
    Sentry.setTag('lease_id', null);
  }

  /**
   * Flush pending events before shutdown
   * @param {number} timeout - Timeout in ms
   */
  async close(timeout = 2000) {
    await Sentry.close(timeout);
    console.log('[Sentry] Closed');
  }
}

/**
 * Express middleware to automatically enrich errors with request context
 * @param {SentryService} sentryService - Sentry service instance
 * @returns {Function} Express middleware
 */
function createSentryMiddleware(sentryService) {
  return (req, res, next) => {
    // Extract user context from request
    const actor = req.actor;
    
    if (actor) {
      sentryService.setUserContext({
        userId: actor.id,
        publicKey: actor.publicKey,
        email: actor.email,
        role: actor.role,
      });
    }

    // Extract lease context from request params
    const leaseId = req.params.leaseId || req.body?.leaseId || req.query?.leaseId;
    if (leaseId) {
      sentryService.setLeaseContext({ leaseId });
    }

    // Add request metadata as breadcrumbs
    sentryService.addBreadcrumb({
      message: `${req.method} ${req.path}`,
      category: 'http',
      data: {
        method: req.method,
        path: req.path,
        query: req.query,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      },
    });

    // Track response time
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      sentryService.setTag('response_time_ms', duration);
      sentryService.setTag('response_status', res.statusCode);
    });

    next();
  };
}

module.exports = { SentryService, createSentryMiddleware };
