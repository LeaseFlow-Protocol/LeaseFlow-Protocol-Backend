/**
 * VerificationResult DTO - Normalizes responses from different identity providers
 * This ensures the rest of the application remains vendor-agnostic
 */
class VerificationResult {
  /**
   * @param {object} params
   * @param {boolean} params.success Whether the verification was successful
   * @param {string} params.status Verification status ('verified', 'rejected', 'in_progress', 'pending')
   * @param {string} params.verificationReference Provider-specific reference ID
   * @param {string} params.providerName Name of the identity provider that performed the verification
   * @param {Date|null} params.verifiedAt Timestamp when verification was completed
   * @param {Date|null} params.rejectedAt Timestamp when verification was rejected
   * @param {string|null} params.rejectionReason Reason for rejection if applicable
   * @param {object} params.providerFields Provider-specific additional data
   * @param {number} params.responseTimeMs Provider response time in milliseconds
   * @param {boolean} params.isFallback Whether this result came from a fallback provider
   */
  constructor({
    success,
    status,
    verificationReference,
    providerName,
    verifiedAt = null,
    rejectedAt = null,
    rejectionReason = null,
    providerFields = {},
    responseTimeMs = 0,
    isFallback = false
  }) {
    this.success = Boolean(success);
    this.status = status;
    this.verificationReference = verificationReference;
    this.providerName = providerName;
    this.verifiedAt = verifiedAt;
    this.rejectedAt = rejectedAt;
    this.rejectionReason = rejectionReason;
    this.providerFields = providerFields;
    this.responseTimeMs = responseTimeMs;
    this.isFallback = isFallback;
    this.timestamp = new Date();
  }

  /**
   * Create a successful verification result
   */
  static success({
    verificationReference,
    providerName,
    verifiedAt = new Date(),
    providerFields = {},
    responseTimeMs = 0,
    isFallback = false
  }) {
    return new VerificationResult({
      success: true,
      status: 'verified',
      verificationReference,
      providerName,
      verifiedAt,
      providerFields,
      responseTimeMs,
      isFallback
    });
  }

  /**
   * Create a rejected verification result
   */
  static rejected({
    verificationReference,
    providerName,
    rejectionReason,
    rejectedAt = new Date(),
    providerFields = {},
    responseTimeMs = 0,
    isFallback = false
  }) {
    return new VerificationResult({
      success: false,
      status: 'rejected',
      verificationReference,
      providerName,
      rejectedAt,
      rejectionReason,
      providerFields,
      responseTimeMs,
      isFallback
    });
  }

  /**
   * Create an in-progress verification result
   */
  static inProgress({
    verificationReference,
    providerName,
    providerFields = {},
    responseTimeMs = 0,
    isFallback = false
  }) {
    return new VerificationResult({
      success: false,
      status: 'in_progress',
      verificationReference,
      providerName,
      providerFields,
      responseTimeMs,
      isFallback
    });
  }

  /**
   * Create a pending verification result
   */
  static pending({
    verificationReference,
    providerName,
    providerFields = {},
    responseTimeMs = 0,
    isFallback = false
  }) {
    return new VerificationResult({
      success: false,
      status: 'pending',
      verificationReference,
      providerName,
      providerFields,
      responseTimeMs,
      isFallback
    });
  }

  /**
   * Create an error result (for timeouts, network errors, etc.)
   */
  static error({
    providerName,
    error,
    responseTimeMs = 0,
    isFallback = false
  }) {
    return new VerificationResult({
      success: false,
      status: 'error',
      verificationReference: null,
      providerName,
      rejectionReason: error.message || 'Unknown error',
      providerFields: { error: error.message, code: error.code },
      responseTimeMs,
      isFallback
    });
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      success: this.success,
      status: this.status,
      verificationReference: this.verificationReference,
      providerName: this.providerName,
      verifiedAt: this.verifiedAt?.toISOString() || null,
      rejectedAt: this.rejectedAt?.toISOString() || null,
      rejectionReason: this.rejectionReason,
      providerFields: this.providerFields,
      responseTimeMs: this.responseTimeMs,
      isFallback: this.isFallback,
      timestamp: this.timestamp.toISOString()
    };
  }

  /**
   * Validate that the result has all required fields
   */
  validate() {
    if (!this.status || !['verified', 'rejected', 'in_progress', 'pending', 'error'].includes(this.status)) {
      throw new Error('Invalid status in VerificationResult');
    }
    
    if (!this.providerName) {
      throw new Error('Provider name is required in VerificationResult');
    }

    return true;
  }
}

module.exports = { VerificationResult };
