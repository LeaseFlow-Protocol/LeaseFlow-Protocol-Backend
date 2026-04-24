-- Migration 010: Add location and property details for market analytics
-- This enables Market Trends feature with city/region-based aggregation

-- Add location column to leases table if not exists
ALTER TABLE leases ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Nigeria';

-- Add property details columns
ALTER TABLE leases ADD COLUMN IF NOT EXISTS property_type TEXT;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS bedrooms INTEGER;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS bathrooms INTEGER;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS square_footage INTEGER;

-- Create indexes for market trends queries
CREATE INDEX IF NOT EXISTS idx_leases_city ON leases(city);
CREATE INDEX IF NOT EXISTS idx_leases_state ON leases(state);
CREATE INDEX IF NOT EXISTS idx_leases_country ON leases(country);
CREATE INDEX IF NOT EXISTS idx_leases_property_type ON leases(property_type);
CREATE INDEX IF NOT EXISTS idx_leases_bedrooms ON leases(bedrooms);

-- Add created_at index for historical analysis
CREATE INDEX IF NOT EXISTS idx_leases_created_at ON leases(created_at);

-- Create view for active leases (used by market trends service)
CREATE VIEW IF NOT EXISTS v_active_leases_with_location AS
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
    country,
    property_type,
    bedrooms,
    bathrooms,
    square_footage,
    created_at,
    updated_at
FROM leases
WHERE status = 'active'
  AND disputed = 0;

-- Comment describing the migration
COMMENT ON VIEW v_active_leases_with_location IS 'Anonymized active leases with location data for market trends analytics';
