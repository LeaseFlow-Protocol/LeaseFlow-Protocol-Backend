/**
 * Migration to add vendor access management tables
 */

exports.up = function(db) {
  return db.runSql(`
    -- Vendors table (extends actors with vendor-specific data)
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      company_name TEXT,
      license_number TEXT,
      specialties TEXT, -- JSON array of specialties (plumbing, electrical, etc.)
      kyc_status TEXT DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
      stellar_account_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Maintenance tickets
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id TEXT PRIMARY KEY,
      lease_id TEXT NOT NULL,
      vendor_id TEXT,
      landlord_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL, -- plumbing, electrical, hvac, appliance, structural, other
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'emergency')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'disputed')),
      photos TEXT, -- JSON array of photo URLs
      repair_photos TEXT, -- JSON array of repair completion photos
      notes TEXT, -- Additional notes from vendor/landlord
      tenant_notes TEXT, -- Tenant's notes/complaints
      opened_at TEXT NOT NULL,
      in_progress_at TEXT,
      resolved_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (lease_id) REFERENCES leases(id),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (landlord_id) REFERENCES landlords(id),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );

    -- Vendor property access grants (temporary access)
    CREATE TABLE IF NOT EXISTS vendor_access_grants (
      id TEXT PRIMARY KEY,
      vendor_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      maintenance_ticket_id TEXT NOT NULL,
      granted_by TEXT NOT NULL, -- landlord_id who granted access
      access_type TEXT NOT NULL DEFAULT 'maintenance_log' CHECK (access_type IN ('maintenance_log', 'tenant_contact', 'property_access')),
      permissions TEXT NOT NULL, -- JSON object specifying exact permissions
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT,
      accessed_at TEXT, -- When vendor first accessed the data
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id),
      FOREIGN KEY (maintenance_ticket_id) REFERENCES maintenance_tickets(id)
    );

    -- Vendor access logs (audit trail)
    CREATE TABLE IF NOT EXISTS vendor_access_logs (
      id TEXT PRIMARY KEY,
      access_grant_id TEXT NOT NULL,
      vendor_id TEXT NOT NULL,
      lease_id TEXT NOT NULL,
      action TEXT NOT NULL, -- view_maintenance_log, view_tenant_contact, etc.
      resource_accessed TEXT, -- Specific resource accessed
      ip_address TEXT,
      user_agent TEXT,
      accessed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (access_grant_id) REFERENCES vendor_access_grants(id),
      FOREIGN KEY (vendor_id) REFERENCES vendors(id),
      FOREIGN KEY (lease_id) REFERENCES leases(id)
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_lease_id ON maintenance_tickets(lease_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_vendor_id ON maintenance_tickets(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_status ON maintenance_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_vendor_id ON vendor_access_grants(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_lease_id ON vendor_access_grants(lease_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_access_grants_expires_at ON vendor_access_grants(expires_at);
    CREATE INDEX IF NOT EXISTS idx_vendor_access_logs_access_grant_id ON vendor_access_logs(access_grant_id);
    CREATE INDEX IF NOT EXISTS idx_vendor_access_logs_vendor_id ON vendor_access_logs(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_vendors_kyc_status ON vendors(kyc_status);

    -- Add vendor-related columns to existing leases table if not exists
    ALTER TABLE leases ADD COLUMN IF NOT EXISTS has_active_maintenance INTEGER DEFAULT 0;
  `);
};

exports.down = function(db) {
  return db.runSql(`
    DROP INDEX IF EXISTS idx_maintenance_tickets_lease_id;
    DROP INDEX IF EXISTS idx_maintenance_tickets_vendor_id;
    DROP INDEX IF EXISTS idx_maintenance_tickets_status;
    DROP INDEX IF EXISTS idx_vendor_access_grants_vendor_id;
    DROP INDEX IF EXISTS idx_vendor_access_grants_lease_id;
    DROP INDEX IF EXISTS idx_vendor_access_grants_expires_at;
    DROP INDEX IF EXISTS idx_vendor_access_logs_access_grant_id;
    DROP INDEX IF EXISTS idx_vendor_access_logs_vendor_id;
    DROP INDEX IF EXISTS idx_vendors_kyc_status;
    
    DROP TABLE IF EXISTS vendor_access_logs;
    DROP TABLE IF EXISTS vendor_access_grants;
    DROP TABLE IF EXISTS maintenance_tickets;
    DROP TABLE IF EXISTS vendors;
  `);
};
