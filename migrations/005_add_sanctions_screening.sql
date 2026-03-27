-- Sanctions screening related tables

-- Table to store sanctions violations log
CREATE TABLE IF NOT EXISTS sanctions_violations (
    id SERIAL PRIMARY KEY,
    lease_id VARCHAR(255) NOT NULL,
    violation_type VARCHAR(50) NOT NULL, -- 'landlord' or 'tenant'
    address VARCHAR(255) NOT NULL,
    sanctions_source VARCHAR(50) NOT NULL, -- 'OFAC', 'EU', 'UK'
    sanctions_name TEXT,
    sanctions_programs TEXT[],
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'ACTIVE', -- 'ACTIVE', 'RESOLVED', 'FALSE_POSITIVE'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to store lease freeze events
CREATE TABLE IF NOT EXISTS lease_freeze_events (
    id SERIAL PRIMARY KEY,
    lease_id VARCHAR(255) NOT NULL,
    freeze_reason VARCHAR(100) NOT NULL,
    freeze_details JSONB,
    frozen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    unfrozen_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'FROZEN', -- 'FROZEN', 'UNFROZEN'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to cache sanctions lists for performance
CREATE TABLE IF NOT EXISTS sanctions_cache (
    id SERIAL PRIMARY KEY,
    address VARCHAR(255) NOT NULL UNIQUE,
    source VARCHAR(50) NOT NULL,
    name TEXT,
    type VARCHAR(100),
    programs TEXT[],
    regulation VARCHAR(255),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add sanctions status to leases table if not exists
ALTER TABLE leases 
ADD COLUMN IF NOT EXISTS sanctions_status VARCHAR(50) DEFAULT 'CLEAN',
ADD COLUMN IF NOT EXISTS sanctions_check_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sanctions_violation_count INTEGER DEFAULT 0;

-- Add sanctions pause status to payment schedules
ALTER TABLE payment_schedules
ADD COLUMN IF NOT EXISTS sanctions_paused BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sanctions_pause_reason TEXT,
ADD COLUMN IF NOT EXISTS sanctions_paused_at TIMESTAMP WITH TIME ZONE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sanctions_violations_lease_id ON sanctions_violations(lease_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_violations_address ON sanctions_violations(address);
CREATE INDEX IF NOT EXISTS idx_sanctions_violations_status ON sanctions_violations(status);
CREATE INDEX IF NOT EXISTS idx_lease_freeze_events_lease_id ON lease_freeze_events(lease_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_cache_address ON sanctions_cache(address);
CREATE INDEX IF NOT EXISTS idx_sanctions_cache_source ON sanctions_cache(source);
CREATE INDEX IF NOT EXISTS idx_sanctions_cache_expires_at ON sanctions_cache(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_sanctions_violations_updated_at 
    BEFORE UPDATE ON sanctions_violations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_lease_freeze_events_updated_at 
    BEFORE UPDATE ON lease_freeze_events 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sanctions_cache_updated_at 
    BEFORE UPDATE ON sanctions_cache 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
