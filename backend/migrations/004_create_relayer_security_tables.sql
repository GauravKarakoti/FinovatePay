-- Migration: Create Relayer Security Tables
-- Purpose: Add nonce tracking and audit logging for meta-transactions
-- Date: 2026-02-24

-- Table: meta_transaction_nonces
-- Purpose: Track nonces for each user to prevent replay attacks
CREATE TABLE IF NOT EXISTS meta_transaction_nonces (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL UNIQUE,
    nonce BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast nonce lookups
CREATE INDEX IF NOT EXISTS idx_meta_tx_nonces_user_address 
ON meta_transaction_nonces(user_address);

-- Table: relay_transaction_logs
-- Purpose: Audit trail for all relay transaction attempts
CREATE TABLE IF NOT EXISTS relay_transaction_logs (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    function_data TEXT NOT NULL,
    tx_hash VARCHAR(66),
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'REJECTED')),
    relayer_address VARCHAR(42) NOT NULL,
    gas_used BIGINT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_relay_logs_user_address 
ON relay_transaction_logs(user_address);

CREATE INDEX IF NOT EXISTS idx_relay_logs_status 
ON relay_transaction_logs(status);

CREATE INDEX IF NOT EXISTS idx_relay_logs_created_at 
ON relay_transaction_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_relay_logs_tx_hash 
ON relay_transaction_logs(tx_hash);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_meta_tx_nonce_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_meta_tx_nonce_timestamp
BEFORE UPDATE ON meta_transaction_nonces
FOR EACH ROW
EXECUTE FUNCTION update_meta_tx_nonce_timestamp();

-- Comments for documentation
COMMENT ON TABLE meta_transaction_nonces IS 'Tracks nonces for meta-transactions to prevent replay attacks';
COMMENT ON TABLE relay_transaction_logs IS 'Audit trail for all relay transaction attempts (success, failed, rejected)';
COMMENT ON COLUMN relay_transaction_logs.status IS 'SUCCESS: tx confirmed, FAILED: tx reverted, REJECTED: validation failed';
