/**
 * Migration to add rent escrow for maintenance disputes
 */

exports.up = function(db) {
  return db.runSql(`
    -- Rent escrow accounts for disputed amounts
    CREATE TABLE IF NOT EXISTS rent_escrows (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      maintenance_ticket_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      landlord_id TEXT NOT NULL,
      disputed_amount TEXT NOT NULL, -- Amount withheld in escrow (as string for precision)
      currency TEXT NOT NULL DEFAULT 'XLM',
      escrow_status TEXT NOT NULL DEFAULT 'active' CHECK (escrow_status IN ('active', 'released_to_landlord', 'returned_to_tenant', 'split', 'cancelled')),
      escrow_account_id TEXT, -- Stellar escrow account or Soroban contract ID
      reason TEXT NOT NULL, -- Reason for withholding rent
      evidence TEXT, -- JSON array of evidence photos/documents
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id),
      FOREIGN KEY (maintenance_ticket_id) REFERENCES maintenance_tickets(id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (landlord_id) REFERENCES landlords(id)
    );

    -- Escrow transaction history
    CREATE TABLE IF NOT EXISTS escrow_transactions (
      id TEXT PRIMARY KEY,
      escrow_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit', 'release', 'return', 'split', 'refund')),
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      transaction_hash TEXT, -- Blockchain transaction hash
      stellar_operation_id TEXT, -- Stellar operation ID
      recipient_id TEXT, -- Tenant or landlord ID receiving funds
      recipient_account_id TEXT, -- Stellar account receiving funds
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
      failure_reason TEXT,
      metadata TEXT, -- Additional transaction details
      processed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (escrow_id) REFERENCES rent_escrows(id)
    );

    -- Repair verification workflow
    CREATE TABLE IF NOT EXISTS repair_verifications (
      id TEXT PRIMARY KEY,
      maintenance_ticket_id TEXT NOT NULL,
      escrow_id TEXT,
      repair_photos_before TEXT, -- JSON array of before photos
      repair_photos_after TEXT, -- JSON array of after photos
      repair_description TEXT, -- Landlord/vendor description of repairs
      tenant_confirmation_status TEXT DEFAULT 'pending' CHECK (tenant_confirmation_status IN ('pending', 'confirmed', 'rejected', 'timeout')),
      tenant_feedback TEXT, -- Tenant's feedback on repairs
      tenant_confirmed_at TEXT,
      tenant_rejected_at TEXT,
      auto_release_triggered INTEGER DEFAULT 0, -- Boolean: auto-release triggered after timeout
      verifier_notes TEXT, -- Third-party verifier notes if applicable
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (maintenance_ticket_id) REFERENCES maintenance_tickets(id),
      FOREIGN KEY (escrow_id) REFERENCES rent_escrows(id)
    );

    -- Escrow release rules and automation
    CREATE TABLE IF NOT EXISTS escrow_release_rules (
      id TEXT PRIMARY KEY,
      lease_id TEXT,
      rule_type TEXT NOT NULL CHECK (rule_type IN ('auto_release_days', 'require_verification', 'split_percentage')),
      rule_value TEXT NOT NULL, -- JSON with rule-specific configuration
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_rent_escrows_lease_id ON rent_escrows(lease_id);
    CREATE INDEX IF NOT EXISTS idx_rent_escrows_maintenance_ticket_id ON rent_escrows(maintenance_ticket_id);
    CREATE INDEX IF NOT EXISTS idx_rent_escrows_status ON rent_escrows(escrow_status);
    CREATE INDEX IF NOT EXISTS idx_escrow_transactions_escrow_id ON escrow_transactions(escrow_id);
    CREATE INDEX IF NOT EXISTS idx_escrow_transactions_status ON escrow_transactions(status);
    CREATE INDEX IF NOT EXISTS idx_repair_verifications_maintenance_ticket_id ON repair_verifications(maintenance_ticket_id);
    CREATE INDEX IF NOT EXISTS idx_repair_verifications_tenant_status ON repair_verifications(tenant_confirmation_status);
    CREATE INDEX IF NOT EXISTS idx_escrow_release_rules_lease_id ON escrow_release_rules(lease_id);
  `);
};

exports.down = function(db) {
  return db.runSql(`
    DROP INDEX IF EXISTS idx_rent_escrows_lease_id;
    DROP INDEX IF EXISTS idx_rent_escrows_maintenance_ticket_id;
    DROP INDEX IF EXISTS idx_rent_escrows_status;
    DROP INDEX IF EXISTS idx_escrow_transactions_escrow_id;
    DROP INDEX IF EXISTS idx_escrow_transactions_status;
    DROP INDEX IF EXISTS idx_repair_verifications_maintenance_ticket_id;
    DROP INDEX IF EXISTS idx_repair_verifications_tenant_status;
    DROP INDEX IF NOT EXISTS idx_escrow_release_rules_lease_id;
    
    DROP TABLE IF EXISTS escrow_release_rules;
    DROP TABLE IF EXISTS repair_verifications;
    DROP TABLE IF EXISTS escrow_transactions;
    DROP TABLE IF EXISTS rent_escrows;
  `);
};
