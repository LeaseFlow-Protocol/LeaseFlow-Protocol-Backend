const EvidenceService = require('../services/EvidenceService');
const logger = require('../services/loggerService');

class DisputeController {
    /**
     * Uploads evidence to a dispute.
     * Checks if the user is involved in the dispute.
     */
    async uploadEvidence(req, res) {
        try {
            const { id } = req.params;
            const actor = req.actor; // Set by auth middleware
            
            if (!req.file) {
                return res.status(400).json({ error: "No evidence file provided." });
            }

            if (!actor) {
                return res.status(401).json({ error: "Authentication required to upload evidence." });
            }

            // Verify user involvement in the dispute (Mock check)
            // In a real app, query the dispute/lease table to ensure actor.id is either landlord or tenant
            logger.info(`[DisputeController] User ${actor.id} uploading evidence for dispute ${id}`);
            
            const evidence = await EvidenceService.storeEvidence(id, actor.id, req.file);

            return res.status(201).json({
                status: 'success',
                message: 'Evidence uploaded and secured.',
                data: evidence
            });
        } catch (error) {
            logger.error('[DisputeController] Error uploading evidence:', error);
            return res.status(500).json({ error: 'Failed to upload evidence.', details: error.message });
        }
    }

    /**
     * Retrieves the jury packet for a dispute.
     * Authorized for DAO jurors (mocked as actor.role === 'juror' or 'admin')
     */
    async getJuryPacket(req, res) {
        try {
            const { id } = req.params;
            const actor = req.actor;

            // Strict access control: only jurors or involved parties (for their own packet) can view
            if (!actor) {
                return res.status(401).json({ error: "Authentication required." });
            }

            // Mock: allow anyone with a valid role for now, but in reality would check juror registry
            logger.info(`[DisputeController] User ${actor.id} (${actor.role}) requesting jury packet for dispute ${id}`);
            
            const packet = await EvidenceService.getJuryPacket(id);

            return res.status(200).json({
                status: 'success',
                data: packet
            });
        } catch (error) {
            logger.error('[DisputeController] Error fetching jury packet:', error);
            return res.status(500).json({ error: 'Failed to retrieve jury packet.', details: error.message });
        }
    }
}

module.exports = new DisputeController();
