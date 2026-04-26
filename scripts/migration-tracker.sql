-- Migration tracking table schema
-- This table tracks which migrations have been applied to prevent re-execution

CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    execution_time_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error_message TEXT,
    locked_by VARCHAR(255),
    locked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_version UNIQUE (version)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_locked_by ON schema_migrations(locked_by) WHERE locked_by IS NOT NULL;

-- Create advisory lock function for distributed locking
CREATE OR REPLACE FUNCTION try_acquire_migration_lock(lock_key VARCHAR(255), pod_id VARCHAR(255))
RETURNS BOOLEAN AS $$
DECLARE
    lock_acquired BOOLEAN;
BEGIN
    -- Try to acquire an advisory lock using PostgreSQL's advisory lock mechanism
    -- This prevents race conditions when multiple pods try to run migrations simultaneously
    SELECT pg_try_advisory_lock(hashtext(lock_key)) INTO lock_acquired;
    
    IF lock_acquired THEN
        -- Update the migration tracking table with lock information
        UPDATE schema_migrations
        SET locked_by = pod_id,
            locked_at = CURRENT_TIMESTAMP
        WHERE version = lock_key;
        
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to release migration lock
CREATE OR REPLACE FUNCTION release_migration_lock(lock_key VARCHAR(255), pod_id VARCHAR(255))
RETURNS BOOLEAN AS $$
DECLARE
    lock_released BOOLEAN;
BEGIN
    -- Release the advisory lock
    SELECT pg_advisory_unlock(hashtext(lock_key)) INTO lock_released;
    
    -- Clear the lock information from the tracking table
    UPDATE schema_migrations
    SET locked_by = NULL,
        locked_at = NULL
    WHERE version = lock_key AND locked_by = pod_id;
    
    RETURN lock_released;
END;
$$ LANGUAGE plpgsql;

-- Create function to check if a migration has been applied
CREATE OR REPLACE FUNCTION is_migration_applied(version VARCHAR(255))
RETURNS BOOLEAN AS $$
DECLARE
    applied BOOLEAN;
BEGIN
    SELECT COALESCE(MAX(success), FALSE) INTO applied
    FROM schema_migrations
    WHERE version = version;
    
    RETURN applied;
END;
$$ LANGUAGE plpgsql;

-- Create function to record migration execution
CREATE OR REPLACE FUNCTION record_migration(
    version VARCHAR(255,
    name VARCHAR(255,
    checksum VARCHAR(64,
    success BOOLEAN,
    execution_time_ms INTEGER,
    error_message TEXT DEFAULT NULL,
    pod_id VARCHAR(255 DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO schema_migrations (version, name, checksum, success, execution_time_ms, error_message, locked_by)
    VALUES (version, name, checksum, success, execution_time_ms, error_message, pod_id)
    ON CONFLICT (version) DO UPDATE SET
        name = EXCLUDED.name,
        checksum = EXCLUDED.checksum,
        success = EXCLUDED.success,
        execution_time_ms = EXCLUDED.execution_time_ms,
        error_message = EXCLUDED.error_message,
        applied_at = CURRENT_TIMESTAMP,
        locked_by = EXCLUDED.locked_by;
END;
$$ LANGUAGE plpgsql;

-- Create function to get migration lock status
CREATE OR REPLACE FUNCTION get_migration_lock_status(lock_key VARCHAR(255))
RETURNS TABLE(locked BOOLEAN, locked_by VARCHAR(255), locked_at TIMESTAMP WITH TIME ZONE) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE WHEN locked_by IS NOT NULL THEN TRUE ELSE FALSE END AS locked,
        locked_by,
        locked_at
    FROM schema_migrations
    WHERE version = lock_key;
END;
$$ LANGUAGE plpgsql;
