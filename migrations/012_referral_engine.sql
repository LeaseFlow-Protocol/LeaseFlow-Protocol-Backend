-- Migration 012: Referral Engine Implementation
-- Tracks referrals, conversions, and protocol fee waivers

-- Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL, -- Landlord who referred
    referrer_type TEXT NOT NULL DEFAULT 'landlord', -- landlord or tenant
    referee_id TEXT, -- New landlord/tenant who was referred
    referee_type TEXT DEFAULT 'landlord',
    referral_code TEXT NOT NULL UNIQUE,
    referral_link TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, converted, expired, revoked
    property_listed INTEGER DEFAULT 0, -- Whether referee listed a property
    property_id TEXT, -- ID of listed property (if applicable)
    lease_signed INTEGER DEFAULT 0, -- Whether a lease was signed
    lease_id TEXT, -- ID of signed lease (if applicable)
    fee_waiver_amount INTEGER DEFAULT 0, -- Amount waived in USDC cents
    fee_waiver_months INTEGER DEFAULT 1, -- Number of months waived
    referral_bonus_paid INTEGER DEFAULT 0, -- Whether bonus was paid to referrer
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    converted_at TEXT,
    updated_at TEXT NOT NULL,
    
    FOREIGN KEY (property_id) REFERENCES properties(id),
    FOREIGN KEY (lease_id) REFERENCES leases(id)
);

-- Create referral_rewards table for tracking rewards and waivers
CREATE TABLE IF NOT EXISTS referral_rewards (
    id TEXT PRIMARY KEY,
    referral_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL, -- Who receives the reward
    recipient_type TEXT NOT NULL, -- referrer or referee
    reward_type TEXT NOT NULL, -- fee_waiver, cash_bonus, credit
    amount INTEGER NOT NULL, -- Amount in USDC cents
    currency TEXT DEFAULT 'USDC',
    status TEXT NOT NULL DEFAULT 'pending', -- pending, applied, paid, revoked
    description TEXT,
    metadata TEXT, -- JSON metadata about the reward
    soroban_transaction_hash TEXT, -- On-chain transaction if applicable
    created_at TEXT NOT NULL,
    applied_at TEXT,
    updated_at TEXT NOT NULL,
    
    FOREIGN KEY (referral_id) REFERENCES referrals(id)
);

-- Create referral_program_config table
CREATE TABLE IF NOT EXISTS referral_program_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    referrer_reward_months INTEGER DEFAULT 1, -- Months of protocol fee waived
    referee_reward_months INTEGER DEFAULT 1, -- Months for referee
    max_referrals_per_user INTEGER DEFAULT 10,
    referral_expiry_days INTEGER DEFAULT 90, -- Days until referral code expires
    min_property_value INTEGER DEFAULT 0, -- Minimum property value to qualify
    enabled INTEGER DEFAULT 1,
    terms_url TEXT,
    updated_at TEXT NOT NULL
);

-- Insert default configuration
INSERT OR REPLACE INTO referral_program_config (
    id, referrer_reward_months, referee_reward_months, 
    max_referrals_per_user, referral_expiry_days, enabled, updated_at
) VALUES (
    'default', 1, 1, 10, 90, 1, datetime('now')
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_recipient ON referral_rewards(recipient_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referral ON referral_rewards(referral_id);

-- Create view for active referrals
CREATE VIEW IF NOT EXISTS v_active_referrals AS
SELECT 
    r.id,
    r.referrer_id,
    r.referrer_type,
    r.referee_id,
    r.referee_type,
    r.referral_code,
    r.status,
    r.property_listed,
    r.lease_signed,
    r.fee_waiver_amount,
    r.created_at,
    r.expires_at
FROM referrals r
WHERE r.status IN ('pending', 'converted')
  AND r.expires_at > datetime('now');

-- Create view for referral statistics
CREATE VIEW IF NOT EXISTS v_referral_stats AS
SELECT 
    referrer_id,
    COUNT(*) as total_referrals,
    SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted_referrals,
    SUM(fee_waiver_amount) as total_waived,
    SUM(referral_bonus_paid) as bonuses_paid
FROM referrals
GROUP BY referrer_id;

-- Comment on tables
COMMENT ON TABLE referrals IS 'Tracks referral relationships and conversion status';
COMMENT ON TABLE referral_rewards IS 'Records fee waivers and bonuses from referrals';
COMMENT ON TABLE referral_program_config IS 'Configuration for referral program rules';
