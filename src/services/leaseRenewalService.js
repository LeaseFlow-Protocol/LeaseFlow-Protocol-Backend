/**
 * Renewal proposal state constants.
 */
const STATUS = {
  generated: 'generated',
  landlordAccepted: 'landlord_accepted',
  tenantAccepted: 'tenant_accepted',
  fullyAccepted: 'fully_accepted',
  contractPrepared: 'contract_prepared',
  rejected: 'rejected',
  expired: 'expired',
};

/**
 * Service responsible for lease renewal proposal generation and agreement flow.
 */
class LeaseRenewalService {
  /**
   * @param {import('../db/appDatabase').AppDatabase} database Database wrapper.
   * @param {import('./notificationService').NotificationService} notificationService Notification service.
   * @param {import('./sorobanLeaseService').SorobanLeaseService} sorobanLeaseService Soroban service.
   * @param {{jobs: {scanWindowDays: number}}} config Runtime config.
   */
  constructor(database, notificationService, sorobanLeaseService, config) {
    this.database = database;
    this.notificationService = notificationService;
    this.sorobanLeaseService = sorobanLeaseService;
    this.config = config;
  }

  /**
   * Scan active leases and generate renewal proposals for eligible leases.
   *
   * @param {{asOfDate?: string}} [input={}] Scan options.
   * @returns {{generated: number, skipped: number, errors: Array<{leaseId: string, message: string}>}}
   */
  scanAndGenerate(input = {}) {
    const asOfDate = normalizeDate(input.asOfDate || new Date().toISOString().slice(0, 10));
    const result = { generated: 0, skipped: 0, errors: [] };

    for (const lease of this.database.listLeases()) {
      try {
        const proposal = this.generateProposalForLease({ lease, asOfDate });

        if (proposal) {
          result.generated += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.errors.push({ leaseId: lease.id, message: error.message });
      }
    }

    return result;
  }

  /**
   * Generate a proposal for a single eligible lease.
   *
   * @param {{lease: object, asOfDate: string}} input Generation input.
   * @returns {object|null}
   */
  generateProposalForLease(input) {
    const { lease, asOfDate } = input;

    if (!isEligibleLease(lease)) {
      return null;
    }

    const rule = this.database.getRenewalRuleByLandlordId(lease.landlordId);

    if (!rule || !rule.enabled) {
      return null;
    }

    const daysUntilExpiry = differenceInDays(asOfDate, lease.endDate);
    const lowerBound = Math.max(0, rule.noticeDays - this.config.jobs.scanWindowDays);

    if (daysUntilExpiry > rule.noticeDays || daysUntilExpiry < lowerBound) {
      return null;
    }

    const targetStartDate = addDays(lease.endDate, 1);
    const existingProposal = this.database.getProposalByLeaseCycle(lease.id, targetStartDate);

    if (existingProposal) {
      return null;
    }

    const proposal = this.database.transaction(() => {
      const now = new Date().toISOString();
      const proposedTerms = applyRenewalRule(lease, rule, targetStartDate);
      const created = this.database.insertRenewalProposal({
        leaseId: lease.id,
        landlordId: lease.landlordId,
        tenantId: lease.tenantId,
        targetStartDate: proposedTerms.startDate,
        targetEndDate: proposedTerms.endDate,
        currentTermsSnapshot: {
          rentAmount: lease.rentAmount,
          currency: lease.currency,
          startDate: lease.startDate,
          endDate: lease.endDate,
        },
        proposedTerms,
        ruleApplied: {
          increaseType: rule.increaseType,
          increaseValue: rule.increaseValue,
          termMonths: rule.termMonths,
          noticeDays: rule.noticeDays,
        },
        status: STATUS.generated,
        createdAt: now,
        updatedAt: now,
        expiresAt: lease.endDate,
        sorobanContractStatus: 'not_started',
      });

      this.notificationService.notifyProposalGenerated({ proposal: created });
      return created;
    });

    return proposal;
  }

  /**
   * Return a proposal for an authorized lease participant.
   *
   * @param {{proposalId: string, actorId: string, actorRole: string}} input Lookup input.
   * @returns {object}
   */
  getProposalForActor(input) {
    const proposal = this.database.getRenewalProposalById(input.proposalId);

    if (!proposal) {
      throw createError(404, 'Renewal proposal not found');
    }

    assertActorOwnsProposal(proposal, input.actorId, input.actorRole);
    return proposal;
  }

  /**
   * Accept a proposal on behalf of the authorized landlord or tenant.
   *
   * @param {{proposalId: string, actorId: string, actorRole: 'landlord'|'tenant'}} input Acceptance input.
   * @returns {{proposal: object, warning?: string}}
   */
  acceptProposal(input) {
    return this.database.transaction(() => {
      const proposal = this.database.getRenewalProposalById(input.proposalId);

      if (!proposal) {
        throw createError(404, 'Renewal proposal not found');
      }

      assertActorOwnsProposal(proposal, input.actorId, input.actorRole);
      assertProposalAcceptable(proposal);

      const now = new Date().toISOString();
      const updated = { ...proposal, updatedAt: now };

      if (input.actorRole === 'landlord') {
        if (updated.landlordAcceptedAt) {
          throw createError(400, 'Landlord already accepted this proposal');
        }

        updated.landlordAcceptedAt = now;
        updated.status = updated.tenantAcceptedAt ? STATUS.fullyAccepted : STATUS.landlordAccepted;
      } else {
        if (updated.tenantAcceptedAt) {
          throw createError(400, 'Tenant already accepted this proposal');
        }

        updated.tenantAcceptedAt = now;
        updated.status = updated.landlordAcceptedAt ? STATUS.fullyAccepted : STATUS.tenantAccepted;
      }

      let warning;

      if (updated.landlordAcceptedAt && updated.tenantAcceptedAt) {
        try {
          updated.sorobanContractReference = this.sorobanLeaseService.prepareRenewalContract({
            proposal: updated,
          });
          updated.sorobanContractStatus = 'prepared';
          updated.status = STATUS.contractPrepared;
        } catch (error) {
          updated.sorobanContractStatus = 'failed';
          updated.status = STATUS.fullyAccepted;
          warning = 'Proposal fully accepted, but Soroban contract preparation failed';
        }
      }

      const persisted = this.database.updateRenewalProposal(updated);
      return warning ? { proposal: persisted, warning } : { proposal: persisted };
    });
  }

  /**
   * Reject a proposal on behalf of the authorized landlord or tenant.
   *
   * @param {{proposalId: string, actorId: string, actorRole: 'landlord'|'tenant'}} input Rejection input.
   * @returns {object}
   */
  rejectProposal(input) {
    return this.database.transaction(() => {
      const proposal = this.database.getRenewalProposalById(input.proposalId);

      if (!proposal) {
        throw createError(404, 'Renewal proposal not found');
      }

      assertActorOwnsProposal(proposal, input.actorId, input.actorRole);
      assertProposalRejectable(proposal);

      return this.database.updateRenewalProposal({
        ...proposal,
        status: STATUS.rejected,
        rejectedBy: input.actorRole,
        updatedAt: new Date().toISOString(),
      });
    });
  }
}

/**
 * Determine whether a lease is even eligible for renewal scanning.
 *
 * @param {object} lease Lease record.
 * @returns {boolean}
 */
function isEligibleLease(lease) {
  return lease.status === 'active' && lease.renewable && !lease.disputed;
}

/**
 * Apply a landlord renewal rule to current lease terms.
 *
 * @param {object} lease Lease record.
 * @param {object} rule Renewal rule.
 * @param {string} targetStartDate Proposed start date.
 * @returns {{rentAmount: number, currency: string, startDate: string, endDate: string, termMonths: number}}
 */
function applyRenewalRule(lease, rule, targetStartDate) {
  let rentAmount = lease.rentAmount;

  if (rule.increaseType === 'percentage') {
    rentAmount = Math.round(lease.rentAmount * (1 + rule.increaseValue / 100));
  } else if (rule.increaseType === 'fixed') {
    rentAmount = lease.rentAmount + Math.round(rule.increaseValue);
  } else if (rule.increaseType !== 'same') {
    throw createError(400, `Unsupported renewal rule type: ${rule.increaseType}`);
  }

  return {
    rentAmount,
    currency: lease.currency,
    startDate: targetStartDate,
    endDate: calculateRenewalEndDate(targetStartDate, rule.termMonths),
    termMonths: rule.termMonths,
  };
}

/**
 * Calculate the end date for a renewed lease term.
 *
 * @param {string} startDate Renewal start date.
 * @param {number} termMonths Lease term months.
 * @returns {string}
 */
function calculateRenewalEndDate(startDate, termMonths) {
  const start = dateFromYmd(startDate);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + termMonths, start.getUTCDate() - 1));
  return formatDate(end);
}

/**
 * Ensure the current actor is one of the proposal participants.
 *
 * @param {object} proposal Proposal record.
 * @param {string} actorId Actor identifier.
 * @param {string} actorRole Actor role.
 * @returns {void}
 */
function assertActorOwnsProposal(proposal, actorId, actorRole) {
  const ownsProposal =
    (actorRole === 'landlord' && proposal.landlordId === actorId) ||
    (actorRole === 'tenant' && proposal.tenantId === actorId);

  if (!ownsProposal) {
    throw createError(403, 'You are not authorized to act on this proposal');
  }
}

/**
 * Validate that a proposal can still be accepted.
 *
 * @param {object} proposal Proposal record.
 * @returns {void}
 */
function assertProposalAcceptable(proposal) {
  if ([STATUS.rejected, STATUS.expired, STATUS.contractPrepared].includes(proposal.status)) {
    throw createError(400, 'Proposal can no longer be accepted');
  }

  if (proposal.expiresAt < formatDate(new Date())) {
    throw createError(400, 'Proposal has expired');
  }
}

/**
 * Validate that a proposal can still be rejected.
 *
 * @param {object} proposal Proposal record.
 * @returns {void}
 */
function assertProposalRejectable(proposal) {
  if ([STATUS.rejected, STATUS.expired, STATUS.contractPrepared].includes(proposal.status)) {
    throw createError(400, 'Proposal can no longer be rejected');
  }
}

/**
 * Create a typed request error.
 *
 * @param {number} statusCode HTTP status code.
 * @param {string} message Error message.
 * @returns {Error & {statusCode: number}}
 */
function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * Return the day difference between two UTC dates.
 *
 * @param {string} fromDate Inclusive source date.
 * @param {string} toDate Target date.
 * @returns {number}
 */
function differenceInDays(fromDate, toDate) {
  const start = dateFromYmd(fromDate);
  const end = dateFromYmd(toDate);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

/**
 * Add a number of days to a date string.
 *
 * @param {string} dateValue Source date.
 * @param {number} days Days to add.
 * @returns {string}
 */
function addDays(dateValue, days) {
  const date = dateFromYmd(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

/**
 * Normalize a date string to `YYYY-MM-DD`.
 *
 * @param {string} dateValue Input date.
 * @returns {string}
 */
function normalizeDate(dateValue) {
  return formatDate(dateFromYmd(dateValue));
}

/**
 * Parse a `YYYY-MM-DD` date value in UTC.
 *
 * @param {string} dateValue Input date.
 * @returns {Date}
 */
function dateFromYmd(dateValue) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

/**
 * Format a UTC date as `YYYY-MM-DD`.
 *
 * @param {Date} date Date to format.
 * @returns {string}
 */
function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

module.exports = {
  LeaseRenewalService,
  STATUS,
  applyRenewalRule,
  calculateRenewalEndDate,
  differenceInDays,
};
