-- Insurance Policies Table
-- Stores insurance policies for escrow transactions

CREATE TABLE IF NOT EXISTS insurance_policies (
    id SERIAL PRIMARY KEY,
    policy_id VARCHAR(66) UNIQUE NOT NULL,
    invoice_id VARCHAR(66) NOT NULL,
    insured_address VARCHAR(42) NOT NULL,
    coverage_amount VARCHAR(78) NOT NULL,
    premium_paid VARCHAR(78) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'claimed', 'expired', 'cancelled')),
    claim_approved BOOLEAN DEFAULT FALSE,
    claim_amount VARCHAR(78),
    claim_reason VARCHAR(30),
    claim_evidence TEXT,
    claim_tx_hash VARCHAR(66),
    payout_tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_insurance_policy_id ON insurance_policies(policy_id);
CREATE INDEX IF NOT EXISTS idx_insurance_invoice_id ON insurance_policies(invoice_id);
CREATE INDEX IF NOT EXISTS idx_insurance_insured ON insurance_policies(insured_address);
CREATE INDEX IF NOT EXISTS idx_insurance_status ON insurance_policies(status);
CREATE INDEX IF NOT EXISTS idx_insurance_created ON insurance_policies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_end_time ON insurance_policies(end_time);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_insurance_updated_at
    BEFORE UPDATE ON insurance_policies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insurance Claims Table
-- Stores claim history for audit purposes

CREATE TABLE IF NOT EXISTS insurance_claims (
    id SERIAL PRIMARY KEY,
    claim_id VARCHAR(66) UNIQUE NOT NULL,
    policy_id VARCHAR(66) NOT NULL REFERENCES insurance_policies(policy_id) ON DELETE CASCADE,
    invoice_id VARCHAR(66) NOT NULL,
    claimant_address VARCHAR(42) NOT NULL,
    reason VARCHAR(30) NOT NULL CHECK (reason IN ('counterparty_default', 'smart_contract_failure', 'force_majeure')),
    evidence TEXT,
    requested_amount VARCHAR(78) NOT NULL,
    approved_amount VARCHAR(78),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    reviewer_address VARCHAR(42),
    review_notes TEXT,
    tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for claims
CREATE INDEX IF NOT EXISTS idx_claims_policy ON insurance_claims(policy_id);
CREATE INDEX IF NOT EXISTS idx_claims_claimant ON insurance_claims(claimant_address);
CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_created ON insurance_claims(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_claims_updated_at
    BEFORE UPDATE ON insurance_claims
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insurance Premiums Configuration Table
-- Stores premium configuration for different coverage tiers

CREATE TABLE IF NOT EXISTS insurance_config (
    id SERIAL PRIMARY KEY,
    tier_name VARCHAR(30) UNIQUE NOT NULL,
    base_premium_bps INTEGER NOT NULL CHECK (base_premium_bps >= 0 AND base_premium_bps <= 10000),
    duration_multiplier_bps INTEGER NOT NULL CHECK (duration_multiplier_bps >= 0 AND duration_multiplier_bps <= 10000),
    min_coverage VARCHAR(78) NOT NULL,
    max_coverage VARCHAR(78) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default insurance configuration
INSERT INTO insurance_config (tier_name, base_premium_bps, duration_multiplier_bps, min_coverage, max_coverage, is_active)
VALUES ('standard', 200, 50, '100', '1000000', TRUE)
ON CONFLICT (tier_name) DO NOTHING;

COMMENT ON TABLE insurance_policies IS 'Stores insurance policies for escrow transactions protecting against counterparty default or smart contract failure';
COMMENT ON TABLE insurance_claims IS 'Stores claim history for insurance policies';
COMMENT ON TABLE insurance_config IS 'Stores premium configuration for insurance tiers';
COMMENT ON COLUMN insurance_policies.status IS 'Status of the insurance policy: active, claimed, expired, or cancelled';
COMMENT ON COLUMN insurance_claims.reason IS 'Reason for the insurance claim';
