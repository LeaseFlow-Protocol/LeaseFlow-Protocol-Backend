/**
 * Base Identity Adapter - Abstract interface for all identity providers
 * All vendor adapters must extend this class and implement the required methods
 */
class BaseIdentityAdapter {
  constructor(config) {
    this.config = config;
    this.name = this.constructor.name.replace('Adapter', '').toLowerCase();
    this.timeout = config.timeout || 5000;
  }

  /**
   * Submit KYC verification to the identity provider
   * Must be implemented by concrete adapters
   * 
   * @param {object} kycData KYC information
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async submitVerification(kycData) {
    throw new Error('submitVerification must be implemented by concrete adapter');
  }

  /**
   * Check verification status from the identity provider
   * Must be implemented by concrete adapters
   * 
   * @param {string} verificationReference Provider-specific reference ID
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async checkStatus(verificationReference) {
    throw new Error('checkStatus must be implemented by concrete adapter');
  }

  /**
   * Update existing verification with additional information
   * Optional method - adapters can override if supported
   * 
   * @param {string} verificationReference Provider-specific reference ID
   * @param {object} updatedData Updated KYC information
   * @returns {Promise<VerificationResult>} Normalized verification result
   */
  async updateVerification(verificationReference, updatedData) {
    throw new Error('updateVerification not supported by this adapter');
  }

  /**
   * Delete verification data (GDPR compliance)
   * Optional method - adapters can override if supported
   * 
   * @param {string} verificationReference Provider-specific reference ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteVerification(verificationReference) {
    throw new Error('deleteVerification not supported by this adapter');
  }

  /**
   * Get supported ID types and requirements from the provider
   * Optional method - adapters can override if supported
   * 
   * @returns {Promise<object>} Supported ID types and requirements
   */
  async getSupportedIdTypes() {
    throw new Error('getSupportedIdTypes not supported by this adapter');
  }

  /**
   * Execute HTTP request with timeout and error handling
   * Common utility for all adapters
   * 
   * @param {Promise} request Promise-based HTTP request
   * @param {number} customTimeout Custom timeout override
   * @returns {Promise} Request result with timing
   */
  async executeWithTimeout(request, customTimeout = null) {
    const startTime = Date.now();
    const timeoutMs = customTimeout || this.timeout;

    try {
      const result = await Promise.race([
        request,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
        )
      ]);

      const endTime = Date.now();
      return {
        result,
        responseTimeMs: endTime - startTime
      };
    } catch (error) {
      const endTime = Date.now();
      throw {
        error,
        responseTimeMs: endTime - startTime
      };
    }
  }

  /**
   * Check if an error should trigger fallback
   * 
   * @param {Error} error The error that occurred
   * @returns {boolean} Whether fallback should be triggered
   */
  shouldTriggerFallback(error) {
    // Fallback on timeouts, 5xx errors, and network issues
    if (error.message === 'Request timeout') {
      return true;
    }

    if (error.response) {
      const status = error.response.status;
      return status >= 500 || status === 429; // Server errors or rate limiting
    }

    if (error.code === 'ECONNREFUSED' || 
        error.code === 'ENOTFOUND' || 
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET') {
      return true;
    }

    return false;
  }

  /**
   * Get adapter health status
   * 
   * @returns {Promise<object>} Health status information
   */
  async getHealthStatus() {
    try {
      const startTime = Date.now();
      await this.performHealthCheck();
      const endTime = Date.now();
      
      return {
        adapter: this.name,
        status: 'healthy',
        responseTimeMs: endTime - startTime,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      return {
        adapter: this.name,
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  /**
   * Perform actual health check
   * Must be implemented by concrete adapters
   */
  async performHealthCheck() {
    // Default implementation - adapters should override
    throw new Error('performHealthCheck must be implemented by concrete adapter');
  }
}

module.exports = { BaseIdentityAdapter };
