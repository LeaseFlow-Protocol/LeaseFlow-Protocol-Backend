/**
 * RentPaymentTrackerService
 *
 * Monitors the Stellar Horizon API for `payment` operations directed at the
 * LeaseFlow contract account. When a new payment is detected it is recorded
 * in the `payment_history` table and the parent lease `payment_status` is
 * updated accordingly — giving landlords a "Stripe-like" real-time view of
 * tenant rent payments.
 */

const axios = require('axios');

const HORIZON_BASE_URL =
  process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';

/** How many operations to fetch per Horizon page (max 200). */
const PAGE_LIMIT = 200;

class RentPaymentTrackerService {
  /**
   * @param {import('../src/db/appDatabase').AppDatabase} database
   * @param {import('../src/services/sorobanLeaseService').SorobanLeaseService} sorobanService
   * @param {{contractAccountId?: string}} [options]
   */
  constructor(database, sorobanService, options = {}) {
    this.database = database;
    this.sorobanService = sorobanService;
    /** The Stellar account (contract or landlord escrow) to watch. */
    this.contractAccountId =
      options.contractAccountId ||
      process.env.SOROBAN_CONTRACT_ID ||
      process.env.CONTRACT_ID ||
      'CAEGD57WVTVQSYWYB23AISBW334QO7WNA5XQ56S45GH6BP3D2AVHKUG4';

    /**
     * Horizon paging_token of the last successfully processed operation.
     * Stored in-memory so each poll only fetches genuinely new operations
     * instead of re-fetching (and skipping) the same page every minute.
     * @type {string|null}
     */
    this._lastPagingToken = null;
  }

  /**
   * Poll Horizon for new payments made TO the contract account.
   * Cursor-based — only fetches operations newer than the last poll.
   * Idempotent — repeated calls do not create duplicate records.
   *
   * @returns {Promise<{processed: number, skipped: number, errors: Array<{id: string, message: string}>}>}
   */
  async poll() {
    const result = { processed: 0, skipped: 0, errors: [] };

    // Use ascending order + cursor so we only get operations we haven't seen yet.
    let url =
      `${HORIZON_BASE_URL}/accounts/${encodeURIComponent(this.contractAccountId)}` +
      `/payments?limit=${PAGE_LIMIT}&order=asc&include_failed=false`;

    if (this._lastPagingToken) {
      url += `&cursor=${encodeURIComponent(this._lastPagingToken)}`;
    }

    const response = await this._fetchHorizon(url);
    const records = response?._embedded?.records ?? [];

    let lastToken = null;
    for (const op of records) {
      try {
        const outcome = await this._processPaymentOperation(op);
        if (outcome === 'recorded') {
          result.processed += 1;
        } else {
          result.skipped += 1;
        }
      } catch (err) {
        result.errors.push({ id: op.id, message: err.message });
      }
      // Always advance the cursor, even for skipped ops, so we never
      // re-scan the same page on the next poll.
      if (op.paging_token) {
        lastToken = op.paging_token;
      }
    }

    if (lastToken) {
      this._lastPagingToken = lastToken;
    }

    return result;
  }

  /**
   * Process a single Horizon payment operation record.
   *
   * @param {object} op  Horizon payment operation object.
   * @returns {Promise<'recorded'|'skipped'>}
   */
  async _processPaymentOperation(op) {
    // We only care about incoming credit operations (payment / path_payment).
    if (!['payment', 'path_payment_strict_send', 'path_payment_strict_receive'].includes(op.type)) {
      return 'skipped';
    }

    // The payment must be directed *to* the contract account.
    if (op.to !== this.contractAccountId) {
      return 'skipped';
    }

    // Deduplicate — skip if this Horizon operation id is already recorded.
    if (this.database.getPaymentByHorizonOpId(op.id)) {
      return 'skipped';
    }

    // Try to resolve the lease by matching the sender (tenant Stellar account).
    const tenantAccountId = op.from;
    const lease = this.database.getActiveLeaseByTenantAccount(tenantAccountId);

    const leaseId = lease?.id ?? null;

    const payment = {
      horizonOperationId: op.id,
      leaseId,
      tenantAccountId,
      amount: op.amount,
      assetCode: op.asset_code || 'XLM',
      assetIssuer: op.asset_issuer || null,
      transactionHash: op.transaction_hash,
      paidAt: op.created_at,
    };

    this.database.insertPayment(payment);

    // Update the lease payment status if we matched a lease.
    if (leaseId) {
      const expectedRent = parseFloat(lease.rent_amount) || 0;
      const paidAmount = parseFloat(op.amount);
      const previousBalance = parseFloat(lease.remaining_balance) || 0;
      
      const totalDue = expectedRent + previousBalance;
      
      if (paidAmount < totalDue) {
        const remainingBalance = totalDue - paidAmount;
        const lateFeePercentage = 0.05; // 5% late fee on unpaid portion
        const appliedLateFee = remainingBalance * lateFeePercentage;
        
        this.database.updateLeasePaymentStatus(leaseId, 'partial', op.created_at);
        if (this.database.updateLeaseBalance) {
          this.database.updateLeaseBalance(leaseId, remainingBalance, appliedLateFee);
        }
        console.warn(`[Debt Alert] Lease ${leaseId} partially paid. Remaining: ${remainingBalance}, Late Fee: ${appliedLateFee}`);
      } else {
        this.database.updateLeasePaymentStatus(leaseId, 'paid', op.created_at);
        if (this.database.updateLeaseBalance) {
          this.database.updateLeaseBalance(leaseId, 0, 0);
        }
      }

      // Handle Purchase Option (Equity Earned)
      if (lease.purchaseOptionEnabled && lease.purchaseOptionRentShare > 0) {
        const equityEarned = paidAmount * lease.purchaseOptionRentShare;
        const newPurchaseCredit = (lease.purchaseCredit || 0) + equityEarned;
        
        console.log(`[Purchase Option] Lease ${leaseId}: Earned ${equityEarned} equity. New balance: ${newPurchaseCredit}`);
        
        if (this.database.updatePurchaseCredit) {
          this.database.updatePurchaseCredit(leaseId, newPurchaseCredit);
        }

        // Sync with Soroban contract
        if (this.sorobanService && this.sorobanService.updatePurchaseCredit) {
          try {
            this.sorobanService.updatePurchaseCredit({
              leaseId,
              tenantId: lease.tenantId,
              purchaseCredit: newPurchaseCredit,
            });
          } catch (err) {
            console.error(`[Soroban Error] Failed to update purchase credit for lease ${leaseId}:`, err.message);
          }
        }
      }
    }

    return 'recorded';
  }

  /**
   * Fetch a URL from Horizon and return parsed JSON.
   *
   * @param {string} url
   * @returns {Promise<object>}
   */
  async _fetchHorizon(url) {
    const response = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 10_000,
    });
    return response.data;
  }
}

module.exports = { RentPaymentTrackerService };
