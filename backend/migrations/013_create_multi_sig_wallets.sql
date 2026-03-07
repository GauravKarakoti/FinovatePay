-- Multi-Sig Wallet Integration for High-Value Transactions
-- This migration adds tables for managing multi-sig wallets and their configurations

-- Table to store multi-sig wallet configurations
CREATE TABLE IF NOT EXISTS multi_sig_wallets (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(66) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    threshold INTEGER NOT NULL DEFAULT 2,
    max_value NUMERIC(78, 0) NOT NULL DEFAULT 10000000000000000000000, -- ~$10,000 in wei
    required_confirmations INTEGER NOT NULL DEFAULT 2,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(66) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table to store wallet owners
CREATE TABLE IF NOT EXISTS multi_sig_owners (
    id SERIAL PRIMARY KEY,
    wallet_id INTEGER NOT NULL REFERENCES multi_sig_wallets(id) ON DELETE CASCADE,
    owner_address VARCHAR(66) NOT NULL,
    owner_name VARCHAR(255),
    is_primary BOOLEAN NOT NULL DEFAULT false,
    added_by VARCHAR(66) NOT NULL,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_id, owner_address)
);

-- Table to track high-value transaction multi-sig approvals
CREATE TABLE IF NOT EXISTS high_value_tx_approvals (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(255) NOT NULL,
    wallet_id INTEGER REFERENCES multi_sig_wallets(id) ON DELETE SET NULL,
    escrow_id VARCHAR(255) NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    token_address VARCHAR(66),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, released, cancelled
    required_approvals INTEGER NOT NULL,
    current_approvals INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(66) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(invoice_id, escrow_id)
);

-- Table to track individual approvals
CREATE TABLE IF NOT EXISTS high_value_tx_approval_records (
    id SERIAL PRIMARY KEY,
    approval_id INTEGER NOT NULL REFERENCES high_value_tx_approvals(id) ON DELETE CASCADE,
    approver_address VARCHAR(66) NOT NULL,
    approved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    tx_hash VARCHAR(66)
);

-- Table to store admin configurations for multi-sig thresholds
CREATE TABLE IF NOT EXISTS multi_sig_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    updated_by VARCHAR(66),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration values
INSERT INTO multi_sig_config (key, value, description, updated_by) 
VALUES 
    ('default_threshold', '10000000000000000000000', 'Default threshold for high-value transactions (in wei)', 'system'),
    ('default_required_confirmations', '2', 'Default number of required confirmations', 'system'),
    ('high_value_enabled', 'true', 'Enable/disable high-value multi-sig requirement', 'system')
ON CONFLICT (key) DO NOTHING;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_high_value_tx_approvals_invoice ON high_value_tx_approvals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_high_value_tx_approvals_status ON high_value_tx_approvals(status);
CREATE INDEX IF NOT EXISTS idx_multi_sig_owners_wallet ON multi_sig_owners(wallet_id);
CREATE INDEX IF NOT EXISTS idx_multi_sig_owners_address ON multi_sig_owners(owner_address);

