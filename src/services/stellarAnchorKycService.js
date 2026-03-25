const axios = require('axios');
const { Server } = require('@stellar/stellar-sdk');

/**
 * Stellar Anchor KYC Service implementing SEP-12 standards.
 * 
 * This service manages KYC verification workflows with Stellar Anchors,
 * ensuring compliance with global real estate regulations.
 */
class StellarAnchorKycService {
  /**
   * @param {object} config Configuration object.
   * @param {string} config.anchorUrl The anchor's SEP-12 endpoint URL.
   * @param {string} config.anchorAuthKey Authentication key for the anchor.
   * @param {string} config.horizonUrl Stellar Horizon server URL.
   */
  constructor(config) {
    this.config = config;
    this.anchorUrl = config.anchorUrl || process.env.STELLAR_ANCHOR_URL;
    this.anchorAuthKey = config.anchorAuthKey || process.env.STELLAR_ANCHOR_AUTH_KEY;
    this.horizonUrl = config.horizonUrl || process.env.HORIZON_URL || 'https://horizon.stellar.org';
    this.server = new Server(this.horizonUrl);
  }

  /**
   * Submit KYC information to the anchor for verification.
   * 
   * @param {object} kycData KYC information.
   * @param {string} kycData.actorId Actor identifier.
   * @param {string} kycData.actorRole Actor role ('landlord' or 'tenant').
   * @param {string} kycData.stellarAccountId Stellar account address.
   * @param {object} kycData.personalInfo Personal information.
   * @param {string} kycData.personalInfo.firstName First name.
   * @param {string} kycData.personalInfo.lastName Last name.
   * @param {string} kycData.personalInfo.email Email address.
   * @param {string} kycData.personalInfo.phone Phone number.
   * @param {object} kycData.addressInfo Address information.
   * @param {string} kycData.addressInfo.streetAddress Street address.
   * @param {string} kycData.addressInfo.city City.
   * @param {string} kycData.addressInfo.stateProvince State/province.
   * @param {string} kycData.addressInfo.country Country code (ISO 3166-1).
   * @param {string} kycData.addressInfo.postalCode Postal code.
   * @param {object} kycData.identificationInfo Identification documents.
   * @param {string} kycData.identificationInfo.idType Type of ID (passport, driver_license, etc.).
   * @param {string} kycData.identificationInfo.idNumber ID number.
   * @param {string} kycData.identificationInfo.idIssueDate ID issue date.
   * @param {string} kycData.identificationInfo.idExpiryDate ID expiry date.
   * @param {string} kycData.identificationInfo.idIssuingCountry ID issuing country.
   * @param {object} kycData.additionalInfo Additional verification data.
   * @param {string} kycData.additionalInfo.sourceOfFunds Source of funds.
   * @param {string} kycData.additionalInfo.occupation Occupation.
   * @param {string} kycData.additionalInfo.annualIncome Annual income range.
   * @returns {Promise<object>} Submission result.
   */
  async submitKycVerification(kycData) {
    try {
      // Validate Stellar account exists
      await this.validateStellarAccount(kycData.stellarAccountId);

      // Prepare SEP-12 compliant payload
      const sep12Payload = {
        account: kycData.stellarAccountId,
        memo: kycData.actorId,
        memo_type: 'text',
        first_name: kycData.personalInfo.firstName,
        last_name: kycData.personalInfo.lastName,
        email_address: kycData.personalInfo.email,
        phone_number: kycData.personalInfo.phone,
        address: {
          street_address: kycData.addressInfo.streetAddress,
          city: kycData.addressInfo.city,
          state_province: kycData.addressInfo.stateProvince,
          country: kycData.addressInfo.country,
          postal_code: kycData.addressInfo.postalCode
        },
        identification: {
          id_type: kycData.identificationInfo.idType,
          id_number: kycData.identificationInfo.idNumber,
          id_issue_date: kycData.identificationInfo.idIssueDate,
          id_expiry_date: kycData.identificationInfo.idExpiryDate,
          id_issuing_country: kycData.identificationInfo.idIssuingCountry
        },
        additional_information: {
          source_of_funds: kycData.additionalInfo.sourceOfFunds,
          occupation: kycData.additionalInfo.occupation,
          annual_income_range: kycData.additionalInfo.annualIncome
        }
      };

      // Submit to anchor
      const response = await axios.post(
        `${this.anchorUrl}/customer`,
        sep12Payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anchorAuthKey}`
          },
          timeout: 30000
        }
      );

      return {
        success: true,
        verificationReference: response.data.id,
        status: 'submitted',
        message: 'KYC verification submitted successfully'
      };

    } catch (error) {
      console.error('[StellarAnchorKycService] Error submitting KYC:', error.response?.data || error.message);
      
      if (error.response?.status === 400) {
        throw new Error(`Invalid KYC data: ${error.response.data.message}`);
      } else if (error.response?.status === 401) {
        throw new Error('Anchor authentication failed');
      } else if (error.response?.status === 409) {
        throw new Error('KYC verification already exists for this account');
      } else {
        throw new Error(`Anchor service error: ${error.message}`);
      }
    }
  }

  /**
   * Check KYC verification status from the anchor.
   * 
   * @param {string} stellarAccountId Stellar account address.
   * @returns {Promise<object>} KYC status information.
   */
  async getKycStatus(stellarAccountId) {
    try {
      const response = await axios.get(
        `${this.anchorUrl}/customer`,
        {
          params: { account: stellarAccountId },
          headers: {
            'Authorization': `Bearer ${this.anchorAuthKey}`
          },
          timeout: 15000
        }
      );

      const customer = response.data;
      
      return {
        success: true,
        verificationReference: customer.id,
        status: this.mapAnchorStatusToKycStatus(customer.status),
        verifiedAt: customer.verified_at || null,
        rejectedAt: customer.rejected_at || null,
        rejectionReason: customer.rejection_reason || null,
        providerFields: customer.provider_fields || {}
      };

    } catch (error) {
      console.error('[StellarAnchorKycService] Error checking KYC status:', error.response?.data || error.message);
      
      if (error.response?.status === 404) {
        return {
          success: false,
          status: 'not_found',
          message: 'No KYC verification found for this account'
        };
      } else {
        throw new Error(`Anchor service error: ${error.message}`);
      }
    }
  }

  /**
   * Update KYC information for an existing verification.
   * 
   * @param {string} verificationReference The verification reference from initial submission.
   * @param {object} updatedData Updated KYC information.
   * @returns {Promise<object>} Update result.
   */
  async updateKycVerification(verificationReference, updatedData) {
    try {
      const response = await axios.put(
        `${this.anchorUrl}/customer/${verificationReference}`,
        updatedData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.anchorAuthKey}`
          },
          timeout: 30000
        }
      );

      return {
        success: true,
        verificationReference,
        status: this.mapAnchorStatusToKycStatus(response.data.status),
        message: 'KYC verification updated successfully'
      };

    } catch (error) {
      console.error('[StellarAnchorKycService] Error updating KYC:', error.response?.data || error.message);
      throw new Error(`Update failed: ${error.message}`);
    }
  }

  /**
   * Delete KYC verification data (GDPR compliance).
   * 
   * @param {string} verificationReference The verification reference.
   * @returns {Promise<object>} Deletion result.
   */
  async deleteKycVerification(verificationReference) {
    try {
      await axios.delete(
        `${this.anchorUrl}/customer/${verificationReference}`,
        {
          headers: {
            'Authorization': `Bearer ${this.anchorAuthKey}`
          },
          timeout: 15000
        }
      );

      return {
        success: true,
        message: 'KYC verification data deleted successfully'
      };

    } catch (error) {
      console.error('[StellarAnchorKycService] Error deleting KYC:', error.response?.data || error.message);
      throw new Error(`Deletion failed: ${error.message}`);
    }
  }

  /**
   * Validate that a Stellar account exists and is properly funded.
   * 
   * @param {string} accountId Stellar account address.
   * @returns {Promise<void>}
   */
  async validateStellarAccount(accountId) {
    try {
      const account = await this.server.loadAccount(accountId);
      
      if (!account) {
        throw new Error('Stellar account not found');
      }

      // Check if account has minimum balance (1 XLM)
      const xlmBalance = account.balances
        .find(b => b.asset_type === 'native');
      
      if (!xlmBalance || parseFloat(xlmBalance.balance) < 1) {
        throw new Error('Stellar account must have minimum balance of 1 XLM');
      }

    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Stellar account not found');
      }
      throw error;
    }
  }

  /**
   * Map anchor status to internal KYC status.
   * 
   * @param {string} anchorStatus Status from anchor.
   * @returns {string} Mapped KYC status.
   */
  mapAnchorStatusToKycStatus(anchorStatus) {
    const statusMap = {
      'ACCEPTED': 'verified',
      'PROCESSING': 'in_progress',
      'REJECTED': 'rejected',
      'NEEDS_INFO': 'in_progress',
      'VERIFIED': 'verified'
    };

    return statusMap[anchorStatus] || 'pending';
  }

  /**
   * Get supported ID types from the anchor.
   * 
   * @returns {Promise<object>} Supported ID types and requirements.
   */
  async getSupportedIdTypes() {
    try {
      const response = await axios.get(
        `${this.anchorUrl}/info`,
        {
          timeout: 10000
        }
      );

      return {
        success: true,
        supportedIdTypes: response.data.sep12?.accepted_id_types || [],
        requiredFields: response.data.sep12?.required_fields || [],
        optionalFields: response.data.sep12?.optional_fields || []
      };

    } catch (error) {
      console.error('[StellarAnchorKycService] Error getting supported ID types:', error.message);
      throw new Error(`Failed to get anchor info: ${error.message}`);
    }
  }
}

module.exports = { StellarAnchorKycService };
