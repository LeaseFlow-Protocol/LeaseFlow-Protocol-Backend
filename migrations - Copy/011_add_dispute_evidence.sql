-- Migration to add evidence management for DAO arbitration
-- Supporting Issue #95

CREATE TABLE IF NOT EXISTS dispute_evidence (
    id SERIAL PRIMARY KEY,
    dispute_id VARCHAR(255) NOT NULL, -- References rent_escrows.id or similar
    uploader_id VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    s3_key VARCHAR(512) NOT NULL,
    file_hash VARCHAR(64) NOT NULL, -- SHA-256 hash
    is_malware_scanned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for dispute lookups
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_hash ON dispute_evidence(file_hash);
