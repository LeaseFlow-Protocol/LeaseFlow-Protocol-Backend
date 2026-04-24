/**
 * Prometheus Metrics for Identity Provider Monitoring
 * Provides visibility into the performance and reliability of external identity providers
 */

// Prometheus client library (you may need to install: npm install prom-client)
const client = require('prom-client');

class IdentityMetrics {
  constructor() {
    // Create a registry for our metrics
    this.register = new client.Registry();
    
    // Add default metrics (process info, etc.)
    client.collectDefaultMetrics({ register: this.register });

    // Custom metrics for identity providers
    this.initializeMetrics();
  }

  initializeMetrics() {
    // Counter for total verification requests
    this.verificationRequestsTotal = new client.Counter({
      name: 'identity_verification_requests_total',
      help: 'Total number of verification requests processed',
      labelNames: ['provider', 'method', 'status'],
      registers: [this.register]
    });

    // Histogram for request duration
    this.verificationRequestDuration = new client.Histogram({
      name: 'identity_verification_request_duration_seconds',
      help: 'Duration of verification requests in seconds',
      labelNames: ['provider', 'method'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.register]
    });

    // Counter for fallback activations
    this.fallbackActivationsTotal = new client.Counter({
      name: 'identity_fallback_activations_total',
      help: 'Total number of fallback activations',
      labelNames: ['primary_provider', 'fallback_provider', 'reason'],
      registers: [this.register]
    });

    // Gauge for provider health status
    this.providerHealthStatus = new client.Gauge({
      name: 'identity_provider_health_status',
      help: 'Health status of identity providers (1 = healthy, 0 = unhealthy)',
      labelNames: ['provider'],
      registers: [this.register]
    });

    // Gauge for provider response time
    this.providerResponseTime = new client.Gauge({
      name: 'identity_provider_response_time_seconds',
      help: 'Current response time of identity providers in seconds',
      labelNames: ['provider'],
      registers: [this.register]
    });

    // Counter for provider errors
    this.providerErrorsTotal = new client.Counter({
      name: 'identity_provider_errors_total',
      help: 'Total number of errors from identity providers',
      labelNames: ['provider', 'error_type', 'http_status'],
      registers: [this.register]
    });

    // Gauge for success rate
    this.providerSuccessRate = new client.Gauge({
      name: 'identity_provider_success_rate',
      help: 'Success rate of identity providers (percentage)',
      labelNames: ['provider'],
      registers: [this.register]
    });

    // Counter for verification status outcomes
    this.verificationOutcomesTotal = new client.Counter({
      name: 'identity_verification_outcomes_total',
      help: 'Total number of verification outcomes',
      labelNames: ['provider', 'outcome'], // outcome: verified, rejected, in_progress, error
      registers: [this.register]
    });

    // Histogram for verification processing time
    this.verificationProcessingTime = new client.Histogram({
      name: 'identity_verification_processing_time_seconds',
      help: 'Time from submission to final decision in seconds',
      labelNames: ['provider'],
      buckets: [60, 300, 900, 1800, 3600, 7200, 14400], // 1min to 4hrs
      registers: [this.register]
    });

    // Gauge for active verifications
    this.activeVerifications = new client.Gauge({
      name: 'identity_active_verifications',
      help: 'Number of currently active verifications',
      labelNames: ['provider'],
      registers: [this.register]
    });
  }

  /**
   * Record a verification request
   */
  recordVerificationRequest(provider, method, status, duration) {
    this.verificationRequestsTotal
      .labels(provider, method, status)
      .inc();
    
    this.verificationRequestDuration
      .labels(provider, method)
      .observe(duration / 1000); // Convert ms to seconds
  }

  /**
   * Record a fallback activation
   */
  recordFallbackActivation(primaryProvider, fallbackProvider, reason) {
    this.fallbackActivationsTotal
      .labels(primaryProvider, fallbackProvider, reason)
      .inc();
  }

  /**
   * Update provider health status
   */
  updateProviderHealth(provider, isHealthy) {
    this.providerHealthStatus
      .labels(provider)
      .set(isHealthy ? 1 : 0);
  }

  /**
   * Update provider response time
   */
  updateProviderResponseTime(provider, responseTimeMs) {
    this.providerResponseTime
      .labels(provider)
      .set(responseTimeMs / 1000); // Convert ms to seconds
  }

  /**
   * Record a provider error
   */
  recordProviderError(provider, errorType, httpStatus) {
    this.providerErrorsTotal
      .labels(provider, errorType, httpStatus?.toString() || 'unknown')
      .inc();
  }

  /**
   * Update provider success rate
   */
  updateProviderSuccessRate(provider, successRate) {
    this.providerSuccessRate
      .labels(provider)
      .set(successRate);
  }

  /**
   * Record verification outcome
   */
  recordVerificationOutcome(provider, outcome) {
    this.verificationOutcomesTotal
      .labels(provider, outcome)
      .inc();
  }

  /**
   * Record verification processing time
   */
  recordVerificationProcessingTime(provider, processingTimeMs) {
    this.verificationProcessingTime
      .labels(provider)
      .observe(processingTimeMs / 1000); // Convert ms to seconds
  }

  /**
   * Update active verifications count
   */
  updateActiveVerifications(provider, count) {
    this.activeVerifications
      .labels(provider)
      .set(count);
  }

  /**
   * Get metrics for Prometheus scraping
   */
  async getMetrics() {
    return await this.register.metrics();
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics() {
    this.register.clear();
    this.initializeMetrics();
  }

  /**
   * Get middleware for Express to expose metrics endpoint
   */
  getMetricsMiddleware() {
    return async (req, res) => {
      try {
        res.set('Content-Type', this.register.contentType);
        res.end(await this.getMetrics());
      } catch (error) {
        console.error('[IdentityMetrics] Error generating metrics:', error);
        res.status(500).end('Error generating metrics');
      }
    };
  }

  /**
   * Create metrics summary for logging
   */
  getMetricsSummary() {
    const summary = {
      timestamp: new Date().toISOString(),
      providers: {}
    };

    // Get provider health status
    this.providerHealthStatus.get().forEach(metric => {
      const provider = metric.values.provider;
      summary.providers[provider] = {
        healthy: metric.values.value === 1,
        responseTime: null,
        successRate: null,
        errors: 0
      };
    });

    // Get response times
    this.providerResponseTime.get().forEach(metric => {
      const provider = metric.values.provider;
      if (summary.providers[provider]) {
        summary.providers[provider].responseTime = metric.values.value;
      }
    });

    // Get success rates
    this.providerSuccessRate.get().forEach(metric => {
      const provider = metric.values.provider;
      if (summary.providers[provider]) {
        summary.providers[provider].successRate = metric.values.value;
      }
    });

    return summary;
  }
}

module.exports = { IdentityMetrics };
