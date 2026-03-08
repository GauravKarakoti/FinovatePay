-- Migration: Create Proxy Tracking Tables
-- Description: Tables for tracking proxy contract deployments and upgrades
-- Created for UUPS upgradeable proxy pattern support

-- Proxy Contracts Table
CREATE TABLE IF NOT EXISTS proxy_contracts (
    id SERIAL PRIMARY KEY,
    contract_name VARCHAR(100) NOT NULL UNIQUE,
    proxy_address VARCHAR(66) NOT NULL,
    implementation_address VARCHAR(66) NOT NULL,
    deployer_address VARCHAR(66) NOT NULL,
    admin_address VARCHAR(66) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    deployed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    CONSTRAINT valid_proxy_address CHECK (proxy_address ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT valid_implementation_address CHECK (implementation_address ~ '^0x[a-fA-F0-9]{40}$')
);

-- Proxy Upgrade History Table
CREATE TABLE IF NOT EXISTS proxy_upgrade_history (
    id SERIAL PRIMARY KEY,
    proxy_address VARCHAR(66) NOT NULL,
    contract_name VARCHAR(100) NOT NULL,
    old_implementation VARCHAR(66),
    new_implementation VARCHAR(66) NOT NULL,
    previous_version INTEGER NOT NULL,
    new_version INTEGER NOT NULL,
    upgraded_by VARCHAR(66) NOT NULL,
    upgrade_reason TEXT,
    tx_hash VARCHAR(66),
    upgraded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_proxy_address CHECK (proxy_address ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT valid_new_implementation CHECK (new_implementation ~ '^0x[a-fA-F0-9]{40}$'),
    FOREIGN KEY (contract_name) REFERENCES proxy_contracts(contract_name) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX idx_proxy_contracts_name ON proxy_contracts(contract_name);
CREATE INDEX idx_proxy_contracts_address ON proxy_contracts(proxy_address);
CREATE INDEX idx_proxy_contracts_active ON proxy_contracts(is_active);
CREATE INDEX idx_proxy_upgrade_history_proxy ON proxy_upgrade_history(proxy_address);
CREATE INDEX idx_proxy_upgrade_history_contract ON proxy_upgrade_history(contract_name);
CREATE INDEX idx_proxy_upgrade_history_date ON proxy_upgrade_history(upgraded_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE TRIGGER update_proxy_contracts_updated_at
    BEFORE UPDATE ON proxy_contracts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert initial proxy configuration (example - will be updated on deployment)
-- Note: These are placeholder addresses that will be replaced after deployment

COMMENT ON TABLE proxy_contracts IS 'Tracks deployed UUPS proxy contracts and their current state';
COMMENT ON TABLE proxy_upgrade_history IS 'Maintains history of all proxy upgrades for audit purposes';

