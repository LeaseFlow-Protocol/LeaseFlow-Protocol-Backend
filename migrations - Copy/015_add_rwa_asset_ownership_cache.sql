-- Migration: Add RWA Asset Ownership Cache tables
-- This migration adds support for caching real-world asset ownership states
-- from external RWA Registry contracts on the Stellar network

-- Main asset ownership cache table
CREATE TABLE IF NOT EXISTS asset_ownership_cache (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    owner_pubkey TEXT NOT NULL,
    rwa_contract_address TEXT NOT NULL,
    rwa_standard TEXT NOT NULL, -- e.g., 'stellar-asset', 'tokenized-realty', 'vehicle-registry'
    asset_type TEXT NOT NULL, -- 'real_estate', 'vehicle', 'commodity', etc.
    is_frozen INTEGER DEFAULT 0 CHECK (is_frozen IN (0, 1)),
    is_burned INTEGER DEFAULT 0 CHECK (is_burned IN (0, 1)),
    transfer_count INTEGER DEFAULT 0,
    last_transfer_hash TEXT,
    last_transfer_at TEXT,
    cache_updated_at TEXT NOT NULL,
    blockchain_verified_at TEXT,
    cache_ttl_minutes INTEGER DEFAULT 10,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_asset_id ON asset_ownership_cache(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_owner_pubkey ON asset_ownership_cache(owner_pubkey);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_contract_address ON asset_ownership_cache(rwa_contract_address);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_standard ON asset_ownership_cache(rwa_standard);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_frozen ON asset_ownership_cache(is_frozen);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_burned ON asset_ownership_cache(is_burned);
CREATE INDEX IF NOT EXISTS idx_asset_ownership_cache_updated_at ON asset_ownership_cache(cache_updated_at);

-- RWA contract registry table - tracks which contracts to monitor
CREATE TABLE IF NOT EXISTS rwa_contract_registry (
    id TEXT PRIMARY KEY,
    contract_address TEXT NOT NULL UNIQUE,
    contract_name TEXT NOT NULL,
    rwa_standard TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'testnet', -- 'testnet', 'public', 'future'
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    monitoring_enabled INTEGER DEFAULT 1 CHECK (monitoring_enabled IN (0, 1)),
    last_event_cursor TEXT,
    last_sync_at TEXT,
    sync_interval_minutes INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes for contract registry
CREATE INDEX IF NOT EXISTS idx_rwa_contract_registry_address ON rwa_contract_registry(contract_address);
CREATE INDEX IF NOT EXISTS idx_rwa_contract_registry_standard ON rwa_contract_registry(rwa_standard);
CREATE INDEX IF NOT EXISTS idx_rwa_contract_registry_active ON rwa_contract_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_rwa_contract_registry_monitoring ON rwa_contract_registry(monitoring_enabled);

-- Asset transfer events log table
CREATE TABLE IF NOT EXISTS asset_transfer_events (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE, -- Stellar transaction hash + event index
    asset_id TEXT NOT NULL,
    from_owner_pubkey TEXT NOT NULL,
    to_owner_pubkey TEXT NOT NULL,
    rwa_contract_address TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ledger_sequence INTEGER NOT NULL,
    operation_index INTEGER NOT NULL,
    event_type TEXT NOT NULL, -- 'transfer', 'mint', 'burn', 'freeze', 'unfreeze'
    event_data TEXT, -- JSON blob with additional event data
    processed_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (asset_id, rwa_contract_address) REFERENCES asset_ownership_cache(asset_id, rwa_contract_address) ON UPDATE CASCADE
);

-- Indexes for transfer events
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_asset_id ON asset_transfer_events(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_from_owner ON asset_transfer_events(from_owner_pubkey);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_to_owner ON asset_transfer_events(to_owner_pubkey);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_contract ON asset_transfer_events(rwa_contract_address);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_tx_hash ON asset_transfer_events(transaction_hash);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_ledger ON asset_transfer_events(ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_type ON asset_transfer_events(event_type);
CREATE INDEX IF NOT EXISTS idx_asset_transfer_events_processed_at ON asset_transfer_events(processed_at);

-- Cache sync status table
CREATE TABLE IF NOT EXISTS rwa_cache_sync_status (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    last_sync_at TEXT,
    last_successful_sync_at TEXT,
    total_assets_cached INTEGER DEFAULT 0,
    active_contracts_monitored INTEGER DEFAULT 0,
    sync_errors_count INTEGER DEFAULT 0,
    last_error_message TEXT,
    sync_duration_ms INTEGER,
    next_sync_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Performance metrics table
CREATE TABLE IF NOT EXISTS rwa_cache_performance_metrics (
    id TEXT PRIMARY KEY,
    metric_date TEXT NOT NULL, -- YYYY-MM-DD format
    total_queries INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    cache_misses INTEGER DEFAULT 0,
    blockchain_fallbacks INTEGER DEFAULT 0,
    avg_query_time_ms REAL DEFAULT 0,
    avg_sync_time_ms REAL DEFAULT 0,
    total_sync_errors INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Indexes for performance metrics
CREATE INDEX IF NOT EXISTS idx_rwa_cache_performance_date ON rwa_cache_performance_metrics(metric_date);

-- Insert initial sync status record
INSERT OR IGNORE INTO rwa_cache_sync_status (
    id, 
    created_at, 
    updated_at
) VALUES (
    'singleton',
    datetime('now'),
    datetime('now')
);

-- Create triggers for automatic timestamp updates
CREATE TRIGGER IF NOT EXISTS update_asset_ownership_cache_updated_at
    AFTER UPDATE ON asset_ownership_cache
    FOR EACH ROW
BEGIN
    UPDATE asset_ownership_cache SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_rwa_contract_registry_updated_at
    AFTER UPDATE ON rwa_contract_registry
    FOR EACH ROW
BEGIN
    UPDATE rwa_contract_registry SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_rwa_cache_sync_status_updated_at
    AFTER UPDATE ON rwa_cache_sync_status
    FOR EACH ROW
BEGIN
    UPDATE rwa_cache_sync_status SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Sample RWA contracts for testing (can be removed in production)
INSERT OR IGNORE INTO rwa_contract_registry (
    id,
    contract_address,
    contract_name,
    rwa_standard,
    asset_type,
    network,
    created_at,
    updated_at
) VALUES 
(
    'stellar-asset-test-1',
    'GBL...TEST_CONTRACT_1',
    'Stellar Asset Tokenizer',
    'stellar-asset',
    'real_estate',
    'testnet',
    datetime('now'),
    datetime('now')
),
(
    'tokenized-realty-test-1',
    'GBL...TEST_CONTRACT_2',
    'Tokenized Realty Registry',
    'tokenized-realty',
    'real_estate',
    'testnet',
    datetime('now'),
    datetime('now')
),
(
    'vehicle-registry-test-1',
    'GBL...TEST_CONTRACT_3',
    'Vehicle Token Registry',
    'vehicle-registry',
    'vehicle',
    'testnet',
    datetime('now'),
    datetime('now')
);

-- Sample asset ownership cache entries for testing
INSERT OR IGNORE INTO asset_ownership_cache (
    id,
    asset_id,
    owner_pubkey,
    rwa_contract_address,
    rwa_standard,
    asset_type,
    is_frozen,
    is_burned,
    transfer_count,
    cache_updated_at,
    blockchain_verified_at,
    created_at,
    updated_at
) VALUES 
(
    'test-asset-1',
    'REAL_ESTATE_TOKEN_001',
    'GBL...OWNER_1',
    'GBL...TEST_CONTRACT_1',
    'stellar-asset',
    'real_estate',
    0,
    0,
    1,
    datetime('now'),
    datetime('now'),
    datetime('now'),
    datetime('now')
),
(
    'test-asset-2',
    'VEHICLE_TOKEN_001',
    'GBL...OWNER_2',
    'GBL...TEST_CONTRACT_3',
    'vehicle-registry',
    'vehicle',
    0,
    0,
    1,
    datetime('now'),
    datetime('now'),
    datetime('now'),
    datetime('now')
);
