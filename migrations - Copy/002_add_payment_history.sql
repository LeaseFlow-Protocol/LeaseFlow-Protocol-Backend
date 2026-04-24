-- Migration: Add payment_history table and extend leases with payment tracking columns
-- Issue #16: Real-Time Rent Payment Tracker

-- payment_history stores every detected Horizon payment event
CREATE TABLE IF NOT EXISTS payment_history (
  id               TEXT PRIMARY KEY,
  horizon_op_id    TEXT NOT NULL UNIQUE,
  lease_id         TEXT,
  tenant_account_id TEXT NOT NULL,
  amount           TEXT NOT NULL,
  asset_code       TEXT NOT NULL DEFAULT 'XLM',
  asset_issuer     TEXT,
  transaction_hash TEXT NOT NULL,
  paid_at          TEXT NOT NULL,
  recorded_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_history_lease_id
  ON payment_history (lease_id);

CREATE INDEX IF NOT EXISTS idx_payment_history_tenant_account
  ON payment_history (tenant_account_id);

CREATE INDEX IF NOT EXISTS idx_payment_history_paid_at
  ON payment_history (paid_at DESC);

-- Extend leases table with payment-tracking columns
ALTER TABLE leases ADD COLUMN IF NOT EXISTS tenant_account_id TEXT;
ALTER TABLE leases ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE leases ADD COLUMN IF NOT EXISTS last_payment_at TEXT;
