const LeaseStorage = require('../services/Encrypted_IPFS_Lease_Storage');

class LeaseController {
    /**
     * Uploads the PDF lease agreement to IPFS after encryption.
     * Validates KYC compliance before allowing lease upload.
     */
    async uploadLease(req, res) {
        try {
            const { tenantPubKey, landlordPubKey, landlordId, tenantId } = req.body;
            if (!req.file || !tenantPubKey || !landlordPubKey) {
                return res.status(400).json({ error: "Missing required fields (file, tenantPubKey, landlordPubKey)." });
            }

            // Get database from app locals
            const database = req.app.locals.database;
            if (!database) {
                console.warn("[LeaseController] Database not found in app.locals.");
                return res.status(500).json({ error: "Database service unavailable." });
            }

            // If actor IDs are provided, validate KYC compliance
            if (landlordId && tenantId) {
                console.log(`[LeaseController] Checking KYC compliance for landlord ${landlordId} and tenant ${tenantId}`);
                
                const compliance = database.checkLeaseKycCompliance(landlordId, tenantId);
                
                if (!compliance.leaseCanProceed) {
                    const missingKyc = [];
                    if (!compliance.landlord.isVerified) missingKyc.push('landlord');
                    if (!compliance.tenant.isVerified) missingKyc.push('tenant');
                    
                    return res.status(403).json({ 
                        error: "KYC verification required",
                        message: `KYC verification is required for: ${missingKyc.join(', ')}`,
                        compliance,
                        kycRequired: true
                    });
                }
                
                console.log(`[LeaseController] KYC compliance verified for both parties`);
            }

            console.log(`[LeaseController] Encrypting and uploading lease for parties ${tenantPubKey.slice(0, 8)} and ${landlordPubKey.slice(0, 8)}...`);
            
            // This is the "Backend must store only the resulting CID" part
            const leaseCID = await LeaseStorage.storeLease(
                req.file.buffer, 
                tenantPubKey, 
                landlordPubKey
            );

            console.log(`[LeaseController] Lease stored successfully. Metadata CID: ${leaseCID}`);

            // Return CID. Backend "stores" only this.
            return res.status(201).json({ 
                status: "success",
                message: landlordId && tenantId 
                    ? "Lease record created and uploaded to IPFS. KYC compliance verified."
                    : "Lease record created and uploaded to IPFS.",
                leaseCID,
                kycVerified: landlordId && tenantId ? true : null
            });
        } catch (error) {
            console.error("[LeaseController] Error uploading lease:", error);
            return res.status(500).json({ error: "Internal server error during lease upload.", details: error.message });
        }
    }

    /**
     * Facilitates the decryption handshake for authorized users (tenant or landlord).
     */
    async getHandshake(req, res) {
        try {
            const { leaseCID } = req.params;
            const { userPubKey } = req.query;

            if (!leaseCID || !userPubKey) {
                return res.status(400).json({ error: "Missing CID or userPubKey." });
            }

            console.log(`[LeaseController] Retrieving handshake for user ${userPubKey.slice(0, 8)} and CID ${leaseCID.slice(0, 8)}...`);

            const handshake = await LeaseStorage.getHandshakeData(leaseCID, userPubKey);

            return res.status(200).json({
                status: "handshake_initiated",
                ...handshake
            });
        } catch (error) {
            console.error("[LeaseController] Error in handshake:", error);
            if (error.message.includes("Unauthorized")) {
                return res.status(403).json({ error: error.message });
            }
            return res.status(500).json({ error: "Internal server error during handshake retrieval.", details: error.message });
        }
    }
    /**
     * Retrieves all active leases from the database.
     * @route GET /api/leases/active
     */
    async getActiveLeases(req, res) {
        try {
            // Retrieve the database from app locals (injected in index.js)
            const database = req.app.locals.database;
            if (!database) {
                console.warn("[LeaseController] Database not found in app.locals.");
                return res.status(500).json({ error: "Database service unavailable." });
            }

            const allLeases = await database.listLeases();
            const activeLeases = allLeases.filter(lease => lease.status === 'active' || lease.status === 'ACTIVE');

            console.log(`[LeaseController] Found ${activeLeases.length} active leases.`);

            return res.status(200).json({
                status: 'success',
                message: 'Active leases retrieved successfully.',
                data: activeLeases
            });
        } catch (error) {
            console.error('[LeaseController] Error fetching active leases:', error);
            return res.status(500).json({ error: 'Internal server error while retrieving active leases.', details: error.message });
        }
    }

    /**
     * Get lease status, checking Redis cache first.
     * @route GET /api/leases/:leaseId/status
     */
    async getLeaseStatus(req, res) {
        try {
            const { leaseId } = req.params;
            const cacheService = req.app.locals.leaseCacheService;

            if (!cacheService) {
                console.warn("[LeaseController] LeaseCacheService not found in app.locals.");
                // Fallback to DB
                const database = req.app.locals.database;
                const lease = database.getLeaseById(leaseId);
                return res.status(200).json({ success: true, data: lease });
            }

            const status = await cacheService.getLeaseStatus(leaseId);
            if (!status) {
                return res.status(404).json({ success: false, error: 'Lease not found' });
            }

            return res.status(200).json({
                success: true,
                data: status
            });
        } catch (error) {
            console.error('[LeaseController] Error fetching lease status:', error);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }
    }
}

module.exports = new LeaseController();
