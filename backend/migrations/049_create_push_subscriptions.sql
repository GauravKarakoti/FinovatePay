-- Push Subscriptions Table
-- Stores browser push notification subscriptions for users

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_object JSONB NOT NULL,
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(500) NOT NULL,
    auth VARCHAR(500) NOT NULL,
    user_agent TEXT,
    browser VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_is_active ON push_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_created ON push_subscriptions(created_at DESC);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_push_subscriptions_updated_at
    BEFORE UPDATE ON push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Push Notification Preferences Table
-- Stores user preferences for push notifications

CREATE TABLE IF NOT EXISTS push_notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    escrow_created BOOLEAN DEFAULT TRUE,
    escrow_funded BOOLEAN DEFAULT TRUE,
    escrow_released BOOLEAN DEFAULT TRUE,
    dispute_raised BOOLEAN DEFAULT TRUE,
    dispute_resolved BOOLEAN DEFAULT TRUE,
    auction_outbid BOOLEAN DEFAULT TRUE,
    auction_ending BOOLEAN DEFAULT TRUE,
    payment_received BOOLEAN DEFAULT TRUE,
    kyc_status BOOLEAN DEFAULT TRUE,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for push notification preferences
CREATE INDEX IF NOT EXISTS idx_push_preferences_user_id ON push_notification_preferences(user_id);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_push_preferences_updated_at
    BEFORE UPDATE ON push_notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Push Notification History Table
-- Stores history of sent notifications for debugging

CREATE TABLE IF NOT EXISTS push_notification_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id INTEGER REFERENCES push_subscriptions(id) ON DELETE SET NULL,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'clicked')),
    error_message TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    clicked_at TIMESTAMP
);

-- Indexes for push notification history
CREATE INDEX IF NOT EXISTS idx_push_history_user_id ON push_notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_push_history_subscription_id ON push_notification_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_push_history_type ON push_notification_history(notification_type);
CREATE INDEX IF NOT EXISTS idx_push_history_status ON push_notification_history(status);
CREATE INDEX IF NOT EXISTS idx_push_history_sent ON push_notification_history(sent_at DESC);

COMMENT ON TABLE push_subscriptions IS 'Stores browser push notification subscriptions for users';
COMMENT ON TABLE push_notification_preferences IS 'Stores user preferences for push notifications';
COMMENT ON TABLE push_notification_history IS 'Stores history of sent notifications for debugging';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'The push subscription endpoint URL';
COMMENT ON COLUMN push_subscriptions.p256dh IS 'The P-256 ECDH public key of the push subscription';
COMMENT ON COLUMN push_subscriptions.auth IS 'The auth secret of the push subscription';
