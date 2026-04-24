/**
 * Migration to add audit logging for financial changes
 * Task 4: Security & Compliance - Audit Trail for Rent/Deposit Changes
 */

exports.up = function(db) {
  return db.runSql(`
    -- Audit log table to track all changes to sensitive financial data
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('INSERT', 'UPDATE', 'DELETE')),
      column_name TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      admin_id TEXT NOT NULL,
      admin_email TEXT,
      ip_address TEXT,
      user_agent TEXT,
      change_reason TEXT,
      created_at TEXT NOT NULL
    );

    -- Indexes for audit trail queries
    CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON audit_log(admin_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON audit_log(action_type);

    -- Trigger to audit rent_amount changes in leases table
    CREATE TRIGGER IF NOT EXISTS audit_lease_rent_amount_changes
    AFTER UPDATE OF rent_amount ON leases
    FOR EACH ROW
    BEGIN
      INSERT INTO audit_log (
        id, table_name, record_id, action_type, column_name,
        old_value, new_value, admin_id, admin_email, ip_address, user_agent,
        change_reason, created_at
      )
      VALUES (
        lower(hex(randomblob(16))),
        'leases',
        OLD.id,
        'UPDATE',
        'rent_amount',
        CAST(OLD.rent_amount AS TEXT),
        CAST(NEW.rent_amount AS TEXT),
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      );
    END;

    -- Trigger to audit deposit-related changes (if you have a deposits table or security_deposit column)
    -- For now, we'll add a trigger for any balance-related columns that might be added
    CREATE TRIGGER IF NOT EXISTS audit_lease_payment_status_changes
    AFTER UPDATE OF payment_status ON leases
    FOR EACH ROW
    BEGIN
      INSERT INTO audit_log (
        id, table_name, record_id, action_type, column_name,
        old_value, new_value, admin_id, admin_email, ip_address, user_agent,
        change_reason, created_at
      )
      VALUES (
        lower(hex(randomblob(16))),
        'leases',
        OLD.id,
        'UPDATE',
        'payment_status',
        OLD.payment_status,
        NEW.payment_status,
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      );
    END;

    -- Trigger to audit rent payment amount changes
    CREATE TRIGGER IF NOT EXISTS audit_rent_payment_changes
    AFTER UPDATE OF amount_due, amount_paid ON rent_payments
    FOR EACH ROW
    WHEN OLD.amount_due != NEW.amount_due OR OLD.amount_paid != NEW.amount_paid
    BEGIN
      INSERT INTO audit_log (
        id, table_name, record_id, action_type, column_name,
        old_value, new_value, admin_id, admin_email, ip_address, user_agent,
        change_reason, created_at
      )
      VALUES 
      (
        lower(hex(randomblob(16))),
        'rent_payments',
        OLD.id,
        'UPDATE',
        'amount_due',
        CAST(OLD.amount_due AS TEXT),
        CAST(NEW.amount_due AS TEXT),
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      ),
      (
        lower(hex(randomblob(16))),
        'rent_payments',
        OLD.id,
        'UPDATE',
        'amount_paid',
        CAST(OLD.amount_paid AS TEXT),
        CAST(NEW.amount_paid AS TEXT),
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      );
    END;

    -- Trigger to audit late fee changes
    CREATE TRIGGER IF NOT EXISTS audit_late_fee_changes
    AFTER UPDATE OF fee_amount, daily_rate ON late_fee_ledger
    FOR EACH ROW
    WHEN OLD.fee_amount != NEW.fee_amount OR OLD.daily_rate != NEW.daily_rate
    BEGIN
      INSERT INTO audit_log (
        id, table_name, record_id, action_type, column_name,
        old_value, new_value, admin_id, admin_email, ip_address, user_agent,
        change_reason, created_at
      )
      VALUES 
      (
        lower(hex(randomblob(16))),
        'late_fee_ledger',
        OLD.id,
        'UPDATE',
        'fee_amount',
        CAST(OLD.fee_amount AS TEXT),
        CAST(NEW.fee_amount AS TEXT),
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      ),
      (
        lower(hex(randomblob(16))),
        'late_fee_ledger',
        OLD.id,
        'UPDATE',
        'daily_rate',
        CAST(OLD.daily_rate AS TEXT),
        CAST(NEW.daily_rate AS TEXT),
        COALESCE(NEW.updated_by, 'system'),
        NULL,
        NULL,
        NULL,
        NULL,
        datetime('now')
      );
    END;
  `);
};

exports.down = function(db) {
  return db.runSql(`
    -- Drop triggers
    DROP TRIGGER IF EXISTS audit_lease_rent_amount_changes;
    DROP TRIGGER IF EXISTS audit_lease_payment_status_changes;
    DROP TRIGGER IF EXISTS audit_rent_payment_changes;
    DROP TRIGGER IF EXISTS audit_late_fee_changes;

    -- Drop audit log table
    DROP TABLE IF EXISTS audit_log;
  `);
};
