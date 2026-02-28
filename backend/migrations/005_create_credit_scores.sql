CREATE TABLE IF NOT EXISTS credit_scores (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    payment_history_score INTEGER NOT NULL DEFAULT 0 CHECK (payment_history_score >= 0 AND payment_history_score <= 100),
    dispute_ratio_score INTEGER NOT NULL DEFAULT 0 CHECK (dispute_ratio_score >= 0 AND dispute_ratio_score <= 100),
    kyc_score INTEGER NOT NULL DEFAULT 0 CHECK (kyc_score >= 0 AND kyc_score <= 100),
    transaction_volume_score INTEGER NOT NULL DEFAULT 0 CHECK (transaction_volume_score >= 0 AND transaction_volume_score <= 100),
    previous_score INTEGER,
    score_change INTEGER DEFAULT 0,
    total_transactions INTEGER DEFAULT 0,
    completed_payments INTEGER DEFAULT 0,
    disputed_payments INTEGER DEFAULT 0,
    total_volume VARCHAR(78) DEFAULT '0',
    kyc_status VARCHAR(50) DEFAULT 'none',
    last_calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Index for faster queries by user_id
CREATE INDEX IF NOT EXISTS idx_credit_scores_user_id ON credit_scores(user_id);

-- Index for sorting by last_calculated_at
CREATE INDEX IF NOT EXISTS idx_credit_scores_last_calculated ON credit_scores(last_calculated_at DESC);

-- Index for finding users by score range
CREATE INDEX IF NOT EXISTS idx_credit_scores_score ON credit_scores(score DESC);

-- Credit score history table for tracking score changes over time
CREATE TABLE IF NOT EXISTS credit_score_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    score_change INTEGER NOT NULL,
    payment_history_score INTEGER NOT NULL,
    dispute_ratio_score INTEGER NOT NULL,
    kyc_score INTEGER NOT NULL,
    transaction_volume_score INTEGER NOT NULL,
    reason VARCHAR(255),
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for credit score history queries
CREATE INDEX IF NOT EXISTS idx_credit_score_history_user ON credit_score_history(user_id, calculated_at DESC);

-- Trigger to update updated_at timestamp for credit_scores
CREATE TRIGGER update_credit_scores_updated_at
    BEFORE UPDATE ON credit_scores
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE credit_scores IS 'Stores user credit/trust scores based on payment history, disputes, KYC, and transaction volume';
COMMENT ON TABLE credit_score_history IS 'Historical tracking of credit score changes';
COMMENT ON COLUMN credit_scores.score IS 'Overall credit score (0-100)';
COMMENT ON COLUMN credit_scores.payment_history_score IS 'Score based on payment completion rate (40% weight)';
COMMENT ON COLUMN credit_scores.dispute_ratio_score IS 'Score based on dispute ratio (30% weight)';
COMMENT ON COLUMN credit_scores.kyc_score IS 'Score based on KYC completion (20% weight)';
COMMENT ON COLUMN credit_scores.transaction_volume_score IS 'Score based on transaction volume (10% weight)';
