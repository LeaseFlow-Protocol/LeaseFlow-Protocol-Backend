-- Migration: Add lease PDF records table and related columns
-- This migration adds support for storing PDF lease agreement metadata and IPFS CIDs

-- Add PDF-related columns to leases table (if not already present)
ALTER TABLE leases ADD COLUMN pdf_cid TEXT;
ALTER TABLE leases ADD COLUMN pdf_generated_at TEXT;
ALTER TABLE leases ADD COLUMN transaction_hash TEXT;

-- Create dedicated table for PDF generation records
CREATE TABLE IF NOT EXISTS lease_pdf_records (
    lease_id TEXT PRIMARY KEY,
    ipfs_cid TEXT NOT NULL,
    transaction_hash TEXT,
    generated_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'pending', 'regenerating')),
    error_message TEXT,
    pdf_size INTEGER,
    generation_time_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_lease_pdf_records_cid ON lease_pdf_records(ipfs_cid);
CREATE INDEX IF NOT EXISTS idx_lease_pdf_records_status ON lease_pdf_records(status);
CREATE INDEX IF NOT EXISTS idx_lease_pdf_records_generated_at ON lease_pdf_records(generated_at);
CREATE INDEX IF NOT EXISTS idx_lease_pdf_records_updated_at ON lease_pdf_records(updated_at);

-- Add index for leases.pdf_cid if column exists
CREATE INDEX IF NOT EXISTS idx_leases_pdf_cid ON leases(pdf_cid);

-- Create table for PDF generation job tracking (optional, for detailed monitoring)
CREATE TABLE IF NOT EXISTS pdf_generation_jobs (
    job_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed', 'cancelled')),
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    progress INTEGER DEFAULT 0,
    ipfs_cid TEXT,
    pdf_size INTEGER,
    worker_id TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    retry_count INTEGER DEFAULT 0,
    FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
);

-- Create indexes for job tracking
CREATE INDEX IF NOT EXISTS idx_pdf_generation_jobs_lease_id ON pdf_generation_jobs(lease_id);
CREATE INDEX IF NOT EXISTS idx_pdf_generation_jobs_status ON pdf_generation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pdf_generation_jobs_created_at ON pdf_generation_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_pdf_generation_jobs_priority ON pdf_generation_jobs(priority);

-- Insert sample data for testing (optional)
-- This can be removed in production
INSERT OR IGNORE INTO lease_pdf_records (
    lease_id, 
    ipfs_cid, 
    transaction_hash, 
    generated_at, 
    updated_at, 
    status,
    pdf_size
) VALUES (
    'sample-lease-123',
    'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy3fb6i64',
    '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    datetime('now'),
    datetime('now'),
    'completed',
    245760
);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_lease_pdf_records_updated_at
    AFTER UPDATE ON lease_pdf_records
    FOR EACH ROW
BEGIN
    UPDATE lease_pdf_records SET updated_at = datetime('now') WHERE lease_id = NEW.lease_id;
END;

-- Create a trigger to automatically update the updated_at timestamp for jobs
CREATE TRIGGER IF NOT EXISTS update_pdf_generation_jobs_updated_at
    AFTER UPDATE ON pdf_generation_jobs
    FOR EACH ROW
BEGIN
    UPDATE pdf_generation_jobs SET completed_at = 
        CASE 
            WHEN NEW.status IN ('completed', 'failed', 'cancelled') THEN datetime('now')
            ELSE OLD.completed_at
        END
    WHERE job_id = NEW.job_id;
END;
