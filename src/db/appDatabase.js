const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

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
    if (this.filename === ':memory:') {
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

      CREATE TABLE IF NOT EXISTS kyc_verifications (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL CHECK (actor_role IN ('landlord', 'tenant')),
        stellar_account_id TEXT,
        kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'in_progress', 'verified', 'rejected')),
        anchor_provider TEXT NOT NULL,
        verification_reference TEXT,
        submitted_at TEXT,
        verified_at TEXT,
        rejected_at TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(actor_id, actor_role)
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_verifications_actor
        ON kyc_verifications (actor_id, actor_role);

      CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status
        ON kyc_verifications (kyc_status);

      CREATE INDEX IF NOT EXISTS idx_kyc_verifications_stellar_account
        ON kyc_verifications (stellar_account_id);

      -- Sanctions screening tables
      CREATE TABLE IF NOT EXISTS sanctions_violations (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        violation_type TEXT NOT NULL,
        address TEXT NOT NULL,
        sanctions_source TEXT NOT NULL,
        sanctions_name TEXT,
        sanctions_programs TEXT,
        detected_at TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lease_freeze_events (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        freeze_reason TEXT NOT NULL,
        freeze_details TEXT,
        frozen_at TEXT NOT NULL,
        unfrozen_at TEXT,
        status TEXT DEFAULT 'FROZEN',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sanctions_cache (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL,
        name TEXT,
        type TEXT,
        programs TEXT,
        regulation TEXT,
        added_at TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payment_schedules (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        due_date TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        sanctions_paused INTEGER DEFAULT 0,
        sanctions_pause_reason TEXT,
        sanctions_paused_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Sanctions-related indexes
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_lease_id ON sanctions_violations(lease_id);
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_address ON sanctions_violations(address);
      CREATE INDEX IF NOT EXISTS idx_sanctions_violations_status ON sanctions_violations(status);
      CREATE INDEX IF NOT EXISTS idx_lease_freeze_events_lease_id ON lease_freeze_events(lease_id);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_address ON sanctions_cache(address);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_source ON sanctions_cache(source);
      CREATE INDEX IF NOT EXISTS idx_sanctions_cache_expires_at ON sanctions_cache(expires_at);

      -- Vendor management tables (Task 1: Vendor Role)
      CREATE TABLE IF NOT EXISTS vendors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT,
        company_name TEXT,
        license_number TEXT,
        specialties TEXT,
        kyc_status TEXT DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
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
        category TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'disputed')),
        photos TEXT,
        repair_photos TEXT,
        notes TEXT,
        tenant_notes TEXT,
        opened_at TEXT NOT NULL,
        in_progress_at TEXT,
        resolved_at TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS vendor_access_grants (
        id TEXT PRIMARY KEY,
        vendor_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        maintenance_ticket_id TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        access_type TEXT NOT NULL DEFAULT 'maintenance_log' CHECK (access_type IN ('maintenance_log', 'tenant_contact', 'property_access')),
        permissions TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        revoke_reason TEXT,
        accessed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (vendor_id) REFERENCES vendors(id),
        FOREIGN KEY (lease_id) REFERENCES leases(id),
        FOREIGN KEY (maintenance_ticket_id) REFERENCES maintenance_tickets(id)
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
        FOREIGN KEY (access_grant_id) REFERENCES vendor_access_grants(id),
        FOREIGN KEY (vendor_id) REFERENCES vendors(id),
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_lease_id ON maintenance_tickets(lease_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_vendor_id ON maintenance_tickets(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);
      CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_vendor_id ON vendor_access_grants(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_lease_id ON vendor_access_grants(lease_id);
      CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_expires_at ON vendor_access_grants(expires_at);
      CREATE INDEX IF NOT EXISTS idx_vendor_access_logs_access_grant_id ON vendor_access_logs(access_grant_id);
      CREATE INDEX IF NOT EXISTS idx_vendor_access_logs_vendor_id ON vendor_access_logs(vendor_id);
      CREATE INDEX IF NOT EXISTS idx_vendors_kyc_status ON vendors(kyc_status);

      ALTER TABLE leases ADD COLUMN IF NOT EXISTS has_active_maintenance INTEGER DEFAULT 0;

      -- Smart lock integration tables (Task 2: IoT Smart Lock Gateway)
      CREATE TABLE IF NOT EXISTS smart_locks (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        lock_provider TEXT NOT NULL CHECK (lock_provider IN ('august', 'yale', 'schlage', 'other')),
        device_id TEXT NOT NULL UNIQUE,
        device_name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at TEXT,
        pairing_status TEXT DEFAULT 'pending' CHECK (pairing_status IN ('pending', 'paired', 'error', 'unpaired')),
        last_sync_at TEXT,
        firmware_version TEXT,
        battery_level INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS digital_keys (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        smart_lock_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        tenant_account_id TEXT NOT NULL,
        key_type TEXT NOT NULL DEFAULT 'bluetooth' CHECK (key_type IN ('bluetooth', 'wifi', 'cloud')),
        key_data TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
        valid_from TEXT NOT NULL,
        valid_until TEXT NOT NULL,
        revoked_at TEXT,
        revoke_reason TEXT,
        last_used_at TEXT,
        usage_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id),
        FOREIGN KEY (smart_lock_id) REFERENCES smart_locks(id)
      );

      CREATE TABLE IF NOT EXISTS key_usage_logs (
        id TEXT PRIMARY KEY,
        digital_key_id TEXT NOT NULL,
        smart_lock_id TEXT NOT NULL,
        lease_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('unlock', 'lock', 'access_granted', 'access_denied', 'key_revoked')),
        result TEXT NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
        failure_reason TEXT,
        ip_address TEXT,
        location_data TEXT,
        metadata TEXT,
        performed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (digital_key_id) REFERENCES digital_keys(id),
        FOREIGN KEY (smart_lock_id) REFERENCES smart_locks(id),
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE TABLE IF NOT EXISTS lease_enforcement_checks (
        id TEXT PRIMARY KEY,
        lease_id TEXT NOT NULL,
        check_type TEXT NOT NULL CHECK (check_type IN ('rent_payment', 'lease_active', 'lease_expired', 'breach_detected')),
        soroban_contract_status TEXT,
        rent_current INTEGER,
        enforcement_action TEXT,
        check_result TEXT NOT NULL CHECK (check_result IN ('pass', 'fail', 'warning')),
        details TEXT,
        checked_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lease_id) REFERENCES leases(id)
      );

      CREATE INDEX IF NOT EXISTS idx_smart_locks_lease_id ON smart_locks(lease_id);
      CREATE INDEX IF NOT EXISTS idx_smart_locks_device_id ON smart_locks(device_id);
      CREATE INDEX IF NOT EXISTS idx_digital_keys_lease_id ON digital_keys(lease_id);
      CREATE INDEX IF NOT EXISTS idx_digital_keys_tenant_id ON digital_keys(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_digital_keys_status ON digital_keys(status);
      CREATE INDEX IF NOT EXISTS idx_digital_keys_valid_until ON digital_keys(valid_until);
      CREATE INDEX IF NOT EXISTS idx_key_usage_logs_digital_key_id ON key_usage_logs(digital_key_id);
      CREATE INDEX IF NOT EXISTS idx_key_usage_logs_smart_lock_id ON key_usage_logs(smart_lock_id);
      CREATE INDEX IF NOT EXISTS idx_lease_enforcement_checks_lease_id ON lease_enforcement_checks(lease_id);
      CREATE INDEX IF NOT EXISTS idx_lease_enforcement_checks_checked_at ON lease_enforcement_checks(checked_at);
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
    this.db.exec('BEGIN');

    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
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
        proposal.sorobanContractReference ? JSON.stringify(proposal.sorobanContractReference) : null,
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
        proposal.sorobanContractReference ? JSON.stringify(proposal.sorobanContractReference) : null,
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
        payment.assetCode || 'XLM',
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

  // ---------------------------------------------------------------------------
  // KYC Verification methods (SEP-12 Stellar Anchor Integration)
  // ---------------------------------------------------------------------------

  /**
   * Insert or update a KYC verification record.
   *
   * @param {object} kycData KYC verification data.
   * @returns {object} The inserted/updated KYC record.
   */
  upsertKycVerification(kycData) {
    const now = new Date().toISOString();
    const id = kycData.id || crypto.randomUUID();
    
    this.db
      .prepare(
        `INSERT INTO kyc_verifications (
           id, actor_id, actor_role, stellar_account_id, kyc_status, anchor_provider,
           verification_reference, submitted_at, verified_at, rejected_at, rejection_reason,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(actor_id, actor_role) DO UPDATE SET
           stellar_account_id = excluded.stellar_account_id,
           kyc_status = excluded.kyc_status,
           anchor_provider = excluded.anchor_provider,
           verification_reference = excluded.verification_reference,
           submitted_at = excluded.submitted_at,
           verified_at = excluded.verified_at,
           rejected_at = excluded.rejected_at,
           rejection_reason = excluded.rejection_reason,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        kycData.actorId,
        kycData.actorRole,
        kycData.stellarAccountId || null,
        kycData.kycStatus || 'pending',
        kycData.anchorProvider,
        kycData.verificationReference || null,
        kycData.submittedAt || null,
        kycData.verifiedAt || null,
        kycData.rejectedAt || null,
        kycData.rejectionReason || null,
        kycData.createdAt || now,
        now,
      );

    return this.getKycVerificationByActor(kycData.actorId, kycData.actorRole);
  }

  /**
   * Fetch a KYC verification record by actor.
   *
   * @param {string} actorId Actor identifier.
   * @param {string} actorRole Actor role ('landlord' or 'tenant').
   * @returns {object|null}
   */
  getKycVerificationByActor(actorId, actorRole) {
    const row = this.db
      .prepare(
        `SELECT
           id,
           actor_id AS actorId,
           actor_role AS actorRole,
           stellar_account_id AS stellarAccountId,
           kyc_status AS kycStatus,
           anchor_provider AS anchorProvider,
           verification_reference AS verificationReference,
           submitted_at AS submittedAt,
           verified_at AS verifiedAt,
           rejected_at AS rejectedAt,
           rejection_reason AS rejectionReason,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM kyc_verifications
         WHERE actor_id = ? AND actor_role = ?`,
      )
      .get(actorId, actorRole);

    return row ? normalizeKycRow(row) : null;
  }

  /**
   * Fetch a KYC verification record by Stellar account.
   *
   * @param {string} stellarAccountId Stellar account address.
   * @returns {object|null}
   */
  getKycVerificationByStellarAccount(stellarAccountId) {
    const row = this.db
      .prepare(
        `SELECT
           id,
           actor_id AS actorId,
           actor_role AS actorRole,
           stellar_account_id AS stellarAccountId,
           kyc_status AS kycStatus,
           anchor_provider AS anchorProvider,
           verification_reference AS verificationReference,
           submitted_at AS submittedAt,
           verified_at AS verifiedAt,
           rejected_at AS rejectedAt,
           rejection_reason AS rejectionReason,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM kyc_verifications
         WHERE stellar_account_id = ?`,
      )
      .get(stellarAccountId);

    return row ? normalizeKycRow(row) : null;
  }

  /**
   * Update KYC verification status.
   *
   * @param {string} actorId Actor identifier.
   * @param {string} actorRole Actor role.
   * @param {string} newStatus New KYC status.
   * @param {object} additionalFields Additional fields to update.
   * @returns {object|null}
   */
  updateKycStatus(actorId, actorRole, newStatus, additionalFields = {}) {
    const now = new Date().toISOString();
    const updateFields = {
      kyc_status: newStatus,
      updated_at: now,
      ...additionalFields
    };

    const setClause = Object.keys(updateFields).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updateFields);

    this.db
      .prepare(
        `UPDATE kyc_verifications
         SET ${setClause}
         WHERE actor_id = ? AND actor_role = ?`,
      )
      .run(...values, actorId, actorRole);

    return this.getKycVerificationByActor(actorId, actorRole);
  }

  /**
   * Check if both landlord and tenant are verified for a lease.
   *
   * @param {string} landlordId Landlord identifier.
   * @param {string} tenantId Tenant identifier.
   * @returns {object} Verification status for both parties.
   */
  checkLeaseKycCompliance(landlordId, tenantId) {
    const landlordKyc = this.getKycVerificationByActor(landlordId, 'landlord');
    const tenantKyc = this.getKycVerificationByActor(tenantId, 'tenant');

    return {
      landlord: {
        id: landlordId,
        isVerified: landlordKyc?.kycStatus === 'verified',
        kycStatus: landlordKyc?.kycStatus || 'not_started',
        verification: landlordKyc
      },
      tenant: {
        id: tenantId,
        isVerified: tenantKyc?.kycStatus === 'verified',
        kycStatus: tenantKyc?.kycStatus || 'not_started',
        verification: tenantKyc
      },
      leaseCanProceed: (landlordKyc?.kycStatus === 'verified' && tenantKyc?.kycStatus === 'verified')
    };
  }
/**
   * Get active leases for sanctions screening
   * @returns {Array} Array of active lease objects
   */
  getActiveLeases() {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        landlord_id as landlordId,
        tenant_id as tenantId,
        landlord_stellar_address as landlordStellarAddress,
        tenant_stellar_address as tenantStellarAddress,
        status,
        rent_amount as rentAmount,
        currency,
        start_date as startDate,
        end_date as endDate,
        created_at as createdAt
      FROM leases 
      WHERE status IN ('ACTIVE', 'PENDING') 
      AND (landlord_stellar_address IS NOT NULL OR tenant_stellar_address IS NOT NULL)
      ORDER BY created_at DESC
    `);
    
    return stmt.all().map(normalizeLeaseRow);
  }

  /**
   * Update lease status due to sanctions violation
   * @param {string} leaseId - Lease ID
   * @param {string} status - New status (e.g., 'FROZEN')
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} Success status
   */
  updateLeaseStatus(leaseId, status, metadata = {}) {
    const stmt = this.db.prepare(`
      UPDATE leases 
      SET status = ?,
          sanctions_status = ?,
          sanctions_check_at = ?,
          sanctions_violation_count = sanctions_violation_count + 1,
          updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(
      status,
      status === 'FROZEN' ? 'VIOLATION' : 'CLEAN',
      new Date().toISOString(),
      new Date().toISOString(),
      leaseId
    );

    return result.changes > 0;
  }

  /**
   * Pause payment schedules for a lease
   * @param {string} leaseId - Lease ID
   * @param {Object} pauseDetails - Pause details
   * @returns {boolean} Success status
   */
  pausePaymentSchedules(leaseId, pauseDetails) {
    const stmt = this.db.prepare(`
      UPDATE payment_schedules 
      SET sanctions_paused = TRUE,
          sanctions_pause_reason = ?,
          sanctions_paused_at = ?,
          updated_at = ?
      WHERE lease_id = ? AND status = 'ACTIVE'
    `);

    const result = stmt.run(
      pauseDetails.reason,
      pauseDetails.pausedAt,
      new Date().toISOString(),
      leaseId
    );

    return result.changes > 0;
  }

  /**
   * Log sanctions violation
   * @param {Object} violationData - Violation data
   * @returns {boolean} Success status
   */
  logSanctionsViolation(violationData) {
    const stmt = this.db.prepare(`
      INSERT INTO sanctions_violations (
        lease_id,
        violation_type,
        address,
        sanctions_source,
        sanctions_name,
        sanctions_programs,
        detected_at,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
        violationData.leaseId,
        violationData.violations[0]?.type || 'UNKNOWN',
        violationData.violations[0]?.address || '',
        violationData.violations[0]?.source || 'UNKNOWN',
        violationData.violations[0]?.name || '',
        JSON.stringify(violationData.violations[0]?.programs || []),
        violationData.detectedAt,
        'ACTIVE'
      );
      return true;
    } catch (error) {
      console.error('Failed to log sanctions violation:', error);
      return false;
    }
  }

  /**
   * Get sanctions violations for a lease
   * @param {string} leaseId - Lease ID
   * @returns {Array} Array of violation objects
   */
  getSanctionsViolations(leaseId) {
    const stmt = this.db.prepare(`
      SELECT 
        id,
        lease_id as leaseId,
        violation_type as violationType,
        address,
        sanctions_source as sanctionsSource,
        sanctions_name as sanctionsName,
        sanctions_programs as sanctionsPrograms,
        detected_at as detectedAt,
        status,
        created_at as createdAt,
        updated_at as updatedAt
      FROM sanctions_violations 
      WHERE lease_id = ?
      ORDER BY detected_at DESC
    `);

    const rows = stmt.all(leaseId);
    return rows.map(row => ({
      ...row,
      sanctionsPrograms: JSON.parse(row.sanctionsPrograms || '[]')
    }));
  }

  /**
   * Cache sanctions list entries
   * @param {Array} sanctionsData - Array of sanctions entries
   * @returns {boolean} Success status
   */
  cacheSanctionsList(sanctionsData) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sanctions_cache (
        address,
        source,
        name,
        type,
        programs,
        regulation,
        added_at,
        expires_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const entry of sanctionsData) {
        stmt.run(
          entry.address,
          entry.source,
          entry.name,
          entry.type,
          JSON.stringify(entry.programs || []),
          entry.regulation || null,
          entry.addedAt,
          entry.expiresAt || new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 6 hours
          new Date().toISOString(),
          new Date().toISOString()
        );
      }
    });

    try {
      transaction();
      return true;
    } catch (error) {
      console.error('Failed to cache sanctions list:', error);
      return false;
    }
  }

  /**
   * Get cached sanctions entry for an address
   * @param {string} address - Stellar address
   * @returns {Object|null} Sanctions entry or null
   */
  getCachedSanctionsEntry(address) {
    const stmt = this.db.prepare(`
      SELECT 
        address,
        source,
        name,
        type,
        programs,
        regulation,
        added_at as addedAt,
        expires_at as expiresAt
      FROM sanctions_cache 
      WHERE address = ? AND expires_at > ?
    `);

    const row = stmt.get(address.toUpperCase(), new Date().toISOString());
    
    if (row) {
      return {
        ...row,
        programs: JSON.parse(row.programs || '[]')
      };
    }
    
    return null;
  }

  /**
   * Clean expired sanctions cache entries
   * @returns {number} Number of entries cleaned
   */
  cleanExpiredSanctionsCache() {
    const stmt = this.db.prepare(`
      DELETE FROM sanctions_cache 
      WHERE expires_at <= ?
    `);

    const result = stmt.run(new Date().toISOString());
    return result.changes;
  }

  /**
   * Get sanctions screening statistics
   * @returns {Object} Statistics object
   */
  getSanctionsStatistics() {
    const stats = {};

    // Total violations
    const totalViolationsStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sanctions_violations WHERE status = 'ACTIVE'
    `);
    stats.totalActiveViolations = totalViolationsStmt.get().count;

    // Frozen leases
    const frozenLeasesStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM leases WHERE status = 'FROZEN'
    `);
    stats.frozenLeases = frozenLeasesStmt.get().count;

    // Cache size
    const cacheSizeStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM sanctions_cache WHERE expires_at > ?
    `);
    stats.cacheSize = cacheSizeStmt.get(new Date().toISOString()).count;

    // Violations by source
    const violationsBySourceStmt = this.db.prepare(`
      SELECT sanctions_source, COUNT(*) as count 
      FROM sanctions_violations 
      WHERE status = 'ACTIVE' 
      GROUP BY sanctions_source
    `);
    stats.violationsBySource = violationsBySourceStmt.all();

    return stats;
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

module.exports = {
  AppDatabase,
};
