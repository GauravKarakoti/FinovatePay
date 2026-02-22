-- Streaming Payments Table
-- Stores subscription invoices and streaming payment details

CREATE TABLE IF NOT EXISTS streaming_payments (
    id SERIAL PRIMARY KEY,
    stream_id VARCHAR(66) UNIQUE NOT NULL,
    seller_address VARCHAR(42) NOT NULL,
    buyer_address VARCHAR(42) NOT NULL,
    amount VARCHAR(78) NOT NULL, -- Using VARCHAR for large numbers
    per_interval_amount VARCHAR(78) NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    interval_type VARCHAR(20) NOT NULL CHECK (interval_type IN ('daily', 'weekly', 'monthly')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'cancelled', 'completed')),
    description TEXT,
    start_time TIMESTAMP,
    next_release_time TIMESTAMP,
    total_released VARCHAR(78) DEFAULT '0',
    total_paid VARCHAR(78) DEFAULT '0',
    intervals_completed INTEGER DEFAULT 0,
    total_intervals INTEGER NOT NULL,
    stream_tx_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_streaming_seller ON streaming_payments(seller_address);
CREATE INDEX IF NOT EXISTS idx_streaming_buyer ON streaming_payments(buyer_address);
CREATE INDEX IF NOT EXISTS idx_streaming_status ON streaming_payments(status);
CREATE INDEX IF NOT EXISTS idx_streaming_created ON streaming_payments(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_streaming_updated_at
    BEFORE UPDATE ON streaming_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add streaming_payment_id to invoices table (optional link to subscription)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS streaming_payment_id INTEGER REFERENCES streaming_payments(id);

COMMENT ON TABLE streaming_payments IS 'Stores recurring/streaming payment subscriptions';
COMMENT ON COLUMN streaming_payments.stream_id IS 'Unique stream identifier (bytes32 as hex string)';
COMMENT ON COLUMN streaming_payments.interval_type IS 'Payment interval: daily, weekly, or monthly';
COMMENT ON COLUMN streaming_payments.status IS 'Stream lifecycle: pending -> active -> paused/cancelled/completed';
