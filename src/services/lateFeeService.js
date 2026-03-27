const crypto = require("crypto");

/**
 * Service responsible for assessing late fees on overdue rent payments
 * and submitting pending_debt updates to Soroban.
 */
class LateFeeService {
  /**
   * @param {import('../db/appDatabase').AppDatabase} database
   * @param {import('./notificationService').NotificationService} notificationService
   * @param {import('./sorobanLeaseService').SorobanLeaseService} sorobanLeaseService
   */
  constructor(database, notificationService, sorobanLeaseService) {
    this.database = database;
    this.notificationService = notificationService;
    this.sorobanLeaseService = sorobanLeaseService;
  }

  /**
   * Run the daily late fee assessment for all active leases with overdue payments.
   *
   * @param {{asOfDate?: string}} [input={}]
   * @returns {{assessed: number, skipped: number, errors: Array<{leaseId: string, message: string}>}}
   */
  assessLateFees(input = {}) {
    const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);
    const result = { assessed: 0, skipped: 0, errors: [] };

    const overduePayments = this.database.listOverdueRentPayments(asOfDate);

    for (const payment of overduePayments) {
      try {
        const entry = this.assessFeeForPayment({ payment, asOfDate });
        if (entry) {
          result.assessed += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        result.errors.push({
          leaseId: payment.leaseId,
          message: error.message,
        });
      }
    }

    return result;
  }

  /**
   * Assess the late fee for a single overdue rent payment.
   *
   * @param {{payment: object, asOfDate: string}} input
   * @returns {object|null} The late fee ledger entry, or null if skipped.
   */
  assessFeeForPayment(input) {
    const { payment, asOfDate } = input;

    const terms = this.database.getLateFeeTermsByLeaseId(payment.leaseId);
    if (!terms || !terms.enabled) {
      return null;
    }

    const dueDate = new Date(`${payment.dueDate}T00:00:00.000Z`);
    const currentDate = new Date(`${asOfDate}T00:00:00.000Z`);
    const daysLate = Math.floor(
      (currentDate.getTime() - dueDate.getTime()) / 86400000,
    );

    if (daysLate <= 0) {
      return null;
    }

    // Check if a fee entry was already created for this exact day count
    const existingEntry = this.database.getLatestLateFeeForPayment(payment.id);
    if (existingEntry && existingEntry.daysLate >= daysLate) {
      return null;
    }

    const feeAmount = calculateFee(
      daysLate,
      terms.dailyRate,
      terms.maxFeePerPeriod,
    );

    // Subtract any previously assessed fee to get the incremental amount
    const previousFee = existingEntry ? existingEntry.feeAmount : 0;
    const incrementalFee = feeAmount - previousFee;

    if (incrementalFee <= 0) {
      return null;
    }

    const totalPendingDebt =
      this.database.getTotalPendingDebtForLease(payment.leaseId) +
      incrementalFee;

    const entry = this.database.insertLateFeeEntry({
      leaseId: payment.leaseId,
      rentPaymentId: payment.id,
      period: payment.period,
      daysLate,
      dailyRate: terms.dailyRate,
      feeAmount,
      pendingDebtTotal: totalPendingDebt,
      assessedAt: asOfDate,
    });

    // Attempt Soroban on-chain pending_debt update
    try {
      const txResult = this.sorobanLeaseService.updatePendingDebt({
        leaseId: payment.leaseId,
        tenantId: this.database.getLeaseById(payment.leaseId)?.tenantId,
        pendingDebt: totalPendingDebt,
        feeEntryId: entry.id,
      });
      this.database.updateLateFeeEntryTxStatus(
        entry.id,
        "confirmed",
        txResult.txHash,
      );
    } catch (error) {
      console.error(
        `[LateFeeService] Soroban tx failed for lease ${payment.leaseId}:`,
        error.message,
      );
      this.database.updateLateFeeEntryTxStatus(entry.id, "failed", null);
    }

    // Notify tenant
    const lease = this.database.getLeaseById(payment.leaseId);
    if (lease) {
      this.notificationService.notifyLateFeeAssessed({
        lease,
        payment,
        feeAmount: incrementalFee,
        totalDebt: totalPendingDebt,
        daysLate,
      });
    }

    return this.database.getLateFeeEntryById(entry.id);
  }

  /**
   * Get the late fee summary for a specific lease.
   *
   * @param {string} leaseId
   * @returns {{leaseId: string, totalPendingDebt: number, entries: object[]}}
   */
  getLeaseLateFees(leaseId) {
    const entries = this.database.listLateFeesByLeaseId(leaseId);
    const totalPendingDebt = this.database.getTotalPendingDebtForLease(leaseId);
    return { leaseId, totalPendingDebt, entries };
  }
}

/**
 * Calculate the total fee for a given number of days late.
 *
 * @param {number} daysLate
 * @param {number} dailyRate Rate in smallest currency unit (e.g., cents).
 * @param {number|null} maxFeePerPeriod Optional cap.
 * @returns {number}
 */
function calculateFee(daysLate, dailyRate, maxFeePerPeriod) {
  const fee = daysLate * dailyRate;
  if (maxFeePerPeriod != null && fee > maxFeePerPeriod) {
    return maxFeePerPeriod;
  }
  return fee;
}

module.exports = {
  LateFeeService,
  calculateFee,
};
