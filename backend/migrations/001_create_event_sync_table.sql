-- Migration: Create event_sync table for blockchain event tracking
-- Purpose: Track last processed block numbers to enable event replay on server restart
-- Issue: #52 - Missing Transactional Integrity in Tokenization Listeners

-- Create event_sync table
CREATE TABLE IF NOT EXISTS event_sync (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(100) UNIQUE NOT NULL,
    last_processed_block BIGINT NOT NULL DEFAULT 0,
    last_processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_event_sync_event_name ON event_sync(event_name);

-- Insert default entry for Tokenized event
INSERT INTO event_sync (event_name, last_processed_block)
VALUES ('Tokenized', 0)
ON CONFLICT (event_name) DO NOTHING;

-- Add comment to table
COMMENT ON TABLE event_sync IS 'Tracks last processed block numbers for blockchain events to prevent missed events during server restarts';
COMMENT ON COLUMN event_sync.event_name IS 'Name of the blockchain event being tracked (e.g., Tokenized, FractionsPurchased)';
COMMENT ON COLUMN event_sync.last_processed_block IS 'Last block number that was successfully processed for this event';
COMMENT ON COLUMN event_sync.last_processed_at IS 'Timestamp when the last block was processed';
