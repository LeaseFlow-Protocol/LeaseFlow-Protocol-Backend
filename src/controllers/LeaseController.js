const LeaseStorage = require('../services/Encrypted_IPFS_Lease_Storage');

class LeaseController {
    /**
     * Uploads the PDF lease agreement to IPFS after encryption.
     */
    async uploadLease(req, res) {
        try {
            const { tenantPubKey, landlordPubKey } = req.body;
            if (!req.file || !tenantPubKey || !landlordPubKey) {
                return res.status(400).json({ error: "Missing required fields (file, tenantPubKey, landlordPubKey)." });
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
                message: "Lease record created and uploaded to IPFS.",
                leaseCID 
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
}

module.exports = new LeaseController();
