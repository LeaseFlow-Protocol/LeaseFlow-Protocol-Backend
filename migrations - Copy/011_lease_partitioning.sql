-- Migration 011: Implement Table Partitioning for Leases
-- Partition leases by lease_end_date to improve performance and enable cold storage

-- Step 1: Create the partitioned table structure (PostgreSQL 10+)
-- Note: This requires migrating data from the existing leases table

-- Create new partitioned leases table
CREATE TABLE IF NOT EXISTS leases_partitioned (
    id TEXT NOT NULL,
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
    updated_at TEXT NOT NULL,
    PRIMARY KEY (id, end_date)
) PARTITION BY RANGE (end_date);

-- Step 2: Create partitions for different time periods

-- Active leases partition (current and future leases - next 2 years)
CREATE TABLE IF NOT EXISTS leases_active PARTITION OF leases_partitioned
FOR VALUES FROM ('2025-01-01') TO ('2028-12-31');

-- Recent expired leases partition (warm storage - last 2 years)
CREATE TABLE IF NOT EXISTS leases_expired_recent PARTITION OF leases_partitioned
FOR VALUES FROM ('2023-01-01') TO ('2024-12-31');

-- Old expired leases partition (cold storage - before 2023)
CREATE TABLE IF NOT EXISTS leases_expired_old PARTITION OF leases_partitioned
FOR VALUES FROM ('2020-01-01') TO ('2022-12-31');

-- Future partitions (can be added as needed)
-- CREATE TABLE leases_partition_2029_2030 PARTITION OF leases_partitioned
-- FOR VALUES FROM ('2029-01-01') TO ('2030-12-31');

-- Step 3: Create indexes on each partition
CREATE INDEX IF NOT EXISTS idx_leases_part_status ON leases_partitioned(status);
CREATE INDEX IF NOT EXISTS idx_leases_part_landlord ON leases_partitioned(landlord_id);
CREATE INDEX IF NOT EXISTS idx_leases_part_tenant ON leases_partitioned(tenant_id);
CREATE INDEX IF NOT EXISTS idx_leases_part_city ON leases_partitioned(city);
CREATE INDEX IF NOT EXISTS idx_leases_part_created ON leases_partitioned(created_at);

-- Step 4: Create view that combines all partitions for backward compatibility
CREATE OR REPLACE VIEW v_all_leases AS
SELECT * FROM leases_partitioned;

-- Step 5: Create function to move expired leases to cold storage
CREATE OR REPLACE FUNCTION move_expired_leases_to_cold_storage()
RETURNS INTEGER AS $$
DECLARE
    moved_count INTEGER;
BEGIN
    -- This function would be called periodically to archive old leases
    -- In SQLite, we simulate this with a status update
    UPDATE leases 
    SET status = 'archived'
    WHERE status = 'expired' 
      AND end_date < date('now', '-2 years');
    
    GET DIAGNOSTICS moved_count = ROW_COUNT;
    RETURN moved_count;
END;
$$ LANGUAGE plpgsql;

-- For SQLite compatibility, we'll use a simpler approach
-- SQLite doesn't support native table partitioning
-- This creates the necessary indexes and views for optimization

-- Create composite index for active lease queries
CREATE INDEX IF NOT EXISTS idx_leases_active_composite 
ON leases(status, end_date) 
WHERE status = 'active';

-- Create partial index for expired leases
CREATE INDEX IF NOT EXISTS idx_leases_expired 
ON leases(end_date, status) 
WHERE status IN ('expired', 'terminated');

-- Create view for active leases (hot path - optimized)
CREATE OR REPLACE VIEW v_active_leases_optimized AS
SELECT 
    id,
    landlord_id,
    tenant_id,
    status,
    rent_amount,
    currency,
    start_date,
    end_date,
    city,
    state,
    property_type,
    bedrooms,
    created_at
FROM leases
WHERE status = 'active'
  AND disputed = 0;

-- Create view for expired leases (cold path)
CREATE OR REPLACE VIEW v_expired_leases AS
SELECT 
    id,
    landlord_id,
    tenant_id,
    status,
    rent_amount,
    end_date,
    archived_at
FROM leases
WHERE status IN ('expired', 'terminated', 'archived')
ORDER BY end_date DESC;

-- Comment on migration
COMMENT ON VIEW v_active_leases_optimized IS 'Optimized view for fast active lease queries - keeps hot path lean';
COMMENT ON VIEW v_expired_leases IS 'View for expired/terminated leases - candidates for cold storage archival';
