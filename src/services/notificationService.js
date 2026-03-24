/**
 * Notification persistence service for renewal proposals.
 */
class NotificationService {
  /**
   * @param {import('../db/appDatabase').AppDatabase} database Database wrapper.
   */
  constructor(database) {
    this.database = database;
  }

  /**
   * Create proposal notifications for both landlord and tenant.
   *
   * @param {{proposal: object}} input Proposal data.
   * @returns {void}
   */
  notifyProposalGenerated(input) {
    const { proposal } = input;
    const createdAt = proposal.createdAt;
    const message = `Renewal proposal available for lease ${proposal.leaseId}. Proposed rent: ${proposal.proposedTerms.rentAmount}.`;

    this.database.insertNotification({
      recipientId: proposal.landlordId,
      recipientRole: 'landlord',
      type: 'renewal_proposal_generated',
      leaseId: proposal.leaseId,
      proposalId: proposal.id,
      message,
      createdAt,
    });

    this.database.insertNotification({
      recipientId: proposal.tenantId,
      recipientRole: 'tenant',
      type: 'renewal_proposal_generated',
      leaseId: proposal.leaseId,
      proposalId: proposal.id,
      message,
      createdAt,
    });
  }
}

module.exports = {
  NotificationService,
};
