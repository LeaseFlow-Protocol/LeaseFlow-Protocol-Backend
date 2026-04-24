-- Migration 016: Add Abandoned Asset Tracking Fields
-- Add last_interaction_timestamp to track lease activity for 30-day abandonment countdown

-- Add last_interaction_timestamp field to leases table
ALTER TABLE leases ADD COLUMN last_interaction_timestamp TEXT;

-- Add abandonment_status field to track the state of abandonment process
ALTER TABLE leases ADD COLUMN abandonment_status TEXT DEFAULT 'active';

-- Add abandonment_alert_sent field to track if alert has been sent
ALTER TABLE leases ADD COLUMN abandonment_alert_sent INTEGER DEFAULT 0;

-- Create index for efficient querying of abandoned assets
CREATE INDEX IF NOT EXISTS idx_leases_last_interaction ON leases(last_interaction_timestamp);

-- Create index for abandonment status queries
CREATE INDEX IF NOT EXISTS idx_leases_abandonment_status ON leases(abandonment_status);

-- Create index for finding leases ready for seizure alert (SQLite doesn't support partial indexes)
CREATE INDEX IF NOT EXISTS idx_leases_abandonment_alert ON leases(abandonment_status, abandonment_alert_sent, last_interaction_timestamp);

-- Create trigger to automatically update last_interaction_timestamp on lease updates (SQLite compatible)
CREATE TRIGGER update_lease_interaction_timestamp
    BEFORE UPDATE ON leases
    FOR EACH ROW
    WHEN (
        OLD.status IS DISTINCT FROM NEW.status OR
        OLD.payment_status IS DISTINCT FROM NEW.payment_status OR
        OLD.disputed IS DISTINCT FROM NEW.disputed
    )
BEGIN
    -- Update last_interaction_timestamp when lease is updated
    UPDATE leases SET last_interaction_timestamp = datetime('now') WHERE id = NEW.id;
END;

-- Initialize last_interaction_timestamp for existing leases
UPDATE leases 
SET last_interaction_timestamp = updated_at
WHERE last_interaction_timestamp IS NULL;

-- Create view for abandoned assets tracking
CREATE OR REPLACE VIEW v_abandoned_assets AS
SELECT 
    id,
    landlord_id,
    tenant_id,
    status,
    rent_amount,
    currency,
    end_date,
    last_interaction_timestamp,
    abandonment_status,
    abandonment_alert_sent,
    -- Calculate days since last interaction
    (julianday('now') - julianday(last_interaction_timestamp)) as days_since_last_interaction,
    -- Calculate remaining days until 30-day threshold
    (30 - (julianday('now') - julianday(last_interaction_timestamp))) as remaining_days,
    -- Check if ready for seizure (30 days passed)
    CASE 
        WHEN (julianday('now') - julianday(last_interaction_timestamp)) >= 30 THEN 1
        ELSE 0
    END as ready_for_seizure
FROM leases
WHERE status IN ('expired', 'terminated')
  AND abandonment_status != 'seized'
ORDER BY last_interaction_timestamp ASC;

-- Comment on migration
COMMENT ON COLUMN leases.last_interaction_timestamp IS 'Timestamp of last lease interaction - used for 30-day abandonment countdown';
COMMENT ON COLUMN leases.abandonment_status IS 'Status of abandonment process: active, pending_seizure, seized';
COMMENT ON COLUMN leases.abandonment_alert_sent IS 'Flag indicating if seizure alert has been sent to lessor';
COMMENT ON VIEW v_abandoned_assets IS 'View for tracking abandoned assets and countdown to seizure eligibility';
