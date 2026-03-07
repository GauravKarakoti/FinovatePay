-- ============================================
-- WEBHOOKS TABLE
-- ============================================
-- Purpose: Store webhook endpoints for external service notifications
-- Supports: Event subscriptions, retry logic, request signing

-- Create webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    
    -- Endpoint configuration
    name VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    secret VARCHAR(255) NOT NULL,  -- Used for signing payloads
    
    -- Event subscription
    events JSONB NOT NULL DEFAULT '[]',  -- Array of event types to subscribe to
    active BOOLEAN DEFAULT true,
    
    -- Retry configuration
    max_retries INTEGER DEFAULT 5,
    retry_delay_seconds INTEGER DEFAULT 60,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_url CHECK (url ~ '^https?://')
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON webhooks USING GIN(events);

-- ============================================
-- WEBHOOK DELIVERIES TABLE
-- ============================================
-- Purpose: Track webhook delivery attempts and status

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    
    -- Event details
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    
    -- Delivery status
    status VARCHAR(50) DEFAULT 'pending',  -- pending, delivered, failed, retrying
    attempt_count INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMP,
    next_retry_at TIMESTAMP,
    
    -- Response details
    http_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    delivered_at TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('pending', 'delivered', 'failed', 'retrying'))
);

-- Create indexes for deliveries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(next_retry_at) 
    WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at DESC);

-- ============================================
-- TRIGGER FOR UPDATED_AT
-- ============================================
DROP TRIGGER IF EXISTS update_webhooks_updated_at ON webhooks;
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE webhooks IS 'Stores webhook endpoint configurations for external integrations';
COMMENT ON TABLE webhook_deliveries IS 'Tracks delivery attempts and status for webhook events';

COMMENT ON COLUMN webhooks.events IS 'JSON array of event types: invoice.created, invoice.paid, dispute.raised, etc.';
COMMENT ON COLUMN webhooks.secret IS 'Secret key used to sign webhook payloads with HMAC-SHA256';

-- ============================================
-- SAMPLE EVENT TYPES
-- ============================================
-- invoice.created - New invoice created
-- invoice.paid - Invoice payment confirmed
-- invoice.cancelled - Invoice cancelled
-- escrow.funded - Escrow funded
-- escrow.released - Escrow released
-- dispute.raised - Dispute raised
-- dispute.resolved - Dispute resolved
-- shipment.created - Shipment created
-- shipment.delivered - Shipment delivered
-- kyc.approved - KYC verification approved
-- kyc.rejected - KYC verification rejected
-- quotation.created - Quotation created
-- quotation.approved - Quotation approved
-- payment.stream_created - Streaming payment created
-- payment.stream_completed - Streaming payment completed
