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
      recipientRole: "landlord",
      type: "renewal_proposal_generated",
      leaseId: proposal.leaseId,
      proposalId: proposal.id,
      message,
      createdAt,
    });

    this.database.insertNotification({
      recipientId: proposal.tenantId,
      recipientRole: "tenant",
      type: "renewal_proposal_generated",
      leaseId: proposal.leaseId,
      proposalId: proposal.id,
      message,
      createdAt,
    });
  }

  /**
   * Notify a tenant that a late fee has been assessed.
   *
   * @param {{lease: object, payment: object, feeAmount: number, totalDebt: number, daysLate: number}} input
   * @returns {void}
   */
  notifyLateFeeAssessed(input) {
    const { lease, payment, feeAmount, totalDebt, daysLate } = input;
    const message = `Late fee assessed for lease ${lease.id}: ${feeAmount} (${daysLate} day(s) late). Total pending debt: ${totalDebt}.`;

    this.database.insertNotification({
      recipientId: lease.tenantId,
      recipientRole: "tenant",
      type: "late_fee_assessed",
      leaseId: lease.id,
      proposalId: payment.id,
      message,
      createdAt: new Date().toISOString(),
    });

    this.database.insertNotification({
      recipientId: lease.landlordId,
      recipientRole: "landlord",
      type: "late_fee_assessed",
      leaseId: lease.id,
      proposalId: payment.id,
      message,
      createdAt: new Date().toISOString(),
    });
  }
}

module.exports = {
  NotificationService,
};
