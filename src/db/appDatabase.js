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

module.exports = {
  AppDatabase,
};
