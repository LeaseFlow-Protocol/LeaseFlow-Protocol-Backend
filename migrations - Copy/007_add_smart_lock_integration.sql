/**
 * Migration to add smart lock integration tables
 */

exports.up = function(db) {
  return db.runSql(`
    -- Smart locks table (IoT devices linked to properties)
    CREATE TABLE IF NOT EXISTS smart_locks (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      lock_provider TEXT NOT NULL CHECK (lock_provider IN ('august', 'yale', 'schlage', 'other')),
      device_id TEXT NOT NULL UNIQUE, -- Device ID from provider API
      device_name TEXT,
      access_token TEXT, -- Encrypted OAuth token for API access
      refresh_token TEXT, -- Encrypted refresh token
      token_expires_at TEXT,
      pairing_status TEXT DEFAULT 'pending' CHECK (pairing_status IN ('pending', 'paired', 'error', 'unpaired')),
      last_sync_at TEXT,
      firmware_version TEXT,
      battery_level INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Digital keys issued to tenants
    CREATE TABLE IF NOT EXISTS digital_keys (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      smart_lock_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      tenant_account_id TEXT NOT NULL, -- Stellar account or phone identifier
      key_type TEXT NOT NULL DEFAULT 'bluetooth' CHECK (key_type IN ('bluetooth', 'wifi', 'cloud')),
      key_data TEXT, -- Encrypted key material or access code
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
      FOREIGN KEY (smart_lock_id) REFERENCES smart_locks(id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );

    -- Key usage logs (audit trail)
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
      location_data TEXT, -- GPS coordinates if available
      metadata TEXT, -- Additional context
      performed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (digital_key_id) REFERENCES digital_keys(id),
      FOREIGN KEY (smart_lock_id) REFERENCES smart_locks(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Lease status checks for physical enforcement
    CREATE TABLE IF NOT EXISTS lease_enforcement_checks (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      check_type TEXT NOT NULL CHECK (check_type IN ('rent_payment', 'lease_active', 'lease_expired', 'breach_detected')),
      soroban_contract_status TEXT,
      rent_current INTEGER, -- Boolean: 1 if rent is current, 0 if not
      enforcement_action TEXT, -- Action taken (key_issued, key_revoked, warning_sent)
      check_result TEXT NOT NULL CHECK (check_result IN ('pass', 'fail', 'warning')),
      details TEXT, -- JSON with additional details
      checked_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Indexes for performance
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
};

exports.down = function(db) {
  return db.runSql(`
    DROP INDEX IF EXISTS idx_smart_locks_lease_id;
    DROP INDEX IF EXISTS idx_smart_locks_device_id;
    DROP INDEX IF EXISTS idx_digital_keys_lease_id;
    DROP INDEX IF EXISTS idx_digital_keys_tenant_id;
    DROP INDEX IF EXISTS idx_digital_keys_status;
    DROP INDEX IF EXISTS idx_digital_keys_valid_until;
    DROP INDEX IF EXISTS idx_key_usage_logs_digital_key_id;
    DROP INDEX IF EXISTS idx_key_usage_logs_smart_lock_id;
    DROP INDEX IF EXISTS idx_lease_enforcement_checks_lease_id;
    DROP INDEX IF EXISTS idx_lease_enforcement_checks_checked_at;
    
    DROP TABLE IF EXISTS lease_enforcement_checks;
    DROP TABLE IF EXISTS key_usage_logs;
    DROP TABLE IF EXISTS digital_keys;
    DROP TABLE IF EXISTS smart_locks;
  `);
};
