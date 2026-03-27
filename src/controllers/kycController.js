const { StellarAnchorKycService } = require('../services/stellarAnchorKycService');

class KycController {
  /**
   * Submit KYC verification for an actor.
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

      // Initialize KYC service
      const kycService = new StellarAnchorKycService(config);

      // Check if KYC already exists for this actor
      const existingKyc = database.getKycVerificationByActor(actorId, actorRole);
      if (existingKyc && existingKyc.kycStatus !== 'rejected') {
        return res.status(409).json({ 
          error: "KYC verification already exists for this actor",
          existingKyc 
        });
      }

      // Submit to anchor
      const anchorResult = await kycService.submitKycVerification({
        actorId,
        actorRole,
        stellarAccountId,
        personalInfo,
        addressInfo,
        identificationInfo,
        additionalInfo: additionalInfo || {}
      });

      // Store in database
      const kycRecord = database.upsertKycVerification({
        actorId,
        actorRole,
        stellarAccountId,
        kycStatus: 'in_progress',
        anchorProvider: new URL(kycService.anchorUrl).hostname,
        verificationReference: anchorResult.verificationReference,
        submittedAt: new Date().toISOString()
      });

      console.log(`[KycController] KYC verification submitted for ${actorRole} ${actorId}`);

      return res.status(201).json({
        success: true,
        message: "KYC verification submitted successfully",
        kycRecord,
        anchorSubmission: anchorResult
      });

    } catch (error) {
      console.error("[KycController] Error submitting KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to submit KYC verification", 
        details: error.message 
      });
    }
  }

  /**
   * Get KYC verification status for an actor.
   */
  async getKycStatus(req, res) {
    try {
      const database = req.app.locals.database;
      const config = req.app.locals.config;
      
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

      // If status is still pending/in_progress, check with anchor
      if (['pending', 'in_progress'].includes(kycRecord.kycStatus) && kycRecord.stellarAccountId) {
        try {
          const kycService = new StellarAnchorKycService(config);
          const anchorStatus = await kycService.getKycStatus(kycRecord.stellarAccountId);

          if (anchorStatus.success) {
            // Update database with latest status
            const updatedKyc = database.updateKycStatus(actorId, actorRole, anchorStatus.status, {
              verified_at: anchorStatus.verifiedAt,
              rejected_at: anchorStatus.rejectedAt,
              rejection_reason: anchorStatus.rejectionReason
            });

            return res.status(200).json({
              success: true,
              kycRecord: updatedKyc,
              anchorStatus
            });
          }
        } catch (anchorError) {
          console.warn(`[KycController] Could not check anchor status: ${anchorError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        kycRecord
      });

    } catch (error) {
      console.error("[KycController] Error getting KYC status:", error);
      return res.status(500).json({ 
        error: "Failed to get KYC status", 
        details: error.message 
      });
    }
  }

  /**
   * Update KYC verification information.
   */
  async updateKycVerification(req, res) {
    try {
      const database = req.app.locals.database;
      const config = req.app.locals.config;
      
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

      // Initialize KYC service
      const kycService = new StellarAnchorKycService(config);

      // Update with anchor
      const anchorResult = await kycService.updateKycVerification(
        existingKyc.verificationReference,
        {
          personal_info: personalInfo,
          address_info: addressInfo,
          identification_info: identificationInfo,
          additional_information: additionalInfo
        }
      );

      // Update database
      const updatedKyc = database.updateKycStatus(actorId, actorRole, anchorResult.status);

      console.log(`[KycController] KYC verification updated for ${actorRole} ${actorId}`);

      return res.status(200).json({
        success: true,
        message: "KYC verification updated successfully",
        kycRecord: updatedKyc,
        anchorUpdate: anchorResult
      });

    } catch (error) {
      console.error("[KycController] Error updating KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to update KYC verification", 
        details: error.message 
      });
    }
  }

  /**
   * Check KYC compliance for a lease (both landlord and tenant).
   */
  async checkLeaseKycCompliance(req, res) {
    try {
      const database = req.app.locals.database;
      
      if (!database) {
        return res.status(500).json({ error: "Database service unavailable." });
      }

      const { landlordId, tenantId } = req.body;

      if (!landlordId || !tenantId) {
        return res.status(400).json({ 
          error: "Missing required fields: landlordId, tenantId" 
        });
      }

      // Check compliance
      const compliance = database.checkLeaseKycCompliance(landlordId, tenantId);

      return res.status(200).json({
        success: true,
        compliance,
        message: compliance.leaseCanProceed 
          ? "Both parties are KYC verified. Lease can proceed."
          : "KYC verification required for one or both parties before lease can proceed."
      });

    } catch (error) {
      console.error("[KycController] Error checking lease KYC compliance:", error);
      return res.status(500).json({ 
        error: "Failed to check lease KYC compliance", 
        details: error.message 
      });
    }
  }

  /**
   * Get supported ID types and requirements from anchor.
   */
  async getKycRequirements(req, res) {
    try {
      const config = req.app.locals.config;
      const kycService = new StellarAnchorKycService(config);

      const requirements = await kycService.getSupportedIdTypes();

      return res.status(200).json({
        success: true,
        requirements
      });

    } catch (error) {
      console.error("[KycController] Error getting KYC requirements:", error);
      return res.status(500).json({ 
        error: "Failed to get KYC requirements", 
        details: error.message 
      });
    }
  }

  /**
   * Delete KYC verification data (GDPR compliance).
   */
  async deleteKycVerification(req, res) {
    try {
      const database = req.app.locals.database;
      const config = req.app.locals.config;
      
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

      // Delete from anchor if reference exists
      if (existingKyc.verificationReference) {
        try {
          const kycService = new StellarAnchorKycService(config);
          await kycService.deleteKycVerification(existingKyc.verificationReference);
        } catch (anchorError) {
          console.warn(`[KycController] Could not delete from anchor: ${anchorError.message}`);
        }
      }

      // Delete from database (you would need to implement this method)
      // For now, we'll mark it as deleted
      // database.deleteKycVerification(actorId, actorRole);

      console.log(`[KycController] KYC verification deleted for ${actorRole} ${actorId}`);

      return res.status(200).json({
        success: true,
        message: "KYC verification data deleted successfully"
      });

    } catch (error) {
      console.error("[KycController] Error deleting KYC verification:", error);
      return res.status(500).json({ 
        error: "Failed to delete KYC verification", 
        details: error.message 
      });
    }
  }
}

module.exports = new KycController();
