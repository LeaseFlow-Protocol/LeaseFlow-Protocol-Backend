const express = require('express');
const router = express.Router();
const InvitationService = require('../services/InvitationService');

/**
 * @openapi
 * /api/v1/leases/{id}/invites:
 *   post:
 *     summary: Invite co-signers to a fractional lease
 *     tags: [Invitations]
 */
router.post('/:id/invites', async (req, res) => {
    try {
        const { id } = req.params;
        const { invitees } = req.body; // Array of { identifier, share }
        const actor = req.actor;

        if (!actor) return res.status(401).json({ error: "Unauthorized" });
        
        const results = await InvitationService.createInvitations(id, actor.id, invitees);
        return res.status(201).json({ status: 'success', data: results });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * @openapi
 * /api/v1/invites/accept:
 *   post:
 *     summary: Accept a co-signer invitation
 *     tags: [Invitations]
 */
router.post('/accept', async (req, res) => {
    try {
        const { token, pubkey } = req.body;
        const result = await InvitationService.acceptInvitation(token, pubkey);
        return res.status(200).json(result);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
});

module.exports = router;
