-- Migration: Create meta_transactions table for gasless transaction tracking
-- Description: Stores meta-transaction data including gas costs and user tracking

CREATE TABLE IF NOT EXISTS meta_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tx_hash VARCHAR(66) NOT NULL UNIQUE,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    gas_used BIGINT,
    gas_price BIGINT,
    gas_cost_matic DECIMAL(20, 8),
    gas_cost_usd DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_meta_tx_user ON meta_transactions(user_id);
CREATE INDEX idx_meta_tx_hash ON meta_transactions(tx_hash);
CREATE INDEX idx_meta_tx_status ON meta_transactions(status);
CREATE INDEX idx_meta_tx_created_at ON meta_transactions(created_at);

-- Create user_gas_usage table for daily gas limit tracking
CREATE TABLE IF NOT EXISTS user_gas_usage (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    daily_gas_used BIGINT DEFAULT 0,
    daily_gas_limit BIGINT DEFAULT 1000000,
    last_reset TIMESTAMP DEFAULT NOW()
);

-- Create index on user_id
CREATE INDEX idx_user_gas_usage_user ON user_gas_usage(user_id);

-- Add comments for documentation
COMMENT ON TABLE meta_transactions IS 'Tracks gasless meta-transactions submitted through the relayer service';
COMMENT ON TABLE user_gas_usage IS 'Tracks daily gas usage and limits per user for gasless transactions';
COMMENT ON COLUMN meta_transactions.tx_hash IS 'Blockchain transaction hash';
COMMENT ON COLUMN meta_transactions.gas_cost_matic IS 'Gas cost in MATIC tokens';
COMMENT ON COLUMN meta_transactions.gas_cost_usd IS 'Gas cost in USD (approximate)';
COMMENT ON COLUMN user_gas_usage.daily_gas_limit IS 'Maximum gas units allowed per day (default: 1,000,000)';
