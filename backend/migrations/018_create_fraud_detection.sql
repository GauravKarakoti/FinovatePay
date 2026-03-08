-- AI-Powered Fraud Detection schema
-- Stores risk patterns, suspicious transaction events, and alert lifecycle state

CREATE TABLE IF NOT EXISTS fraud_patterns (
    id SERIAL PRIMARY KEY,
    pattern_key VARCHAR(100) NOT NULL UNIQUE,
    pattern_name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    threshold NUMERIC(20, 6) DEFAULT 0,
    weight NUMERIC(8, 4) NOT NULL DEFAULT 1.0000,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fraud_patterns_category ON fraud_patterns(category);
CREATE INDEX IF NOT EXISTS idx_fraud_patterns_active ON fraud_patterns(is_active);

CREATE TABLE IF NOT EXISTS suspicious_transactions (
    id BIGSERIAL PRIMARY KEY,
    invoice_id UUID,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    wallet_address VARCHAR(128),
    transaction_type VARCHAR(50) NOT NULL,
    amount NUMERIC(20, 6) NOT NULL DEFAULT 0,
    currency VARCHAR(32),
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'flagged' CHECK (status IN ('flagged', 'under_review', 'cleared', 'blocked')),
    detection_source VARCHAR(50) NOT NULL DEFAULT 'ml_service',
    reason_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    features JSONB NOT NULL DEFAULT '{}'::jsonb,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suspicious_transactions_user_id ON suspicious_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_transactions_invoice_id ON suspicious_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_transactions_created_at ON suspicious_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suspicious_transactions_risk_score ON suspicious_transactions(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_suspicious_transactions_status ON suspicious_transactions(status);

CREATE TABLE IF NOT EXISTS fraud_alerts (
    id BIGSERIAL PRIMARY KEY,
    suspicious_transaction_id BIGINT REFERENCES suspicious_transactions(id) ON DELETE CASCADE,
    alert_code VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'dismissed')),
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    resolution_note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_status ON fraud_alerts(status);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_severity ON fraud_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created_at ON fraud_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_assigned_to ON fraud_alerts(assigned_to);

-- Seed a baseline set of active fraud patterns used by the scoring service
INSERT INTO fraud_patterns (pattern_key, pattern_name, description, category, severity, threshold, weight, metadata)
VALUES
    ('high_amount_spike', 'High Amount Spike', 'Transaction amount significantly exceeds user baseline.', 'amount_anomaly', 'high', 2.50, 1.8000, '{"window_days": 30}'::jsonb),
    ('rapid_repeat_transactions', 'Rapid Repeat Transactions', 'Multiple transactions attempted in a short time window.', 'velocity_anomaly', 'high', 3.00, 1.6000, '{"window_minutes": 15}'::jsonb),
    ('new_counterparty_high_value', 'New Counterparty High Value', 'High-value transfer to or from an unseen counterparty.', 'behavior_anomaly', 'medium', 1.00, 1.3000, '{}'::jsonb),
    ('off_hours_activity', 'Off Hours Activity', 'Sensitive transaction during unusual activity hours.', 'time_anomaly', 'low', 1.00, 1.1000, '{"start_hour": 0, "end_hour": 5}'::jsonb),
    ('kyc_mismatch_risk', 'KYC Mismatch Risk', 'High risk activity while KYC status is not verified.', 'compliance_anomaly', 'critical', 1.00, 2.2000, '{}'::jsonb)
ON CONFLICT (pattern_key) DO NOTHING;

-- Keep updated_at current
CREATE TRIGGER update_fraud_patterns_updated_at
    BEFORE UPDATE ON fraud_patterns
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_suspicious_transactions_updated_at
    BEFORE UPDATE ON suspicious_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_fraud_alerts_updated_at
    BEFORE UPDATE ON fraud_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE fraud_patterns IS 'Catalog of active fraud patterns and scoring weights.';
COMMENT ON TABLE suspicious_transactions IS 'Transactions flagged by AI heuristics or ML service.';
COMMENT ON TABLE fraud_alerts IS 'Operational fraud alerts for admin investigation workflow.';
