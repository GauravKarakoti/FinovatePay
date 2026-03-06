-- Migration: Create Rate Limits Table
-- Purpose: Database-backed rate limiting for meta-transactions
-- Date: 2026-03-05
-- This replaces in-memory Map rate limiting to support multi-process deployments
-- (PM2 cluster mode, Docker replicas, Kubernetes pods, etc.)

-- Table: rate_limits
-- Purpose: Track rate limit counters per address for gasless transactions
CREATE TABLE IF NOT EXISTS rate_limits (
    id SERIAL PRIMARY KEY,
    address VARCHAR(42) NOT NULL UNIQUE,
    count INTEGER NOT NULL DEFAULT 1,
    window_start BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast rate limit lookups by address
CREATE INDEX IF NOT EXISTS idx_rate_limits_address 
ON rate_limits(address);

-- Index for cleanup queries (optional, for removing old entries)
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start 
ON rate_limits(window_start);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_rate_limits_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_rate_limits_timestamp ON rate_limits;
CREATE TRIGGER trigger_update_rate_limits_timestamp
BEFORE UPDATE ON rate_limits
FOR EACH ROW
EXECUTE FUNCTION update_rate_limits_timestamp();

-- Comments for documentation
COMMENT ON TABLE rate_limits IS 'Database-backed rate limiting for meta-transactions, supports multi-process deployments';
COMMENT ON COLUMN rate_limits.address IS 'User wallet address (lowercase)';
COMMENT ON COLUMN rate_limits.count IS 'Number of requests in current window';
COMMENT ON COLUMN rate_limits.window_start IS 'Unix timestamp (ms) when the current rate limit window started';
