-- Migration for Multi-Sig Invitation System
-- Supporting Issue #97

CREATE TABLE IF NOT EXISTS lease_invitations (
    id SERIAL PRIMARY KEY,
    lease_id VARCHAR(255) NOT NULL,
    inviter_id VARCHAR(255) NOT NULL,
    invitee_identifier VARCHAR(255) NOT NULL, -- Email or Pubkey
    token VARCHAR(64) UNIQUE NOT NULL, -- Cryptographically secure invitation token
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED')),
    percentage_share INTEGER NOT NULL DEFAULT 0, -- Requested fractional share
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lease_invitations_token ON lease_invitations(token);
CREATE INDEX IF NOT EXISTS idx_lease_invitations_lease_id ON lease_invitations(lease_id);
