const { SumSubAdapter } = require('../adapters/SumSubAdapter');
const { JumioAdapter } = require('../adapters/JumioAdapter');
const { VerificationResult } = require('../dtos/VerificationResult');
const { IdentityMetrics } = require('../metrics/identityMetrics');

/**
 * Identity Router Service - Implements fallback logic for identity providers
 * This service ensures the protocol's onboarding funnel is immune to single-vendor outages
 */
class IdentityRouterService {
  constructor(config) {
    this.config = config;
    this.providers = this.initializeProviders();
    this.providerPriority = config.providerPriority || ['sumsub', 'jumio'];
    this.fallbackTimeout = config.fallbackTimeout || 5000;
    this.maxRetries = config.maxRetries || 2;
    
    // Initialize Prometheus metrics
    this.prometheusMetrics = new IdentityMetrics();
    
    // Internal metrics for backward compatibility
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      fallbackActivations: 0,
      providerErrors: {},
      providerResponseTimes: {}
    };
  }

  /**
   * Initialize identity provider adapters
   */
  initializeProviders() {
    const providers = {};

    if (this.config.sumsub) {
      providers.sumsub = new SumSubAdapter({
        ...this.config.sumsub,
        timeout: this.fallbackTimeout
      });
    }

    if (this.config.jumio) {
      providers.jumio = new JumioAdapter({
        ...this.config.jumio,
        timeout: this.fallbackTimeout
      });
    }

    return providers;
  }

  /**
   * Submit KYC verification with automatic fallback
   * 
   * @param {object} kycData KYC information
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async submitVerification(kycData) {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    let lastError = null;
    let fallbackUsed = false;

    for (let attempt = 0; attempt < this.providerPriority.length; attempt++) {
      const providerName = this.providerPriority[attempt];
      const provider = this.providers[providerName];

      if (!provider) {
        console.warn(`[IdentityRouter] Provider ${providerName} not configured, skipping`);
        continue;
      }

      try {
        console.log(`[IdentityRouter] Attempting verification with ${providerName} (attempt ${attempt + 1})`);
        
        const result = await provider.submitVerification(kycData);
        
        // Mark if this was a fallback (not the first provider)
        if (attempt > 0) {
          result.isFallback = true;
          fallbackUsed = true;
          this.metrics.fallbackActivations++;
          console.log(`[IdentityRouter] Fallback to ${providerName} successful`);
        }

        this.updateProviderMetrics(providerName, result.responseTimeMs, 'success');
        this.metrics.successfulRequests++;
        
        // Record Prometheus metrics
        this.prometheusMetrics.recordVerificationRequest(
          providerName, 
          'submit', 
          'success', 
          result.responseTimeMs
        );
        this.prometheusMetrics.recordVerificationOutcome(providerName, 'in_progress');
        this.prometheusMetrics.updateProviderResponseTime(providerName, result.responseTimeMs);
        
        console.log(`[IdentityRouter] Verification submitted successfully via ${providerName}`);
        return result;

      } catch (error) {
        lastError = error;
        const responseTime = Date.now() - startTime;
        
        console.warn(`[IdentityRouter] Provider ${providerName} failed:`, error.message);
        this.updateProviderMetrics(providerName, responseTime, 'error', error);
        
        // Record Prometheus metrics for error
        this.prometheusMetrics.recordVerificationRequest(
          providerName, 
          'submit', 
          'error', 
          responseTime
        );
        this.prometheusMetrics.recordProviderError(
          providerName, 
          this.getErrorType(error), 
          error.response?.status
        );
        
        // Check if we should fallback to next provider
        if (attempt < this.providerPriority.length - 1) {
          console.log(`[IdentityRouter] Initiating fallback to next provider`);
          
          // Record fallback activation
          if (attempt === 0) {
            this.prometheusMetrics.recordFallbackActivation(
              providerName,
              this.providerPriority[attempt + 1],
              this.getFallbackReason(error)
            );
          }
          continue;
        }
      }
    }

    // All providers failed
    console.error(`[IdentityRouter] All providers failed for verification submission`);
    return VerificationResult.error({
      providerName: 'identity_router',
      error: new Error(`All identity providers failed. Last error: ${lastError?.message || 'Unknown error'}`),
      responseTimeMs: Date.now() - startTime,
      isFallback: false
    });
  }

  /**
   * Check verification status with automatic fallback
   * 
   * @param {string} verificationReference Provider-specific reference ID
   * @param {string} providerName Original provider name (optional)
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async checkStatus(verificationReference, providerName = null) {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    let lastError = null;
    let fallbackUsed = false;

    // Determine provider priority for status check
    const providersToTry = providerName 
      ? [providerName, ...this.providerPriority.filter(p => p !== providerName)]
      : this.providerPriority;

    for (let attempt = 0; attempt < providersToTry.length; attempt++) {
      const currentProviderName = providersToTry[attempt];
      const provider = this.providers[currentProviderName];

      if (!provider) {
        console.warn(`[IdentityRouter] Provider ${currentProviderName} not configured, skipping`);
        continue;
      }

      try {
        console.log(`[IdentityRouter] Checking status with ${currentProviderName} (attempt ${attempt + 1})`);
        
        const result = await provider.checkStatus(verificationReference);
        
        // Mark if this was a fallback
        if (attempt > 0) {
          result.isFallback = true;
          fallbackUsed = true;
          this.metrics.fallbackActivations++;
          console.log(`[IdentityRouter] Fallback to ${currentProviderName} successful for status check`);
        }

        this.updateProviderMetrics(currentProviderName, result.responseTimeMs, 'success');
        this.metrics.successfulRequests++;
        
        return result;

      } catch (error) {
        lastError = error;
        const responseTime = Date.now() - startTime;
        
        console.warn(`[IdentityRouter] Provider ${currentProviderName} status check failed:`, error.message);
        this.updateProviderMetrics(currentProviderName, responseTime, 'error', error);
        
        // Check if we should fallback to next provider
        if (attempt < providersToTry.length - 1) {
          console.log(`[IdentityRouter] Initiating fallback for status check`);
          continue;
        }
      }
    }

    // All providers failed
    console.error(`[IdentityRouter] All providers failed for status check`);
    return VerificationResult.error({
      providerName: 'identity_router',
      error: new Error(`All identity providers failed for status check. Last error: ${lastError?.message || 'Unknown error'}`),
      responseTimeMs: Date.now() - startTime,
      isFallback: false
    });
  }

  /**
   * Update verification with automatic fallback
   * 
   * @param {string} verificationReference Provider-specific reference ID
   * @param {object} updatedData Updated KYC information
   * @param {string} providerName Original provider name (optional)
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async updateVerification(verificationReference, updatedData, providerName = null) {
    this.metrics.totalRequests++;
    
    const startTime = Date.now();
    let lastError = null;

    const providersToTry = providerName 
      ? [providerName, ...this.providerPriority.filter(p => p !== providerName)]
      : this.providerPriority;

    for (let attempt = 0; attempt < providersToTry.length; attempt++) {
      const currentProviderName = providersToTry[attempt];
      const provider = this.providers[currentProviderName];

      if (!provider) {
        console.warn(`[IdentityRouter] Provider ${currentProviderName} not configured, skipping`);
        continue;
      }

      try {
        console.log(`[IdentityRouter] Updating verification with ${currentProviderName} (attempt ${attempt + 1})`);
        
        const result = await provider.updateVerification(verificationReference, updatedData);
        
        if (attempt > 0) {
          result.isFallback = true;
          this.metrics.fallbackActivations++;
        }

        this.updateProviderMetrics(currentProviderName, result.responseTimeMs, 'success');
        this.metrics.successfulRequests++;
        
        return result;

      } catch (error) {
        lastError = error;
        const responseTime = Date.now() - startTime;
        
        console.warn(`[IdentityRouter] Provider ${currentProviderName} update failed:`, error.message);
        this.updateProviderMetrics(currentProviderName, responseTime, 'error', error);
        
        if (attempt < providersToTry.length - 1) {
          continue;
        }
      }
    }

    return VerificationResult.error({
      providerName: 'identity_router',
      error: new Error(`All identity providers failed for update. Last error: ${lastError?.message || 'Unknown error'}`),
      responseTimeMs: Date.now() - startTime,
      isFallback: false
    });
  }

  /**
   * Get supported ID types from primary provider with fallback
   * 
   * @returns {Promise<object>} Supported ID types and requirements
   */
  async getSupportedIdTypes() {
    const startTime = Date.now();
    let lastError = null;

    for (const providerName of this.providerPriority) {
      const provider = this.providers[providerName];

      if (!provider) continue;

      try {
        const result = await provider.getSupportedIdTypes();
        this.updateProviderMetrics(providerName, Date.now() - startTime, 'success');
        return result;
      } catch (error) {
        lastError = error;
        console.warn(`[IdentityRouter] Provider ${providerName} getSupportedIdTypes failed:`, error.message);
        this.updateProviderMetrics(providerName, Date.now() - startTime, 'error', error);
      }
    }

    throw new Error(`All providers failed to get supported ID types. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Get health status of all providers
   * 
   * @returns {Promise<object>} Health status information
   */
  async getHealthStatus() {
    const healthChecks = await Promise.allSettled(
      Object.entries(this.providers).map(async ([name, provider]) => {
        return {
          name,
          status: await provider.getHealthStatus()
        };
      })
    );

    const results = {};
    let healthyCount = 0;

    healthChecks.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results[result.value.name] = result.value.status;
        if (result.value.status.status === 'healthy') {
          healthyCount++;
        }
      } else {
        const providerName = Object.keys(this.providers)[index];
        results[providerName] = {
          adapter: providerName,
          status: 'unhealthy',
          error: result.reason?.message || 'Health check failed',
          lastCheck: new Date().toISOString()
        };
      }
    });

    return {
      overall: {
        status: healthyCount > 0 ? 'healthy' : 'unhealthy',
        healthyProviders: healthyCount,
        totalProviders: Object.keys(this.providers).length
      },
      providers: results,
      metrics: this.getMetrics()
    };
  }

  /**
   * Update provider metrics
   */
  updateProviderMetrics(providerName, responseTimeMs, type, error = null) {
    if (!this.metrics.providerResponseTimes[providerName]) {
      this.metrics.providerResponseTimes[providerName] = {
        count: 0,
        totalTime: 0,
        avgTime: 0
      };
    }

    if (!this.metrics.providerErrors[providerName]) {
      this.metrics.providerErrors[providerName] = 0;
    }

    const metrics = this.metrics.providerResponseTimes[providerName];
    metrics.count++;
    metrics.totalTime += responseTimeMs;
    metrics.avgTime = metrics.totalTime / metrics.count;

    if (type === 'error') {
      this.metrics.providerErrors[providerName]++;
    }
  }

  /**
   * Get current metrics
   * 
   * @returns {object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0 
        ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      fallbackRate: this.metrics.totalRequests > 0
        ? (this.metrics.fallbackActivations / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%',
      uptime: this.metrics.totalRequests > 0
        ? ((this.metrics.totalRequests - Object.values(this.metrics.providerErrors).reduce((a, b) => a + b, 0)) / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '100%'
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      fallbackActivations: 0,
      providerErrors: {},
      providerResponseTimes: {}
    };
  }

  /**
   * Get provider priority configuration
   * 
   * @returns {string[]} Ordered list of provider names
   */
  getProviderPriority() {
    return [...this.providerPriority];
  }

  /**
   * Update provider priority (for runtime reconfiguration)
   * 
   * @param {string[]} newPriority New ordered list of provider names
   */
  updateProviderPriority(newPriority) {
    // Validate that all providers exist
    for (const providerName of newPriority) {
      if (!this.providers[providerName]) {
        throw new Error(`Provider ${providerName} is not configured`);
      }
    }

    this.providerPriority = [...newPriority];
    console.log(`[IdentityRouter] Provider priority updated:`, this.providerPriority);
  }

  /**
   * Get error type for Prometheus metrics
   * 
   * @param {Error} error The error that occurred
   * @returns {string} Error type classification
   */
  getErrorType(error) {
    if (error.message === 'Request timeout') {
      return 'timeout';
    }
    
    if (error.response) {
      const status = error.response.status;
      if (status >= 500) return 'server_error';
      if (status === 429) return 'rate_limit';
      if (status >= 400) return 'client_error';
    }
    
    if (error.code === 'ECONNREFUSED') return 'connection_refused';
    if (error.code === 'ENOTFOUND') return 'dns_error';
    if (error.code === 'ETIMEDOUT') return 'network_timeout';
    if (error.code === 'ECONNRESET') return 'connection_reset';
    
    return 'unknown_error';
  }

  /**
   * Get fallback reason for Prometheus metrics
   * 
   * @param {Error} error The error that triggered fallback
   * @returns {string} Fallback reason
   */
  getFallbackReason(error) {
    if (error.message === 'Request timeout') {
      return 'timeout';
    }
    
    if (error.response?.status >= 500) {
      return 'server_error';
    }
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return 'network_error';
    }
    
    return 'provider_error';
  }

  /**
   * Get Prometheus metrics instance for external access
   * 
   * @returns {IdentityMetrics} Prometheus metrics instance
   */
  getPrometheusMetrics() {
    return this.prometheusMetrics;
  }
}

module.exports = { IdentityRouterService };
