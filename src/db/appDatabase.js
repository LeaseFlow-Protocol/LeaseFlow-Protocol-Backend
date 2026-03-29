const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

/**
 * SQLite-backed persistence layer for leases and renewal proposals.
 */
class AppDatabase {
  /**
   * @param {string} filename SQLite filename or `:memory:`.
   */
  constructor(filename) {
    this.filename = filename;
    this.ensureDirectory();
    this.db = new DatabaseSync(filename);
    this.initializeSchema();
  }

  /**
   * Ensure the database directory exists for file-backed databases.
   *
   * @returns {void}
   */
  ensureDirectory() {
    if (this.filename === ":memory:") {
      return;
    }

    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
  }

  /**
   * Initialize application tables and indexes.
   *
   * @returns {void}
   */
  initializeSchema() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS leases (
        id TEXT PRIMARY KEY,
        landlord_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        status TEXT NOT NULL,
        rent_amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        renewable INTEGER NOT NULL DEFAULT 1,
        disputed INTEGER NOT NULL DEFAULT 0,
        tenant_account_id TEXT,
        payment_status TEXT NOT NULL DEFAULT 'pending',
        last_payment_at TEXT,
        landlord_stellar_address TEXT,
        tenant_stellar_address TEXT,
        sanctions_status TEXT DEFAULT 'CLEAN',
        sanctions_check_at TEXT,
        sanctions_violation_count INTEGER DEFAULT 0,
        city TEXT,
        state TEXT,
        country TEXT DEFAULT 'Nigeria',
        property_type TEXT,
        bedrooms INTEGER,
        bathrooms INTEGER,
        square_footage INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS landlord_renewal_rules (
        id TEXT PRIMARY KEY,
        landlord_id TEXT NOT NULL UNIQUE,
        increase_type TEXT NOT NULL,
        increase_value REAL NOT NULL DEFAULT 0,
        term_months INTEGER NOT NULL DEFAULT 12,
        notice_days INTEGER NOT NULL DEFAULT 60,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS renewal_proposals (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        landlord_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        target_start_date TEXT NOT NULL,
        target_end_date TEXT NOT NULL,
        current_terms_snapshot TEXT NOT NULL,
        proposed_terms TEXT NOT NULL,
        rule_applied TEXT NOT NULL,
        status TEXT NOT NULL,
        landlord_accepted_at TEXT,
        tenant_accepted_at TEXT,
        rejected_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        soroban_contract_status TEXT NOT NULL,
        soroban_contract_reference TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_renewal_proposals_lease_cycle
      ON renewal_proposals (lease_id, target_start_date);

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient_id TEXT NOT NULL,
        recipient_role TEXT NOT NULL,
        type TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_history (
        id               TEXT PRIMARY KEY,
        horizon_op_id    TEXT NOT NULL UNIQUE,
        lease_id         TEXT,
        tenant_account_id TEXT NOT NULL,
        amount           TEXT NOT NULL,
        asset_code       TEXT NOT NULL DEFAULT 'XLM',
        asset_issuer     TEXT,
        transaction_hash TEXT NOT NULL,
        paid_at          TEXT NOT NULL,
        recorded_at      TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_payment_history_lease_id
        ON payment_history (lease_id);

      CREATE INDEX IF NOT EXISTS idx_payment_history_tenant_account
        ON payment_history (tenant_account_id);

      CREATE INDEX IF NOT EXISTS idx_payment_history_paid_at
        ON payment_history (paid_at);

      CREATE TABLE IF NOT EXISTS utility_bills (
        id                TEXT PRIMARY KEY,
        lease_id          TEXT NOT NULL,
        landlord_id       TEXT NOT NULL,
        bill_amount       REAL NOT NULL,
        tenant_share_amount REAL NOT NULL,
        currency          TEXT NOT NULL,
        billing_cycle     TEXT NOT NULL,
        created_at        TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_utility_bills_lease_cycle
        ON utility_bills (lease_id, billing_cycle);

      CREATE TABLE IF NOT EXISTS upcoming_payments (
        lease_id            TEXT PRIMARY KEY,
        base_rent_amount    REAL NOT NULL,
        utility_share_total REAL NOT NULL DEFAULT 0,
        upcoming_total      REAL NOT NULL,
        approval_status     TEXT NOT NULL DEFAULT 'pending',
        updated_at          TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS utility_bills (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        landlord_id TEXT NOT NULL,
        utility_type TEXT NOT NULL,
        total_amount INTEGER NOT NULL,
        tenant_share_amount INTEGER NOT NULL,
        billing_period_start TEXT,
        billing_period_end TEXT,
        next_rent_cycle_date TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_utility_bills_lease_cycle
        ON utility_bills (lease_id, next_rent_cycle_date);

      -- Sanctions-related indexes
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_lease_id ON sanctions_violations(lease_id);
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_address ON sanctions_violations(address);
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_status ON sanctions_violations(status);
      CREATE INDEX IF NOT EXISTS idx_lease_freeze_events_lease_id ON lease_freeze_events(lease_id);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_address ON sanctions_cache(address);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_source ON sanctions_cache(source);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_expires_at ON sanctions_cache(expires_at);

      CREATE TABLE IF NOT EXISTS maintenance_jobs (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        description TEXT NOT NULL,
        contractor_wallet TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS vendor_payment_authorizations (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        landlord_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'authorized',
        created_at TEXT NOT NULL,
        paid_at TEXT,
        FOREIGN KEY (lease_id) REFERENCES leases(id),
        FOREIGN KEY (job_id) REFERENCES maintenance_jobs(id)
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        company_name TEXT,
        license_number TEXT,
        specialties TEXT,
        kyc_status TEXT DEFAULT 'pending',
        stellar_account_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS maintenance_tickets (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        vendor_id TEXT,
        landlord_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'open',
        photos TEXT,
        repair_photos TEXT,
        notes TEXT,
        tenant_notes TEXT,
        opened_at TEXT,
        in_progress_at TEXT,
        resolved_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id),
        FOREIGN KEY (vendor_id) REFERENCES vendors(id)
      );

      CREATE TABLE IF NOT EXISTS vendor_access_grants (
        id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        maintenance_ticket_id TEXT,
        granted_by TEXT NOT NULL,
        access_type TEXT NOT NULL,
        permissions TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoke_reason TEXT,
        accessed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id),
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS vendor_access_logs (
        id TEXT PRIMARY KEY,
        access_grant_id TEXT NOT NULL,
        vendor_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_accessed TEXT,
        ip_address TEXT,
        user_agent TEXT,
        accessed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (access_grant_id) REFERENCES vendor_access_grants(id)
      );

      CREATE TABLE IF NOT EXISTS rent_payments (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        period TEXT NOT NULL,
        due_date TEXT NOT NULL,
        amount_due INTEGER NOT NULL,
        amount_paid INTEGER DEFAULT 0,
        protocol_fee INTEGER DEFAULT 0,
        date_paid TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS late_fee_terms (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL UNIQUE,
        daily_rate REAL NOT NULL,
        grace_period_days INTEGER NOT NULL,
        max_fee_per_period REAL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS late_fee_ledger (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        rent_payment_id TEXT NOT NULL,
        period TEXT NOT NULL,
        days_late INTEGER NOT NULL,
        daily_rate REAL NOT NULL,
        fee_amount REAL NOT NULL,
        pending_debt_total REAL NOT NULL,
        soroban_tx_status TEXT,
        soroban_tx_hash TEXT,
        assessed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id),
        FOREIGN KEY (rent_payment_id) REFERENCES rent_payments(id)
      );

      CREATE TABLE IF NOT EXISTS payment_schedules (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );
    `);
  }

  /**
   * Run work inside a transaction.
   *
   * @template T
   * @param {() => T} callback Work to execute.
   * @returns {T}
   */
  transaction(callback) {
    this.db.exec("BEGIN");

    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Seed a lease record.
   *
   * @param {object} lease Lease data.
   * @returns {void}
   */
  seedLease(lease) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO leases (
          id, landlord_id, tenant_id, status, rent_amount, currency,
          start_date, end_date, renewable, disputed, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        lease.id,
        lease.landlordId,
        lease.tenantId,
        lease.status,
        lease.rentAmount,
        lease.currency,
        lease.startDate,
        lease.endDate,
        lease.renewable === false ? 0 : 1,
        lease.disputed === true ? 1 : 0,
        now,
        now,
      );
  }

  /**
   * Seed or replace landlord renewal rules.
   *
   * @param {object} rule Renewal rule data.
   * @returns {void}
   */
  seedRenewalRule(rule) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
        INSERT INTO landlord_renewal_rules (
          id, landlord_id, increase_type, increase_value, term_months, notice_days,
          enabled, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(landlord_id) DO UPDATE SET
          increase_type = excluded.increase_type,
          increase_value = excluded.increase_value,
          term_months = excluded.term_months,
          notice_days = excluded.notice_days,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        rule.id || crypto.randomUUID(),
        rule.landlordId,
        rule.increaseType,
        rule.increaseValue,
        rule.termMonths,
        rule.noticeDays,
        rule.enabled === false ? 0 : 1,
        now,
        now,
      );
  }

  /**
   * Return all leases.
   *
   * @returns {object[]}
   */
  listLeases() {
    return this.db
      .prepare(
        `
        SELECT
          id,
          landlord_id AS landlordId,
          tenant_id AS tenantId,
          status,
          rent_amount AS rentAmount,
          currency,
          start_date AS startDate,
          end_date AS endDate,
          renewable,
          disputed,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM leases
      `,
      )
      .all()
      .map(normalizeLeaseRow);
  }

  /**
   * Return a lease by identifier.
   *
   * @param {string} leaseId Lease identifier.
   * @returns {object|null}
   */
  getLeaseById(leaseId) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          landlord_id       AS landlordId,
          tenant_id         AS tenantId,
          status,
          rent_amount       AS rentAmount,
          currency,
          start_date        AS startDate,
          end_date          AS endDate,
          renewable,
          disputed,
          tenant_account_id AS tenantAccountId,
          payment_status    AS paymentStatus,
          last_payment_at   AS lastPaymentAt,
          created_at        AS createdAt,
          updated_at        AS updatedAt
        FROM leases
        WHERE id = ?
      `,
      )
      .get(leaseId);

    return row ? normalizeLeaseRow(row) : null;
  }

  /**
   * Fetch a landlord renewal rule.
   *
   * @param {string} landlordId Landlord identifier.
   * @returns {object|null}
   */
  getRenewalRuleByLandlordId(landlordId) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          landlord_id AS landlordId,
          increase_type AS increaseType,
          increase_value AS increaseValue,
          term_months AS termMonths,
          notice_days AS noticeDays,
          enabled,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM landlord_renewal_rules
        WHERE landlord_id = ?
      `,
      )
      .get(landlordId);

    return row ? normalizeRuleRow(row) : null;
  }

  /**
   * Insert a renewal proposal.
   *
   * @param {object} proposal Proposal payload.
   * @returns {object}
   */
  insertRenewalProposal(proposal) {
    const id = proposal.id || crypto.randomUUID();
    this.db
      .prepare(
        `
        INSERT INTO renewal_proposals (
          id, lease_id, landlord_id, tenant_id, target_start_date, target_end_date,
          current_terms_snapshot, proposed_terms, rule_applied, status,
          landlord_accepted_at, tenant_accepted_at, rejected_by, created_at,
          updated_at, expires_at, soroban_contract_status, soroban_contract_reference
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        proposal.leaseId,
        proposal.landlordId,
        proposal.tenantId,
        proposal.targetStartDate,
        proposal.targetEndDate,
        JSON.stringify(proposal.currentTermsSnapshot),
        JSON.stringify(proposal.proposedTerms),
        JSON.stringify(proposal.ruleApplied),
        proposal.status,
        proposal.landlordAcceptedAt || null,
        proposal.tenantAcceptedAt || null,
        proposal.rejectedBy || null,
        proposal.createdAt,
        proposal.updatedAt,
        proposal.expiresAt,
        proposal.sorobanContractStatus,
        proposal.sorobanContractReference
          ? JSON.stringify(proposal.sorobanContractReference)
          : null,
      );

    return this.getRenewalProposalById(id);
  }

  /**
   * Fetch a renewal proposal by id.
   *
   * @param {string} proposalId Proposal identifier.
   * @returns {object|null}
   */
  getRenewalProposalById(proposalId) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          lease_id AS leaseId,
          landlord_id AS landlordId,
          tenant_id AS tenantId,
          target_start_date AS targetStartDate,
          target_end_date AS targetEndDate,
          current_terms_snapshot AS currentTermsSnapshot,
          proposed_terms AS proposedTerms,
          rule_applied AS ruleApplied,
          status,
          landlord_accepted_at AS landlordAcceptedAt,
          tenant_accepted_at AS tenantAcceptedAt,
          rejected_by AS rejectedBy,
          created_at AS createdAt,
          updated_at AS updatedAt,
          expires_at AS expiresAt,
          soroban_contract_status AS sorobanContractStatus,
          soroban_contract_reference AS sorobanContractReference
        FROM renewal_proposals
        WHERE id = ?
      `,
      )
      .get(proposalId);

    return row ? normalizeProposalRow(row) : null;
  }

  /**
   * Find a proposal for the same lease renewal cycle.
   *
   * @param {string} leaseId Lease identifier.
   * @param {string} targetStartDate Renewal start date.
   * @returns {object|null}
   */
  getProposalByLeaseCycle(leaseId, targetStartDate) {
    const row = this.db
      .prepare(
        `
        SELECT
          id,
          lease_id AS leaseId,
          landlord_id AS landlordId,
          tenant_id AS tenantId,
          target_start_date AS targetStartDate,
          target_end_date AS targetEndDate,
          current_terms_snapshot AS currentTermsSnapshot,
          proposed_terms AS proposedTerms,
          rule_applied AS ruleApplied,
          status,
          landlord_accepted_at AS landlordAcceptedAt,
          tenant_accepted_at AS tenantAcceptedAt,
          rejected_by AS rejectedBy,
          created_at AS createdAt,
          updated_at AS updatedAt,
          expires_at AS expiresAt,
          soroban_contract_status AS sorobanContractStatus,
          soroban_contract_reference AS sorobanContractReference
        FROM renewal_proposals
        WHERE lease_id = ? AND target_start_date = ?
      `,
      )
      .get(leaseId, targetStartDate);

    return row ? normalizeProposalRow(row) : null;
  }

  /**
   * Update a renewal proposal state.
   *
   * @param {object} proposal Proposal payload.
   * @returns {object}
   */
  updateRenewalProposal(proposal) {
    this.db
      .prepare(
        `
        UPDATE renewal_proposals
        SET
          status = ?,
          landlord_accepted_at = ?,
          tenant_accepted_at = ?,
          rejected_by = ?,
          updated_at = ?,
          soroban_contract_status = ?,
          soroban_contract_reference = ?
        WHERE id = ?
      `,
      )
      .run(
        proposal.status,
        proposal.landlordAcceptedAt || null,
        proposal.tenantAcceptedAt || null,
        proposal.rejectedBy || null,
        proposal.updatedAt,
        proposal.sorobanContractStatus,
        proposal.sorobanContractReference
          ? JSON.stringify(proposal.sorobanContractReference)
          : null,
        proposal.id,
      );

    return this.getRenewalProposalById(proposal.id);
  }

  /**
   * Insert a notification record.
   *
   * @param {object} notification Notification payload.
   * @returns {void}
   */
  insertNotification(notification) {
    this.db
      .prepare(
        `
        INSERT INTO notifications (
          id, recipient_id, recipient_role, type, lease_id, proposal_id, message, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        notification.id || crypto.randomUUID(),
        notification.recipientId,
        notification.recipientRole,
        notification.type,
        notification.leaseId,
        notification.proposalId,
        notification.message,
        notification.createdAt,
      );
  }

  /**
   * List notifications for a proposal.
   *
   * @param {string} proposalId Proposal identifier.
   * @returns {object[]}
   */
  listNotificationsByProposalId(proposalId) {
    return this.db
      .prepare(
        `
        SELECT
          id,
          recipient_id AS recipientId,
          recipient_role AS recipientRole,
          type,
          lease_id AS leaseId,
          proposal_id AS proposalId,
          message,
          created_at AS createdAt
        FROM notifications
        WHERE proposal_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      )
      .all(proposalId);
  }

  /**
   * Record a landlord-uploaded utility bill and recalculate the tenant's
   * upcoming payment total for the specified rent cycle.
   *
   * @param {object} input Utility billing input.
   * @returns {{leaseId: string, tenantId: string, dueDate: string, rentAmount: number, utilityShareTotal: number, upcomingPaymentTotal: number, currency: string}}
   */
  recordUtilityBillAndReconcileUpcomingPayment(input) {
    return this.transaction(() => {
      const lease = this.getLeaseById(input.leaseId);
      if (!lease) {
        throw new Error('Lease not found');
      }

      if (lease.landlordId !== input.landlordId) {
        throw new Error('Landlord is not authorized for this lease');
      }

      const now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO utility_bills (
             id, lease_id, landlord_id, utility_type, total_amount,
             tenant_share_amount, billing_period_start, billing_period_end,
             next_rent_cycle_date, uploaded_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id || crypto.randomUUID(),
          input.leaseId,
          input.landlordId,
          input.utilityType,
          input.totalAmount,
          input.tenantShareAmount,
          input.billingPeriodStart || null,
          input.billingPeriodEnd || null,
          input.nextRentCycleDate,
          now,
        );

      const utilityTotalsRow = this.db
        .prepare(
          `SELECT COALESCE(SUM(tenant_share_amount), 0) AS utilityShareTotal
           FROM utility_bills
           WHERE lease_id = ? AND next_rent_cycle_date = ?`,
        )
        .get(input.leaseId, input.nextRentCycleDate);

      const utilityShareTotal = Number(utilityTotalsRow?.utilityShareTotal || 0);
      const upcomingPaymentTotal = Number(lease.rentAmount) + utilityShareTotal;

      const existingSchedule = this.db
        .prepare(
          `SELECT id
           FROM payment_schedules
           WHERE lease_id = ? AND due_date = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(input.leaseId, input.nextRentCycleDate);

      if (existingSchedule?.id) {
        this.db
          .prepare(
            `UPDATE payment_schedules
             SET amount = ?,
                 currency = ?,
                 updated_at = ?
             WHERE id = ?`,
          )
          .run(String(upcomingPaymentTotal), lease.currency, now, existingSchedule.id);
      } else {
        this.db
          .prepare(
            `INSERT INTO payment_schedules (
               id, lease_id, amount, currency, due_date, status, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            crypto.randomUUID(),
            input.leaseId,
            String(upcomingPaymentTotal),
            lease.currency,
            input.nextRentCycleDate,
            'PENDING',
            now,
            now,
          );
      }

      return {
        leaseId: input.leaseId,
        tenantId: lease.tenantId,
        dueDate: input.nextRentCycleDate,
        rentAmount: Number(lease.rentAmount),
        utilityShareTotal,
        upcomingPaymentTotal,
        currency: lease.currency,
      };
    });
  }

  /**
   * Fetch upcoming payment totals for a tenant for a rent cycle that has
   * reached (or passed) its due date so frontend approval can be requested.
   *
   * @param {string} tenantId Tenant identifier.
   * @param {string} asOfDate ISO date string used as the rent-cycle trigger check.
   * @returns {object|null}
   */
  getUpcomingPaymentForTenantApproval(tenantId, asOfDate) {
    const row = this.db
      .prepare(
        `SELECT
           l.id AS leaseId,
           l.tenant_id AS tenantId,
           l.rent_amount AS rentAmount,
           l.currency AS currency,
           ps.due_date AS dueDate,
           ps.amount AS upcomingPaymentTotal,
           (
             SELECT COALESCE(SUM(ub.tenant_share_amount), 0)
             FROM utility_bills ub
             WHERE ub.lease_id = l.id AND ub.next_rent_cycle_date = ps.due_date
           ) AS utilityShareTotal
         FROM leases l
         INNER JOIN payment_schedules ps ON ps.lease_id = l.id
         WHERE l.tenant_id = ?
           AND ps.due_date <= ?
         ORDER BY ps.due_date DESC
         LIMIT 1`,
      )
      .get(tenantId, asOfDate);

    if (!row) {
      return null;
    }

    return {
      leaseId: row.leaseId,
      tenantId: row.tenantId,
      dueDate: row.dueDate,
      rentAmount: Number(row.rentAmount),
      utilityShareTotal: Number(row.utilityShareTotal || 0),
      upcomingPaymentTotal: Number(row.upcomingPaymentTotal || 0),
      currency: row.currency,
      approvalRequired: true,
    };
  }
  // ---------------------------------------------------------------------------
  // Payment history methods (Issue #16 — Real-Time Rent Payment Tracker)
  // ---------------------------------------------------------------------------

  /**
   * Persist a new payment event.
   *
   * @param {object} payment Payment data from Horizon.
   * @returns {object} The inserted payment record.
   */
  insertPayment(payment) {
    const id = payment.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO payment_history (
           id, horizon_op_id, lease_id, tenant_account_id,
           amount, asset_code, asset_issuer, transaction_hash,
           paid_at, recorded_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        payment.horizonOperationId,
        payment.leaseId ?? null,
        payment.tenantAccountId,
        String(payment.amount),
        payment.assetCode || "XLM",
        payment.assetIssuer ?? null,
        payment.transactionHash,
        payment.paidAt,
        now,
      );
    return this.getPaymentByHorizonOpId(payment.horizonOperationId);
  }

  /**
   * Fetch a payment record by Horizon operation ID (for deduplication).
   *
   * @param {string} horizonOpId Horizon operation identifier.
   * @returns {object|null}
   */
  getPaymentByHorizonOpId(horizonOpId) {
    const row = this.db
      .prepare(
        `SELECT
           id,
           horizon_op_id    AS horizonOpId,
           lease_id         AS leaseId,
           tenant_account_id AS tenantAccountId,
           amount,
           asset_code       AS assetCode,
           asset_issuer     AS assetIssuer,
           transaction_hash AS transactionHash,
           paid_at          AS paidAt,
           recorded_at      AS recordedAt
         FROM payment_history
         WHERE horizon_op_id = ?`,
      )
      .get(horizonOpId);

    return row ?? null;
  }

  /**
   * List all payments for a specific lease, most-recent first.
   *
   * @param {string} leaseId Lease identifier.
   * @returns {object[]}
   */
  listPaymentsByLeaseId(leaseId) {
    return this.db
      .prepare(
        `SELECT
           id,
           horizon_op_id    AS horizonOpId,
           lease_id         AS leaseId,
           tenant_account_id AS tenantAccountId,
           amount,
           asset_code       AS assetCode,
           asset_issuer     AS assetIssuer,
           transaction_hash AS transactionHash,
           paid_at          AS paidAt,
           recorded_at      AS recordedAt
         FROM payment_history
         WHERE lease_id = ?
         ORDER BY paid_at DESC`,
      )
      .all(leaseId);
  }

  // --- Late Fee Terms ---

  seedLateFeeTerms(terms) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO late_fee_terms (id, lease_id, daily_rate, grace_period_days, max_fee_per_period, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lease_id) DO UPDATE SET
           daily_rate = excluded.daily_rate,
           grace_period_days = excluded.grace_period_days,
           max_fee_per_period = excluded.max_fee_per_period,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(
        terms.id || crypto.randomUUID(),
        terms.leaseId,
        terms.dailyRate,
        terms.gracePeriodDays,
        terms.maxFeePerPeriod ?? null,
        terms.enabled === false ? 0 : 1,
        now,
        now,
      );
  }

  getLateFeeTermsByLeaseId(leaseId) {
    const row = this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, daily_rate AS dailyRate,
                grace_period_days AS gracePeriodDays, max_fee_per_period AS maxFeePerPeriod,
                enabled, created_at AS createdAt, updated_at AS updatedAt
         FROM late_fee_terms WHERE lease_id = ?`,
      )
      .get(leaseId);
    return row ? { ...row, enabled: Boolean(row.enabled) } : null;
  }

  // --- Rent Payments ---

  insertRentPayment(payment) {
    const id = payment.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO rent_payments (id, lease_id, period, due_date, amount_due, amount_paid, protocol_fee, date_paid, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        payment.leaseId,
        payment.period,
        payment.dueDate,
        payment.amountDue,
        payment.amountPaid || 0,
        payment.protocolFee || 0,
        payment.datePaid || null,
        payment.status || "pending",
        now,
        now,
      );
    return this.getRentPaymentById(id);
  }

  getRentPaymentById(paymentId) {
    const row = this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, period, due_date AS dueDate,
                amount_due AS amountDue, amount_paid AS amountPaid,
                protocol_fee AS protocolFee,
                date_paid AS datePaid, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM rent_payments WHERE id = ?`,
      )
      .get(paymentId);
    return row || null;
  }

  getRentPaymentByLeasePeriod(leaseId, period) {
    const row = this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, period, due_date AS dueDate,
                amount_due AS amountDue, amount_paid AS amountPaid,
                date_paid AS datePaid, status,
                created_at AS createdAt, updated_at AS updatedAt
         FROM rent_payments WHERE lease_id = ? AND period = ?`,
      )
      .get(leaseId, period);
    return row || null;
  }

  listOverdueRentPayments(asOfDate) {
    return this.db
      .prepare(
        `SELECT rp.id, rp.lease_id AS leaseId, rp.period, rp.due_date AS dueDate,
                rp.amount_due AS amountDue, rp.amount_paid AS amountPaid,
                rp.date_paid AS datePaid, rp.status,
                rp.created_at AS createdAt, rp.updated_at AS updatedAt
         FROM rent_payments rp
         JOIN leases l ON l.id = rp.lease_id
         WHERE rp.status = 'pending' AND rp.due_date < ? AND l.status = 'active'
         ORDER BY rp.due_date ASC`,
      )
      .all(asOfDate);
  }

  updateRentPaymentStatus(paymentId, updates) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE rent_payments SET amount_paid = ?, date_paid = ?, status = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        updates.amountPaid,
        updates.datePaid || null,
        updates.status,
        now,
        paymentId,
      );
    return this.getRentPaymentById(paymentId);
  }

  // --- Late Fee Ledger ---

  insertLateFeeEntry(entry) {
    const id = entry.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO late_fee_ledger (id, lease_id, rent_payment_id, period, days_late, daily_rate, fee_amount, pending_debt_total, soroban_tx_status, soroban_tx_hash, assessed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.leaseId,
        entry.rentPaymentId,
        entry.period,
        entry.daysLate,
        entry.dailyRate,
        entry.feeAmount,
        entry.pendingDebtTotal,
        entry.sorobanTxStatus || "pending",
        entry.sorobanTxHash || null,
        entry.assessedAt,
        now,
      );
    return this.getLateFeeEntryById(id);
  }

  getLateFeeEntryById(entryId) {
    const row = this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, rent_payment_id AS rentPaymentId, period,
                days_late AS daysLate, daily_rate AS dailyRate, fee_amount AS feeAmount,
                pending_debt_total AS pendingDebtTotal, soroban_tx_status AS sorobanTxStatus,
                soroban_tx_hash AS sorobanTxHash, assessed_at AS assessedAt,
                created_at AS createdAt
         FROM late_fee_ledger WHERE id = ?`,
      )
      .get(entryId);
    return row || null;
  }

  getLatestLateFeeForPayment(rentPaymentId) {
    const row = this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, rent_payment_id AS rentPaymentId, period,
                days_late AS daysLate, daily_rate AS dailyRate, fee_amount AS feeAmount,
                pending_debt_total AS pendingDebtTotal, soroban_tx_status AS sorobanTxStatus,
                soroban_tx_hash AS sorobanTxHash, assessed_at AS assessedAt,
                created_at AS createdAt
         FROM late_fee_ledger WHERE rent_payment_id = ?
         ORDER BY assessed_at DESC LIMIT 1`,
      )
      .get(rentPaymentId);
    return row || null;
  }

  listLateFeesByLeaseId(leaseId) {
    return this.db
      .prepare(
        `SELECT id, lease_id AS leaseId, rent_payment_id AS rentPaymentId, period,
                days_late AS daysLate, daily_rate AS dailyRate, fee_amount AS feeAmount,
                pending_debt_total AS pendingDebtTotal, soroban_tx_status AS sorobanTxStatus,
                soroban_tx_hash AS sorobanTxHash, assessed_at AS assessedAt,
                created_at AS createdAt
         FROM late_fee_ledger WHERE lease_id = ?
         ORDER BY assessed_at DESC`,
      )
      .all(leaseId);
  }

  /**
   * List all payments made from a specific Stellar account, most-recent first.
   *
   * @param {string} tenantAccountId Stellar account address.
   * @returns {object[]}
   */
  listPaymentsByTenantAccount(tenantAccountId) {
    return this.db
      .prepare(
        `SELECT
           id,
           horizon_op_id    AS horizonOpId,
           lease_id         AS leaseId,
           tenant_account_id AS tenantAccountId,
           amount,
           asset_code       AS assetCode,
           asset_issuer     AS assetIssuer,
           transaction_hash AS transactionHash,
           paid_at          AS paidAt,
           recorded_at      AS recordedAt
         FROM payment_history
         WHERE tenant_account_id = ?
         ORDER BY paid_at DESC`,
      )
      .all(tenantAccountId);
  }

  /**
   * Update a lease's payment_status and last_payment_at columns.
   *
   * @param {string} leaseId Lease identifier.
   * @param {string} status  New payment status (e.g. 'paid').
   * @param {string} paidAt  ISO timestamp of the payment.
   * @returns {void}
   */
  updateLeasePaymentStatus(leaseId, status, paidAt) {
    this.db
      .prepare(
        `UPDATE leases
         SET payment_status  = ?,
             last_payment_at = ?,
             updated_at      = ?
         WHERE id = ?`,
      )
      .run(status, paidAt, new Date().toISOString(), leaseId);
  }

  /**
   * Find the active (non-disputed, status = 'active') lease for a given tenant
   * Stellar account address so payments can be auto-matched.
   *
   * @param {string} tenantAccountId Stellar account address.
   * @returns {object|null}
   */
  getActiveLeaseByTenantAccount(tenantAccountId) {
    const row = this.db
      .prepare(
        `SELECT
           id,
           landlord_id       AS landlordId,
           tenant_id         AS tenantId,
           tenant_account_id AS tenantAccountId,
           status,
           rent_amount       AS rentAmount,
           currency,
           start_date        AS startDate,
           end_date          AS endDate,
           renewable,
           disputed,
           payment_status    AS paymentStatus,
           last_payment_at   AS lastPaymentAt,
           created_at        AS createdAt,
           updated_at        AS updatedAt
         FROM leases
         WHERE tenant_account_id = ?
           AND status = 'active'
           AND disputed = 0
         LIMIT 1`,
      )
      .get(tenantAccountId);

    return row ? normalizeLeaseRow(row) : null;
  }

  /**
   * Persist an uploaded utility bill and the computed tenant share.
   *
   * @param {object} utilityBill Utility billing payload.
   * @returns {object}
   */
  insertUtilityBill(utilityBill) {
    const id = utilityBill.id || crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO utility_bills (
           id, lease_id, landlord_id, bill_amount, tenant_share_amount,
           currency, billing_cycle, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        utilityBill.leaseId,
        utilityBill.landlordId,
        Number(utilityBill.billAmount),
        Number(utilityBill.tenantShareAmount),
        utilityBill.currency || 'USDC',
        utilityBill.billingCycle,
        now,
      );

    return this.db
      .prepare(
        `SELECT
           id,
           lease_id           AS leaseId,
           landlord_id        AS landlordId,
           bill_amount        AS billAmount,
           tenant_share_amount AS tenantShareAmount,
           currency,
           billing_cycle      AS billingCycle,
           created_at         AS createdAt
         FROM utility_bills
         WHERE id = ?`,
      )
      .get(id);
  }

  /**
   * Return the total tenant utility share awaiting reconciliation for a lease.
   *
   * @param {string} leaseId Lease identifier.
   * @returns {number}
   */
  getPendingUtilityShareTotalByLeaseId(leaseId) {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tenant_share_amount), 0) AS total
         FROM utility_bills
         WHERE lease_id = ?`,
      )
      .get(leaseId);

    return Number(row?.total || 0);
  }

  /**
   * Upsert the current upcoming payment total for a lease.
   *
   * @param {object} payload Upcoming payment totals.
   * @returns {object|null}
   */
  upsertUpcomingPaymentTotal(payload) {
    const baseRentAmount = Number(payload.baseRentAmount);
    const utilityShareTotal = Number(payload.utilityShareTotal || 0);
    const upcomingTotal = baseRentAmount + utilityShareTotal;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO upcoming_payments (
           lease_id,
           base_rent_amount,
           utility_share_total,
           upcoming_total,
           approval_status,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(lease_id) DO UPDATE SET
           base_rent_amount = excluded.base_rent_amount,
           utility_share_total = excluded.utility_share_total,
           upcoming_total = excluded.upcoming_total,
           approval_status = excluded.approval_status,
           updated_at = excluded.updated_at`,
      )
      .run(
        payload.leaseId,
        baseRentAmount,
        utilityShareTotal,
        upcomingTotal,
        payload.approvalStatus || 'pending',
        now,
      );

    return this.getUpcomingPaymentByLeaseId(payload.leaseId);
  }

  /**
   * Fetch upcoming payment totals for a lease.
   *
   * @param {string} leaseId Lease identifier.
   * @returns {object|null}
   */
  getUpcomingPaymentByLeaseId(leaseId) {
    const row = this.db
      .prepare(
        `SELECT
           lease_id            AS leaseId,
           base_rent_amount    AS baseRentAmount,
           utility_share_total AS utilityShareTotal,
           upcoming_total      AS upcomingTotal,
           approval_status     AS approvalStatus,
           updated_at          AS updatedAt
         FROM upcoming_payments
         WHERE lease_id = ?`,
      )
      .get(leaseId);

    return row ?? null;
  }

  // --- Maintenance Jobs & Vendor Payments (Issue #29) ---

  /**
   * Create a new maintenance job.
   */
  insertMaintenanceJob(job) {
    const id = job.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO maintenance_jobs (id, lease_id, description, contractor_wallet, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        job.leaseId,
        job.description,
        job.contractorWallet,
        job.amount,
        job.status || 'pending',
        now,
      );
    return this.getMaintenanceJobById(id);
  }

  /**
   * Fetch a maintenance job by ID.
   */
  getMaintenanceJobById(jobId) {
    const row = this.db
      .prepare(`SELECT * FROM maintenance_jobs WHERE id = ?`)
      .get(jobId);
    return row ? normalizeMaintenanceJobRow(row) : null;
  }

  /**
   * Update maintenance job status.
   */
  updateMaintenanceJobStatus(jobId, status) {
    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : null;
    this.db
      .prepare(`UPDATE maintenance_jobs SET status = ?, completed_at = ? WHERE id = ?`)
      .run(status, completedAt, jobId);
    return this.getMaintenanceJobById(jobId);
  }

  /**
   * Create a vendor payment authorization.
   */
  insertVendorPaymentAuthorization(auth) {
    const id = auth.id || crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO vendor_payment_authorizations (id, lease_id, job_id, landlord_id, amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        auth.leaseId,
        auth.jobId,
        auth.landlordId,
        auth.amount,
        'authorized',
        now,
      );
    return this.getVendorPaymentAuthorizationById(id);
  }

  /**
   * Fetch a vendor payment authorization by ID.
   */
  getVendorPaymentAuthorizationById(authId) {
    const row = this.db
      .prepare(`SELECT * FROM vendor_payment_authorizations WHERE id = ?`)
      .get(authId);
    return row ? normalizeVendorPaymentRow(row) : null;
  }

  /**
   * Mark a vendor payment authorization as paid.
   */
  markVendorPaymentAsPaid(authId) {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE vendor_payment_authorizations SET status = 'paid', paid_at = ? WHERE id = ?`)
      .run(now, authId);
    return this.getVendorPaymentAuthorizationById(authId);
  }

  /**
   * List all maintenance maintenance expenses for tax deduction report (Issue #30).
   */
  listMaintenanceExpenses(landlordId, year) {
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;
      return this.db
        .prepare(`
            SELECT mj.* FROM maintenance_jobs mj
            JOIN leases l ON mj.lease_id = l.id
            WHERE l.landlord_id = ? AND mj.status = 'completed' AND mj.completed_at BETWEEN ? AND ?
        `)
        .all(landlordId, startOfYear, endOfYear)
        .map(normalizeMaintenanceJobRow);
  }

  /**
   * List all protocol fees paid for a specific year and landlord.
   */
  listProtocolFees(landlordId, year) {
      const startOfYear = `${year}-01-01`;
      const endOfYear = `${year}-12-31`;
      return this.db
        .prepare(`
            SELECT rp.protocol_fee, rp.date_paid, rp.lease_id, l.landlord_id
            FROM rent_payments rp
            JOIN leases l ON rp.lease_id = l.id
            WHERE l.landlord_id = ? AND rp.status = 'paid' AND rp.date_paid BETWEEN ? AND ?
        `)
        .all(landlordId, startOfYear, endOfYear);
  }
}

function normalizeLeaseRow(row) {
  return {
    ...row,
    renewable: Boolean(row.renewable),
    disputed: Boolean(row.disputed),
  };
}

function normalizeRuleRow(row) {
  return {
    ...row,
    enabled: Boolean(row.enabled),
  };
}

function normalizeProposalRow(row) {
  return {
    ...row,
    currentTermsSnapshot: JSON.parse(row.currentTermsSnapshot),
    proposedTerms: JSON.parse(row.proposedTerms),
    ruleApplied: JSON.parse(row.ruleApplied),
    sorobanContractReference: row.sorobanContractReference
      ? JSON.parse(row.sorobanContractReference)
      : null,
  };
}

function normalizeKycRow(row) {
  return {
    ...row,
    isVerified: row.kycStatus === 'verified'
  };
}

/**
 * Normalizes a maintenance job row.
 */
function normalizeMaintenanceJobRow(row) {
  return {
    ...row,
    amount: Number(row.amount),
  };
}

/**
 * Normalizes a vendor payment authorization row.
 */
function normalizeVendorPaymentRow(row) {
  return {
    ...row,
    amount: Number(row.amount),
  };
}

module.exports = {
  AppDatabase,
};
