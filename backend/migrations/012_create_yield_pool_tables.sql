-- Migration: Create Yield Pool Tables
-- Description: Tables for tracking yield pool deposits and earnings

-- Table to track yield pool deposits per escrow
CREATE TABLE IF NOT EXISTS escrow_yield_deposits (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(255) NOT NULL UNIQUE,
    deposit_tx_hash VARCHAR(255) NOT NULL,
    principal_amount DECIMAL(40, 0) NOT NULL,
    asset_address VARCHAR(255) NOT NULL,
    deposited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to track yield earnings per escrow
CREATE TABLE IF NOT EXISTS escrow_yield_earnings (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(255) NOT NULL UNIQUE,
    total_yield_earned DECIMAL(40, 0) DEFAULT 0,
    seller_yield_claimed DECIMAL(40, 0) DEFAULT 0,
    platform_fee_claimed DECIMAL(40, 0) DEFAULT 0,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table to track global yield pool statistics
CREATE TABLE IF NOT EXISTS yield_pool_stats (
    id SERIAL PRIMARY KEY,
    total_deposits DECIMAL(40, 0) DEFAULT 0,
    total_yield_earned DECIMAL(40, 0) DEFAULT 0,
    total_distributed DECIMAL(40, 0) DEFAULT 0,
    total_platform_fees DECIMAL(40, 0) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize yield pool stats
INSERT INTO yield_pool_stats (total_deposits, total_yield_earned, total_distributed, total_platform_fees)
VALUES (0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_escrow_yield_deposits_invoice_id ON escrow_yield_deposits(invoice_id);
CREATE INDEX IF NOT EXISTS idx_escrow_yield_earnings_invoice_id ON escrow_yield_earnings(invoice_id);
