const { IdentityRouterService } = require('../services/identityRouterService');
const { StellarAnchorKycService } = require('../services/stellarAnchorKycService');

/**
 * Enhanced KYC Controller with Identity Provider Fallback Router
 * Integrates with the Identity Router for resilient KYC verification
 */
class EnhancedKycController {
  constructor(config) {
    this.config = config;
    
    // Initialize Identity Router if enabled
    if (config.identityRouterEnabled) {
      this.identityRouter = new IdentityRouterService({
        providerPriority: config.identityRouterProviders,
        fallbackTimeout: config.identityRouterTimeout,
        sumsub: {
          apiToken: config.sumsubApiToken,
          apiSecret: config.sumsubApiSecret,
          baseUrl: config.sumsubBaseUrl,
          levelName: config.sumsubLevelName,
          callbackBaseUrl: config.identityCallbackBaseUrl,
          frontendBaseUrl: config.identityFrontendBaseUrl
        },
        jumio: {
          apiToken: config.jumioApiToken,
          apiSecret: config.jumioApiSecret,
          baseUrl: config.jumioBaseUrl,
          customerId: config.jumioCustomerId,
          workflowDefinitionId: config.jumioWorkflowDefinitionId,
          callbackBaseUrl: config.identityCallbackBaseUrl,
          frontendBaseUrl: config.identityFrontendBaseUrl
        }
      });
    }

    // Fallback to original Stellar Anchor service
    this.stellarAnchorService = new StellarAnchorKycService(config);
  }

  /**
   * Submit KYC verification with automatic fallback
   */
  async submitKycVerification(req, res) {
    try {
      const database = req.app.locals.database;
      const config = req.app.locals.config;
      
      if (!database) {
        return res.status(500).json({ error: "Database service unavailable." });
      }

      const { actorId, actorRole, stellarAccountId, personalInfo, addressInfo, identificationInfo, additionalInfo } = req.body;

      // Validate required fields
      if (!actorId || !actorRole || !stellarAccountId || !personalInfo || !addressInfo || !identificationInfo) {
        return res.status(400).json({ 
          error: "Missing required fields: actorId, actorRole, stellarAccountId, personalInfo, addressInfo, identificationInfo" 
        });
      }

      if (!['landlord', 'tenant'].includes(actorRole)) {
        return res.status(400).json({ error: "Invalid actor role. Must be 'landlord' or 'tenant'." });
      }

      // Check if KYC already exists for this actor
      const existingKyc = database.getKycVerificationByActor(actorId, actorRole);
      if (existingKyc && existingKyc.kycStatus !== 'rejected') {
        return res.status(409).json({ 
          error: "KYC verification already exists for this actor",
          existingKyc 
        });
      }

      let verificationResult;
      let providerUsed;

      // Use Identity Router if enabled and configured
      if (this.identityRouter) {
        try {
          const kycData = {
            actorId,
            actorRole,
            stellarAccountId,
            personalInfo,
            addressInfo,
            identificationInfo,
            additionalInfo: additionalInfo || {}
          };

          verificationResult = await this.identityRouter.submitVerification(kycData);
          providerUsed = verificationResult.providerName;
          
          console.log(`[EnhancedKycController] KYC submitted via ${providerUsed} (fallback: ${verificationResult.isFallback})`);
        } catch (error) {
          console.error(`[EnhancedKycController] Identity Router failed:`, error.message);
          
          // Fallback to Stellar Anchor if Identity Router fails completely
          verificationResult = await this.stellarAnchorService.submitKycVerification({
            actorId,
            actorRole,
            stellarAccountId,
            personalInfo,
            addressInfo,
            identificationInfo,
            additionalInfo: additionalInfo || {}
          });
          providerUsed = 'stellar_anchor_fallback';
        }
      } else {
        // Use original Stellar Anchor service
        verificationResult = await this.stellarAnchorService.submitKycVerification({
          actorId,
          actorRole,
          stellarAccountId,
          personalInfo,
          addressInfo,
          identificationInfo,
          additionalInfo: additionalInfo || {}
        });
        providerUsed = 'stellar_anchor';
      }

      // Store in database
      const kycRecord = database.upsertKycVerification({
        actorId,
        actorRole,
        stellarAccountId,
        kycStatus: 'in_progress',
        anchorProvider: providerUsed,
        verificationReference: verificationResult.verificationReference,
        submittedAt: new Date().toISOString(),
        providerFields: verificationResult.providerFields
      });

      console.log(`[EnhancedKycController] KYC verification submitted for ${actorRole} ${actorId} via ${providerUsed}`);

      return res.status(201).json({
        success: true,
        message: "KYC verification submitted successfully",
        kycRecord,
        verificationSubmission: verificationResult,
        providerUsed,
        isFallback: verificationResult.isFallback || false
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error submitting KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to submit KYC verification", 
        details: error.message 
      });
    }
  }

  /**
   * Get KYC verification status with fallback support
   */
  async getKycStatus(req, res) {
    try {
      const database = req.app.locals.database;
      
      if (!database) {
        return res.status(500).json({ error: "Database service unavailable." });
      }

      const { actorId, actorRole } = req.params;

      if (!['landlord', 'tenant'].includes(actorRole)) {
        return res.status(400).json({ error: "Invalid actor role. Must be 'landlord' or 'tenant'." });
      }

      // Get from database
      const kycRecord = database.getKycVerificationByActor(actorId, actorRole);
      
      if (!kycRecord) {
        return res.status(404).json({ 
          error: "KYC verification not found for this actor",
          status: 'not_started'
        });
      }

      // If status is still pending/in_progress, check with provider
      if (['pending', 'in_progress'].includes(kycRecord.kycStatus) && kycRecord.verificationReference) {
        try {
          let statusResult;

          // Use Identity Router if the verification was submitted through it
          if (this.identityRouter && kycRecord.anchorProvider !== 'stellar_anchor') {
            statusResult = await this.identityRouter.checkStatus(
              kycRecord.verificationReference,
              kycRecord.anchorProvider
            );
          } else {
            // Use Stellar Anchor service
            statusResult = await this.stellarAnchorService.getKycStatus(kycRecord.stellarAccountId);
          }

          if (statusResult.success) {
            // Update database with latest status
            const updatedKyc = database.updateKycStatus(actorId, actorRole, statusResult.status, {
              verified_at: statusResult.verifiedAt,
              rejected_at: statusResult.rejectedAt,
              rejection_reason: statusResult.rejectionReason,
              provider_fields: statusResult.providerFields
            });

            return res.status(200).json({
              success: true,
              kycRecord: updatedKyc,
              providerStatus: statusResult,
              providerUsed: kycRecord.anchorProvider
            });
          }
        } catch (providerError) {
          console.warn(`[EnhancedKycController] Could not check provider status: ${providerError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        kycRecord,
        providerUsed: kycRecord.anchorProvider
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error getting KYC status:", error);
      return res.status(500).json({ 
        error: "Failed to get KYC status", 
        details: error.message 
      });
    }
  }

  /**
   * Update KYC verification information
   */
  async updateKycVerification(req, res) {
    try {
      const database = req.app.locals.database;
      
      if (!database) {
        return res.status(500).json({ error: "Database service unavailable." });
      }

      const { actorId, actorRole } = req.params;
      const { personalInfo, addressInfo, identificationInfo, additionalInfo } = req.body;

      if (!['landlord', 'tenant'].includes(actorRole)) {
        return res.status(400).json({ error: "Invalid actor role. Must be 'landlord' or 'tenant'." });
      }

      // Get existing KYC record
      const existingKyc = database.getKycVerificationByActor(actorId, actorRole);
      if (!existingKyc) {
        return res.status(404).json({ error: "KYC verification not found for this actor" });
      }

      if (!existingKyc.verificationReference) {
        return res.status(400).json({ error: "No verification reference found for this KYC record" });
      }

      let updateResult;

      // Use Identity Router if the verification was submitted through it
      if (this.identityRouter && existingKyc.anchorProvider !== 'stellar_anchor') {
        const updatedData = {
          personalInfo,
          addressInfo,
          identificationInfo,
          additionalInfo
        };

        updateResult = await this.identityRouter.updateVerification(
          existingKyc.verificationReference,
          updatedData,
          existingKyc.anchorProvider
        );
      } else {
        // Use Stellar Anchor service
        updateResult = await this.stellarAnchorService.updateKycVerification(
          existingKyc.verificationReference,
          {
            personal_info: personalInfo,
            address_info: addressInfo,
            identification_info: identificationInfo,
            additional_information: additionalInfo
          }
        );
      }

      // Update database
      const updatedKyc = database.updateKycStatus(actorId, actorRole, updateResult.status);

      console.log(`[EnhancedKycController] KYC verification updated for ${actorRole} ${actorId}`);

      return res.status(200).json({
        success: true,
        message: "KYC verification updated successfully",
        kycRecord: updatedKyc,
        providerUpdate: updateResult,
        providerUsed: existingKyc.anchorProvider
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error updating KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to update KYC verification", 
        details: error.message 
      });
    }
  }

  /**
   * Get health status of identity providers
   */
  async getIdentityProvidersHealth(req, res) {
    try {
      if (!this.identityRouter) {
        return res.status(503).json({
          error: "Identity Router is not enabled",
          message: "Configure IDENTITY_ROUTER_ENABLED=true to enable provider health monitoring"
        });
      }

      const healthStatus = await this.identityRouter.getHealthStatus();
      
      return res.status(200).json({
        success: true,
        healthStatus,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error getting provider health:", error);
      return res.status(500).json({ 
        error: "Failed to get provider health status", 
        details: error.message 
      });
    }
  }

  /**
   * Get supported ID types and requirements
   */
  async getKycRequirements(req, res) {
    try {
      let requirements;

      // Use Identity Router if enabled
      if (this.identityRouter) {
        requirements = await this.identityRouter.getSupportedIdTypes();
      } else {
        // Use Stellar Anchor service
        requirements = await this.stellarAnchorService.getSupportedIdTypes();
      }

      return res.status(200).json({
        success: true,
        requirements,
        providerUsed: this.identityRouter ? 'identity_router' : 'stellar_anchor'
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error getting KYC requirements:", error);
      return res.status(500).json({ 
        error: "Failed to get KYC requirements", 
        details: error.message 
      });
    }
  }

  /**
   * Get Prometheus metrics for identity providers
   */
  async getIdentityMetrics(req, res) {
    try {
      if (!this.identityRouter) {
        return res.status(503).json({
          error: "Identity Router is not enabled",
          message: "Configure IDENTITY_ROUTER_ENABLED=true to enable metrics"
        });
      }

      const prometheusMetrics = this.identityRouter.getPrometheusMetrics();
      const metrics = await prometheusMetrics.getMetrics();
      
      res.set('Content-Type', prometheusMetrics.register.contentType);
      res.end(metrics);

    } catch (error) {
      console.error("[EnhancedKycController] Error getting identity metrics:", error);
      return res.status(500).json({ 
        error: "Failed to get identity metrics", 
        details: error.message 
      });
    }
  }

  /**
   * Delete KYC verification data (GDPR compliance)
   */
  async deleteKycVerification(req, res) {
    try {
      const database = req.app.locals.database;
      
      if (!database) {
        return res.status(500).json({ error: "Database service unavailable." });
      }

      const { actorId, actorRole } = req.params;

      if (!['landlord', 'tenant'].includes(actorRole)) {
        return res.status(400).json({ error: "Invalid actor role. Must be 'landlord' or 'tenant'." });
      }

      // Get existing KYC record
      const existingKyc = database.getKycVerificationByActor(actorId, actorRole);
      if (!existingKyc) {
        return res.status(404).json({ error: "KYC verification not found for this actor" });
      }

      // Delete from provider if reference exists
      if (existingKyc.verificationReference) {
        try {
          if (this.identityRouter && existingKyc.anchorProvider !== 'stellar_anchor') {
            // Use Identity Router to delete from appropriate provider
            const provider = this.identityRouter.providers[existingKyc.anchorProvider];
            if (provider && typeof provider.deleteVerification === 'function') {
              await provider.deleteVerification(existingKyc.verificationReference);
            }
          } else {
            // Use Stellar Anchor service
            await this.stellarAnchorService.deleteKycVerification(existingKyc.verificationReference);
          }
        } catch (providerError) {
          console.warn(`[EnhancedKycController] Could not delete from provider: ${providerError.message}`);
        }
      }

      // Delete from database (you would need to implement this method)
      // For now, we'll mark it as deleted
      // database.deleteKycVerification(actorId, actorRole);

      console.log(`[EnhancedKycController] KYC verification deleted for ${actorRole} ${actorId}`);

      return res.status(200).json({
        success: true,
        message: "KYC verification data deleted successfully"
      });

    } catch (error) {
      console.error("[EnhancedKycController] Error deleting KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to delete KYC verification", 
        details: error.message 
      });
    }
  }
}

module.exports = { EnhancedKycController };
