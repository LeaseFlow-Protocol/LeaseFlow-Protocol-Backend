const axios = require('axios');
const { BaseIdentityAdapter } = require('./BaseIdentityAdapter');
const { VerificationResult } = require('../dtos/VerificationResult');

/**
 * SumSub Identity Adapter
 * Implements SumSub API integration for KYC verification
 */
class SumSubAdapter extends BaseIdentityAdapter {
  constructor(config) {
    super(config);
    this.apiToken = config.apiToken;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || 'https://api.sumsub.com';
    this.levelName = config.levelName || 'basic-kyc-level';
  }

  /**
   * Submit KYC verification to SumSub
   */
  async submitVerification(kycData) {
    const startTime = Date.now();
    
    try {
      const { result, responseTimeMs } = await this.executeWithTimeout(
        this.createApplicant(kycData)
      );

      const verificationResult = VerificationResult.inProgress({
        verificationReference: result.id,
        providerName: 'sumsub',
        providerFields: {
          applicantId: result.id,
          inspectionId: result.inspectionId,
          levelName: this.levelName
        },
        responseTimeMs
      });

      return verificationResult;
    } catch (errorObj) {
      const { error, responseTimeMs } = errorObj;
      
      if (this.shouldTriggerFallback(error)) {
        throw error;
      }

      return VerificationResult.error({
        providerName: 'sumsub',
        error,
        responseTimeMs
      });
    }
  }

  /**
   * Check verification status from SumSub
   */
  async checkStatus(verificationReference) {
    const startTime = Date.now();
    
    try {
      const { result, responseTimeMs } = await this.executeWithTimeout(
        this.getApplicantStatus(verificationReference)
      );

      const status = this.mapSumSubStatus(result.reviewResult?.reviewAnswer);
      const verifiedAt = status === 'verified' ? new Date(result.reviewResult?.reviewDate) : null;
      const rejectedAt = status === 'rejected' ? new Date(result.reviewResult?.reviewDate) : null;
      const rejectionReason = status === 'rejected' ? this.extractRejectionReason(result) : null;

      if (status === 'verified') {
        return VerificationResult.success({
          verificationReference,
          providerName: 'sumsub',
          verifiedAt,
          providerFields: {
            applicantId: verificationReference,
            reviewResult: result.reviewResult,
            checkResults: result.checkResults
          },
          responseTimeMs
        });
      } else if (status === 'rejected') {
        return VerificationResult.rejected({
          verificationReference,
          providerName: 'sumsub',
          rejectionReason,
          rejectedAt,
          providerFields: {
            applicantId: verificationReference,
            reviewResult: result.reviewResult
          },
          responseTimeMs
        });
      } else {
        return VerificationResult.inProgress({
          verificationReference,
          providerName: 'sumsub',
          providerFields: {
            applicantId: verificationReference,
            reviewResult: result.reviewResult
          },
          responseTimeMs
        });
      }
    } catch (errorObj) {
      const { error, responseTimeMs } = errorObj;
      
      if (this.shouldTriggerFallback(error)) {
        throw error;
      }

      return VerificationResult.error({
        providerName: 'sumsub',
        error,
        responseTimeMs
      });
    }
  }

  /**
   * Update verification with additional information
   */
  async updateVerification(verificationReference, updatedData) {
    const startTime = Date.now();
    
    try {
      const { result, responseTimeMs } = await this.executeWithTimeout(
        this.updateApplicant(verificationReference, updatedData)
      );

      return VerificationResult.inProgress({
        verificationReference,
        providerName: 'sumsub',
        providerFields: {
          applicantId: verificationReference,
          updateResult: result
        },
        responseTimeMs
      });
    } catch (errorObj) {
      const { error, responseTimeMs } = errorObj;
      
      if (this.shouldTriggerFallback(error)) {
        throw error;
      }

      return VerificationResult.error({
        providerName: 'sumsub',
        error,
        responseTimeMs
      });
    }
  }

  /**
   * Delete verification data
   */
  async deleteVerification(verificationReference) {
    try {
      await this.executeWithTimeout(
        this.deleteApplicant(verificationReference)
      );
      return true;
    } catch (error) {
      console.error(`[SumSubAdapter] Failed to delete applicant ${verificationReference}:`, error.message);
      return false;
    }
  }

  /**
   * Get supported ID types from SumSub
   */
  async getSupportedIdTypes() {
    try {
      const { result } = await this.executeWithTimeout(
        this.getLevelConfig()
      );

      return {
        success: true,
        supportedIdTypes: this.extractSupportedIdTypes(result),
        requiredFields: this.extractRequiredFields(result),
        optionalFields: this.extractOptionalFields(result)
      };
    } catch (error) {
      throw new Error(`Failed to get SumSub configuration: ${error.message}`);
    }
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    await this.executeWithTimeout(
      axios.get(`${this.baseUrl}/resources/applicants/-/limits`, {
        headers: this.getAuthHeaders(),
        timeout: 3000
      })
    );
  }

  /**
   * Create applicant in SumSub
   */
  async createApplicant(kycData) {
    const payload = {
      externalUserId: kycData.actorId,
      levelName: this.levelName,
      fixedInfo: {
        firstName: kycData.personalInfo.firstName,
        lastName: kycData.personalInfo.lastName,
        email: kycData.personalInfo.email,
        phone: kycData.personalInfo.phone,
        address: {
          streetAddress: kycData.addressInfo.streetAddress,
          city: kycData.addressInfo.city,
          stateProvince: kycData.addressInfo.stateProvince,
          country: kycData.addressInfo.country,
          postalCode: kycData.addressInfo.postalCode
        },
        idDocInfo: {
          docType: kycData.identificationInfo.idType,
          docNumber: kycData.identificationInfo.idNumber,
          issueDate: kycData.identificationInfo.idIssueDate,
          expiryDate: kycData.identificationInfo.idExpiryDate,
          issuingCountry: kycData.identificationInfo.idIssuingCountry
        },
        sourceOfFunds: kycData.additionalInfo?.sourceOfFunds,
        occupation: kycData.additionalInfo?.occupation,
        annualIncome: kycData.additionalInfo?.annualIncome
      }
    };

    return axios.post(`${this.baseUrl}/resources/applicants`, payload, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get applicant status from SumSub
   */
  async getApplicantStatus(applicantId) {
    return axios.get(`${this.baseUrl}/resources/applicants/${applicantId}/status`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Update applicant in SumSub
   */
  async updateApplicant(applicantId, updatedData) {
    const payload = {
      fixedInfo: {
        ...(updatedData.personalInfo && {
          firstName: updatedData.personalInfo.firstName,
          lastName: updatedData.personalInfo.lastName,
          email: updatedData.personalInfo.email,
          phone: updatedData.personalInfo.phone
        }),
        ...(updatedData.addressInfo && {
          address: {
            streetAddress: updatedData.addressInfo.streetAddress,
            city: updatedData.addressInfo.city,
            stateProvince: updatedData.addressInfo.stateProvince,
            country: updatedData.addressInfo.country,
            postalCode: updatedData.addressInfo.postalCode
          }
        }),
        ...(updatedData.identificationInfo && {
          idDocInfo: {
            docType: updatedData.identificationInfo.idType,
            docNumber: updatedData.identificationInfo.idNumber,
            issueDate: updatedData.identificationInfo.idIssueDate,
            expiryDate: updatedData.identificationInfo.idExpiryDate,
            issuingCountry: updatedData.identificationInfo.idIssuingCountry
          }
        }),
        ...(updatedData.additionalInfo && {
          sourceOfFunds: updatedData.additionalInfo.sourceOfFunds,
          occupation: updatedData.additionalInfo.occupation,
          annualIncome: updatedData.additionalInfo.annualIncome
        })
      }
    };

    return axios.patch(`${this.baseUrl}/resources/applicants/${applicantId}/fixedInfo`, payload, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Delete applicant from SumSub
   */
  async deleteApplicant(applicantId) {
    return axios.delete(`${this.baseUrl}/resources/applicants/${applicantId}`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get level configuration from SumSub
   */
  async getLevelConfig() {
    return axios.get(`${this.baseUrl}/resources/levels/${this.levelName}/config`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get authentication headers for SumSub API
   */
  getAuthHeaders() {
    const timestamp = Date.now().toString();
    const signature = this.generateSignature(timestamp);
    
    return {
      'X-App-Token': this.apiToken,
      'X-App-Access-Sig': signature,
      'X-App-Access-Ts': timestamp,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Generate HMAC signature for SumSub API
   */
  generateSignature(timestamp) {
    const crypto = require('crypto');
    const message = timestamp + 'GET/resources/applicants/-/limits';
    return crypto.createHmac('sha256', this.apiSecret).update(message).digest('hex');
  }

  /**
   * Map SumSub status to internal status
   */
  mapSumSubStatus(sumSubStatus) {
    const statusMap = {
      'GREEN': 'verified',
      'RED': 'rejected',
      'YELLOW': 'in_progress',
      'INIT': 'pending'
    };

    return statusMap[sumSubStatus] || 'pending';
  }

  /**
   * Extract rejection reason from SumSub response
   */
  extractRejectionReason(result) {
    if (!result.reviewResult) return null;
    
    const reasons = [];
    if (result.reviewResult.rejectLabels) {
      reasons.push(...result.reviewResult.rejectLabels);
    }
    if (result.reviewResult.clientComment) {
      reasons.push(result.reviewResult.clientComment);
    }
    
    return reasons.length > 0 ? reasons.join('; ') : 'Verification rejected';
  }

  /**
   * Extract supported ID types from level config
   */
  extractSupportedIdTypes(config) {
    const idDocs = config.idDocConfig?.idDocSets || [];
    const types = new Set();
    
    idDocs.forEach(set => {
      if (set.idDocTypes) {
        set.idDocTypes.forEach(type => {
          types.add(type);
        });
      }
    });
    
    return Array.from(types);
  }

  /**
   * Extract required fields from level config
   */
  extractRequiredFields(config) {
    return config.requiredFields || [];
  }

  /**
   * Extract optional fields from level config
   */
  extractOptionalFields(config) {
    return config.optionalFields || [];
  }
}

module.exports = { SumSubAdapter };
