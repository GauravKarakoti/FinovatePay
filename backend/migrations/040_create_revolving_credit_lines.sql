-- Revolving Credit Lines Table
-- Stores on-chain revolving credit line accounts

CREATE TABLE IF NOT EXISTS revolving_credit_lines (
    id SERIAL PRIMARY KEY,
    credit_line_id VARCHAR(66) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(42) NOT NULL,
    credit_limit VARCHAR(78) NOT NULL DEFAULT '0',
    drawn_amount VARCHAR(78) NOT NULL DEFAULT '0',
    interest_rate INTEGER NOT NULL DEFAULT 0,
    collateral_token_id BIGINT,
    collateral_amount VARCHAR(78) NOT NULL DEFAULT '0',
    collateral_value VARCHAR(78) NOT NULL DEFAULT '0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_transaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries by user_id
CREATE INDEX IF NOT EXISTS idx_revolving_credit_lines_user_id ON revolving_credit_lines(user_id);

-- Index for wallet address lookups
CREATE INDEX IF NOT EXISTS idx_revolving_credit_lines_wallet ON revolving_credit_lines(wallet_address);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_revolving_credit_lines_status ON revolving_credit_lines(status);

-- Index for credit line ID
CREATE INDEX IF NOT EXISTS idx_revolving_credit_lines_id ON revolving_credit_lines(credit_line_id);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_revolving_credit_lines_updated_at
    BEFORE UPDATE ON revolving_credit_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Credit Line Transactions Table
-- Records all drawdowns, repayments, collateral deposits/withdrawals

CREATE TABLE IF NOT EXISTS credit_line_transactions (
    id SERIAL PRIMARY KEY,
    credit_line_id VARCHAR(66) NOT NULL REFERENCES revolving_credit_lines(credit_line_id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL, -- drawdown, repayment, collateral_deposit, collateral_withdrawal, interest_accrued
    amount VARCHAR(78) NOT NULL DEFAULT '0',
    interest_paid VARCHAR(78) DEFAULT '0',
    transaction_hash VARCHAR(66),
    block_number BIGINT,
    from_address VARCHAR(42),
    to_address VARCHAR(42),
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, confirmed, failed
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for credit line transaction queries
CREATE INDEX IF NOT EXISTS idx_credit_line_transactions_credit_line ON credit_line_transactions(credit_line_id, created_at DESC);

-- Index for transaction type queries
CREATE INDEX IF NOT EXISTS idx_credit_line_transactions_type ON credit_line_transactions(transaction_type);

-- Credit Line Interest Accruals Table
-- Tracks interest accrual history for accurate calculations

CREATE TABLE IF NOT EXISTS credit_line_interest_accruals (
    id SERIAL PRIMARY KEY,
    credit_line_id VARCHAR(66) NOT NULL REFERENCES revolving_credit_lines(credit_line_id) ON DELETE CASCADE,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    starting_balance VARCHAR(78) NOT NULL,
    interest_rate INTEGER NOT NULL,
    interest_accrued VARCHAR(78) NOT NULL DEFAULT '0',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for interest accrual queries
CREATE INDEX IF NOT EXISTS idx_credit_line_interest_accruals ON credit_line_interest_accruals(credit_line_id, period_start DESC);

-- Credit Line Collateral History Table
-- Tracks collateral changes over time

CREATE TABLE IF NOT EXISTS credit_line_collateral_history (
    id SERIAL PRIMARY KEY,
    credit_line_id VARCHAR(66) NOT NULL REFERENCES revolving_credit_lines(credit_line_id) ON DELETE CASCADE,
    token_id BIGINT NOT NULL,
    amount_before VARCHAR(78) NOT NULL,
    amount_after VARCHAR(78) NOT NULL,
    action VARCHAR(50) NOT NULL, -- deposit, withdrawal, liquidation
    transaction_hash VARCHAR(66),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for collateral history queries
CREATE INDEX IF NOT EXISTS idx_credit_line_collateral_history ON credit_line_collateral_history(credit_line_id, created_at DESC);

CREATE TABLE IF NOT EXISTS credit_line_config (
    id SERIAL PRIMARY KEY,
    parameter_key VARCHAR(100) NOT NULL UNIQUE,
    parameter_value VARCHAR(255) NOT NULL,
    description TEXT,
    is_global BOOLEAN NOT NULL DEFAULT true,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default global configuration
INSERT INTO credit_line_config (parameter_key, parameter_value, description, is_global) VALUES
    ('min_credit_score', '60', 'Minimum credit score required to qualify for a credit line', true),
    ('collateralization_ratio', '150', 'Minimum collateralization ratio (percentage)', true),
    ('credit_score_multiplier', '100', 'Credit limit multiplier: credit_score * multiplier = credit_limit (in USD)', true),
    ('max_interest_rate', '2000', 'Maximum allowed interest rate in BPS (20%)', true),
    ('default_interest_rate', '500', 'Default interest rate in BPS (5%)', true)
ON CONFLICT (parameter_key) DO NOTHING;

-- Trigger to update updated_at timestamp for credit_line_config
CREATE TRIGGER update_credit_line_config_updated_at
    BEFORE UPDATE ON credit_line_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE revolving_credit_lines IS 'Stores on-chain revolving credit line accounts with credit limits and collateral';
COMMENT ON TABLE credit_line_transactions IS 'Records all credit line transactions (drawdowns, repayments, collateral changes)';
COMMENT ON TABLE credit_line_interest_accruals IS 'Tracks interest accrual history for accurate interest calculations';
COMMENT ON TABLE credit_line_collateral_history IS 'Tracks collateral changes over time';
COMMENT ON TABLE credit_line_config IS 'Stores credit line configuration parameters';
