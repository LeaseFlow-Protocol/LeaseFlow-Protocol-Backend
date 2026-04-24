-- Migration to add lease hierarchy support
-- This enables tracking of complex, multi-tiered rental structures (e.g., A -> B -> C)

-- Ensure the leases table exists in Postgres (syncing with SQLite schema if needed)
CREATE TABLE IF NOT EXISTS leases (
    id VARCHAR(255) PRIMARY KEY,
    landlord_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    rent_amount BIGINT NOT NULL,
    currency VARCHAR(10) NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    renewable BOOLEAN NOT NULL DEFAULT TRUE,
    disputed BOOLEAN NOT NULL DEFAULT FALSE,
    parent_lease_id VARCHAR(255) REFERENCES leases(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add parent_lease_id if table already exists but column doesn't
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leases' AND column_name='parent_lease_id') THEN
        ALTER TABLE leases ADD COLUMN parent_lease_id VARCHAR(255) REFERENCES leases(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Create index for hierarchical lookups
CREATE INDEX IF NOT EXISTS idx_leases_parent_lease_id ON leases(parent_lease_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
