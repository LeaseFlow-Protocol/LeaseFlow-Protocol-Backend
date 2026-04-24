const axios = require('axios');
const { BaseIdentityAdapter } = require('./BaseIdentityAdapter');
const { VerificationResult } = require('../dtos/VerificationResult');

/**
 * Jumio Identity Adapter
 * Implements Jumio API integration for KYC verification
 */
class JumioAdapter extends BaseIdentityAdapter {
  constructor(config) {
    super(config);
    this.apiToken = config.apiToken;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl || 'https://api.jumio.com';
    this.customerId = config.customerId;
    this.workflowDefinitionId = config.workflowDefinitionId;
  }

  /**
   * Submit KYC verification to Jumio
   */
  async submitVerification(kycData) {
    const startTime = Date.now();
    
    try {
      const { result, responseTimeMs } = await this.executeWithTimeout(
        this.createJumioVerification(kycData)
      );

      const verificationResult = VerificationResult.inProgress({
        verificationReference: result.id,
        providerName: 'jumio',
        providerFields: {
          verificationId: result.id,
          workflowExecutionId: result.workflowExecutionId,
          redirectUrl: result.redirectUrl
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
        providerName: 'jumio',
        error,
        responseTimeMs
      });
    }
  }

  /**
   * Check verification status from Jumio
   */
  async checkStatus(verificationReference) {
    const startTime = Date.now();
    
    try {
      const { result, responseTimeMs } = await this.executeWithTimeout(
        this.getJumioVerificationStatus(verificationReference)
      );

      const status = this.mapJumioStatus(result.workflowExecution?.status);
      const verifiedAt = status === 'verified' ? new Date(result.workflowExecution?.completedAt) : null;
      const rejectedAt = status === 'rejected' ? new Date(result.workflowExecution?.completedAt) : null;
      const rejectionReason = status === 'rejected' ? this.extractRejectionReason(result) : null;

      if (status === 'verified') {
        return VerificationResult.success({
          verificationReference,
          providerName: 'jumio',
          verifiedAt,
          providerFields: {
            verificationId: verificationReference,
            workflowExecution: result.workflowExecution,
            documents: result.documents
          },
          responseTimeMs
        });
      } else if (status === 'rejected') {
        return VerificationResult.rejected({
          verificationReference,
          providerName: 'jumio',
          rejectionReason,
          rejectedAt,
          providerFields: {
            verificationId: verificationReference,
            workflowExecution: result.workflowExecution
          },
          responseTimeMs
        });
      } else {
        return VerificationResult.inProgress({
          verificationReference,
          providerName: 'jumio',
          providerFields: {
            verificationId: verificationReference,
            workflowExecution: result.workflowExecution
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
        providerName: 'jumio',
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
        this.updateJumioVerification(verificationReference, updatedData)
      );

      return VerificationResult.inProgress({
        verificationReference,
        providerName: 'jumio',
        providerFields: {
          verificationId: verificationReference,
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
        providerName: 'jumio',
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
        this.deleteJumioVerification(verificationReference)
      );
      return true;
    } catch (error) {
      console.error(`[JumioAdapter] Failed to delete verification ${verificationReference}:`, error.message);
      return false;
    }
  }

  /**
   * Get supported ID types from Jumio
   */
  async getSupportedIdTypes() {
    try {
      const { result } = await this.executeWithTimeout(
        this.getWorkflowDefinition()
      );

      return {
        success: true,
        supportedIdTypes: this.extractSupportedIdTypes(result),
        requiredFields: this.extractRequiredFields(result),
        optionalFields: this.extractOptionalFields(result)
      };
    } catch (error) {
      throw new Error(`Failed to get Jumio configuration: ${error.message}`);
    }
  }

  /**
   * Perform health check
   */
  async performHealthCheck() {
    await this.executeWithTimeout(
      axios.get(`${this.baseUrl}/api/v1/workflow-definitions`, {
        headers: this.getAuthHeaders(),
        timeout: 3000
      })
    );
  }

  /**
   * Create verification in Jumio
   */
  async createJumioVerification(kycData) {
    const payload = {
      customerInternalReference: kycData.actorId,
      workflowDefinitionId: this.workflowDefinitionId,
      userReference: kycData.stellarAccountId,
      callbackUrl: `${this.config.callbackBaseUrl}/webhooks/jumio`,
      redirectUrl: `${this.config.frontendBaseUrl}/kyc/complete`,
      userInfo: {
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
        }
      },
      additionalData: {
        sourceOfFunds: kycData.additionalInfo?.sourceOfFunds,
        occupation: kycData.additionalInfo?.occupation,
        annualIncome: kycData.additionalInfo?.annualIncome,
        idType: kycData.identificationInfo.idType,
        idNumber: kycData.identificationInfo.idNumber,
        idIssueDate: kycData.identificationInfo.idIssueDate,
        idExpiryDate: kycData.identificationInfo.idExpiryDate,
        idIssuingCountry: kycData.identificationInfo.idIssuingCountry
      }
    };

    return axios.post(`${this.baseUrl}/api/v1/verifications`, payload, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get verification status from Jumio
   */
  async getJumioVerificationStatus(verificationId) {
    return axios.get(`${this.baseUrl}/api/v1/verifications/${verificationId}`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Update verification in Jumio
   */
  async updateJumioVerification(verificationId, updatedData) {
    const payload = {
      userInfo: {
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
        })
      },
      additionalData: {
        ...(updatedData.additionalInfo && {
          sourceOfFunds: updatedData.additionalInfo.sourceOfFunds,
          occupation: updatedData.additionalInfo.occupation,
          annualIncome: updatedData.additionalInfo.annualIncome
        }),
        ...(updatedData.identificationInfo && {
          idType: updatedData.identificationInfo.idType,
          idNumber: updatedData.identificationInfo.idNumber,
          idIssueDate: updatedData.identificationInfo.idIssueDate,
          idExpiryDate: updatedData.identificationInfo.idExpiryDate,
          idIssuingCountry: updatedData.identificationInfo.idIssuingCountry
        })
      }
    };

    return axios.patch(`${this.baseUrl}/api/v1/verifications/${verificationId}`, payload, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Delete verification from Jumio
   */
  async deleteJumioVerification(verificationId) {
    return axios.delete(`${this.baseUrl}/api/v1/verifications/${verificationId}`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get workflow definition from Jumio
   */
  async getWorkflowDefinition() {
    return axios.get(`${this.baseUrl}/api/v1/workflow-definitions/${this.workflowDefinitionId}`, {
      headers: this.getAuthHeaders(),
      timeout: this.timeout
    });
  }

  /**
   * Get authentication headers for Jumio API
   */
  getAuthHeaders() {
    const authString = `${this.apiToken}:${this.apiSecret}`;
    const encodedAuth = Buffer.from(authString).toString('base64');
    
    return {
      'Authorization': `Basic ${encodedAuth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Map Jumio status to internal status
   */
  mapJumioStatus(jumioStatus) {
    const statusMap = {
      'COMPLETED_APPROVED': 'verified',
      'COMPLETED_DECLINED': 'rejected',
      'IN_PROGRESS': 'in_progress',
      'INITIATED': 'pending',
      'COMPLETED_REVIEW': 'in_progress'
    };

    return statusMap[jumioStatus] || 'pending';
  }

  /**
   * Extract rejection reason from Jumio response
   */
  extractRejectionReason(result) {
    if (!result.workflowExecution) return null;
    
    const reasons = [];
    
    if (result.workflowExecution.declineReasons) {
      reasons.push(...result.workflowExecution.declineReasons);
    }
    
    if (result.workflowExecution.declineLabels) {
      reasons.push(...result.workflowExecution.declineLabels);
    }
    
    if (result.workflowExecution.comments) {
      reasons.push(result.workflowExecution.comments);
    }
    
    return reasons.length > 0 ? reasons.join('; ') : 'Verification rejected';
  }

  /**
   * Extract supported ID types from workflow definition
   */
  extractSupportedIdTypes(workflowDefinition) {
    const documentTypes = workflowDefinition.documentTypes || [];
    const types = new Set();
    
    documentTypes.forEach(docType => {
      if (docType.type) {
        types.add(docType.type);
      }
    });
    
    return Array.from(types);
  }

  /**
   * Extract required fields from workflow definition
   */
  extractRequiredFields(workflowDefinition) {
    const fields = [];
    
    if (workflowDefinition.requiredFields) {
      fields.push(...workflowDefinition.requiredFields);
    }
    
    if (workflowDefinition.userInfo?.required) {
      fields.push(...workflowDefinition.userInfo.required);
    }
    
    return fields;
  }

  /**
   * Extract optional fields from workflow definition
   */
  extractOptionalFields(workflowDefinition) {
    const fields = [];
    
    if (workflowDefinition.optionalFields) {
      fields.push(...workflowDefinition.optionalFields);
    }
    
    if (workflowDefinition.userInfo?.optional) {
      fields.push(...workflowDefinition.userInfo.optional);
    }
    
    return fields;
  }
}

module.exports = { JumioAdapter };
