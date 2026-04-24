const crypto = require('crypto');
const DatabaseService = require('./databaseService');
const logger = require('./loggerService');
const nodemailer = require('nodemailer');

class InvitationService {
    constructor() {
        this.db = new DatabaseService();
        this.isInitialized = false;
        // Mock email transporter
        this.transporter = nodemailer.createTransport({
            jsonTransport: true // Logs emails as JSON for debugging
        });
    }

    async initialize() {
        if (!this.isInitialized) {
            await this.db.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Creates invitations for co-signers.
     */
    async createInvitations(leaseId, inviterId, invitees) {
        await this.initialize();
        
        const results = [];
        for (const invitee of invitees) {
            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 day expiry

            const query = `
                INSERT INTO lease_invitations (
                    lease_id, inviter_id, invitee_identifier, token, percentage_share, expires_at
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *;
            `;

            const result = await this.db.pool.query(query, [
                leaseId, inviterId, invitee.identifier, token, invitee.share || 0, expiresAt
            ]);
            
            const invitation = result.rows[0];
            results.push(invitation);

            // Trigger Email Dispatch
            if (invitee.identifier.includes('@')) {
                await this.sendInvitationEmail(invitee.identifier, leaseId, token);
            }
        }

        return results;
    }

    async sendInvitationEmail(email, leaseId, token) {
        const inviteLink = `https://leaseflow.io/invites/accept?token=${token}`;
        const mailOptions = {
            from: '"LeaseFlow Protocol" <no-reply@leaseflow.io>',
            to: email,
            subject: 'Action Required: Co-sign invitation for LeaseFlow Asset',
            text: `You have been asked to co-sign a lease for Asset ${leaseId}. Click here to join: ${inviteLink}`,
            html: `<p>You have been asked to co-sign a lease for Asset <b>${leaseId}</b>.</p><a href="${inviteLink}">Sign and Submit Deposit</a>`
        };

        try {
            await this.transporter.sendMail(mailOptions);
            logger.info(`Invitation email sent to ${email}`);
        } catch (error) {
            logger.error(`Failed to send invitation email to ${email}:`, error);
        }
    }

    /**
     * Accepts an invitation and updates real-time funding status.
     */
    async acceptInvitation(token, pubkey) {
        await this.initialize();

        const query = `
            SELECT * FROM lease_invitations WHERE token = $1 AND status = 'PENDING' AND expires_at > NOW();
        `;
        const result = await this.db.pool.query(query, [token]);
        const invitation = result.rows[0];

        if (!invitation) {
            throw new Error('Invitation is invalid, expired, or already accepted.');
        }

        // Update status
        await this.db.pool.query(
            "UPDATE lease_invitations SET status = 'ACCEPTED', updated_at = NOW() WHERE id = $1",
            [invitation.id]
        );

        // Calculate total funding status for the lease
        const fundingQuery = `
            SELECT SUM(percentage_share) as total_committed
            FROM lease_invitations
            WHERE lease_id = $1 AND status = 'ACCEPTED';
        `;
        const fundingResult = await this.db.pool.query(fundingQuery, [invitation.lease_id]);
        const totalCommitted = parseInt(fundingResult.rows[0].total_committed || 0);

        // WebSocket Broadcast (Mock)
        this.broadcastFundingUpdate(invitation.lease_id, totalCommitted);

        return {
            success: true,
            leaseId: invitation.lease_id,
            totalCommitted,
            isFullyFunded: totalCommitted >= 100
        };
    }

    broadcastFundingUpdate(leaseId, totalCommitted) {
        logger.info(`[WebSocket] Broadcast: Lease ${leaseId} is now ${totalCommitted}% funded.`);
        // In real app: io.to(`lease_${leaseId}`).emit('funding_update', { totalCommitted });
    }
}

module.exports = new InvitationService();
