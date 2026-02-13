-- Create wallet_kyc_mappings table to store wallet-level KYC status
-- This enables real-time sync with on-chain ComplianceManager events
CREATE TABLE IF NOT EXISTS wallet_kyc_mappings (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) UNIQUE NOT NULL,
  kyc_status VARCHAR(50) DEFAULT 'pending' CHECK(kyc_status IN ('pending', 'verified', 'revoked', 'unknown')),
  risk_level VARCHAR(50) DEFAULT 'unknown' CHECK(risk_level IN ('low', 'medium', 'high', 'unknown')),
  provider VARCHAR(100),
  verification_hash VARCHAR(255),
  on_chain_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookups by wallet address
CREATE INDEX idx_wallet_kyc_mappings_wallet_address ON wallet_kyc_mappings(LOWER(wallet_address));

-- Index for querying verified wallets
CREATE INDEX idx_wallet_kyc_mappings_status ON wallet_kyc_mappings(kyc_status);