-- =========================
-- COLLATERAL POSITIONS (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS collateral_positions (
    id SERIAL PRIMARY KEY,
    position_id VARCHAR(66) NOT NULL UNIQUE,
    loan_id VARCHAR(66) NOT NULL REFERENCES loans(loan_id) ON DELETE CASCADE,

    -- ✅ FIX: UUID → INTEGER
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    wallet_address VARCHAR(42) NOT NULL,
    
    collateral_type VARCHAR(20) NOT NULL 
        CHECK (collateral_type IN ('fraction_token', 'escrow_deposit')),
    
    token_contract VARCHAR(42) NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL DEFAULT 0,
    amount NUMERIC(78, 0) NOT NULL DEFAULT 0,
    
    value NUMERIC(78, 0) NOT NULL DEFAULT 0,
    
    is_locked BOOLEAN NOT NULL DEFAULT TRUE,
    deposited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT collateral_amount_positive CHECK (amount > 0),
    CONSTRAINT collateral_value_positive CHECK (value >= 0)
);

-- =========================
-- LIQUIDATION EVENTS (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS liquidation_events (
    id SERIAL PRIMARY KEY,
    liquidation_id VARCHAR(66) NOT NULL UNIQUE,
    loan_id VARCHAR(66) NOT NULL REFERENCES loans(loan_id) ON DELETE CASCADE,

    -- ✅ FIX: UUID → INTEGER
    liquidator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

    liquidator_address VARCHAR(42) NOT NULL,
    
    collateral_seized_value NUMERIC(78, 0) NOT NULL DEFAULT 0,
    debt_covered NUMERIC(78, 0) NOT NULL DEFAULT 0,
    liquidation_bonus NUMERIC(78, 0) NOT NULL DEFAULT 0,
    
    collateral_type VARCHAR(20),
    token_contract VARCHAR(42),
    token_id NUMERIC(78, 0),
    amount_seized NUMERIC(78, 0),
    
    status VARCHAR(20) NOT NULL DEFAULT 'completed' 
        CHECK (status IN ('pending', 'completed', 'reverted')),
    
    liquidated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    
    transaction_hash VARCHAR(66),
    block_number BIGINT
);

-- =========================
-- LOAN REPAYMENTS (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS loan_repayments (
    id SERIAL PRIMARY KEY,
    repayment_id VARCHAR(66) NOT NULL UNIQUE,
    loan_id VARCHAR(66) NOT NULL REFERENCES loans(loan_id) ON DELETE CASCADE,

    -- ✅ FIX: UUID → INTEGER
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    amount NUMERIC(78, 0) NOT NULL,
    interest_paid NUMERIC(78, 0) NOT NULL DEFAULT 0,
    principal_paid NUMERIC(78, 0) NOT NULL DEFAULT 0,
    remaining_debt NUMERIC(78, 0) NOT NULL DEFAULT 0,
    
    status VARCHAR(20) NOT NULL DEFAULT 'completed' 
        CHECK (status IN ('pending', 'completed', 'failed')),
    
    repaid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    transaction_hash VARCHAR(66),
    block_number BIGINT
);

-- =========================
-- LOAN COLLATERAL HISTORY (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS loan_collateral_history (
    id SERIAL PRIMARY KEY,
    history_id VARCHAR(66) NOT NULL UNIQUE,
    loan_id VARCHAR(66) NOT NULL REFERENCES loans(loan_id) ON DELETE CASCADE,
    position_id VARCHAR(66) REFERENCES collateral_positions(position_id) ON DELETE SET NULL,

    -- ✅ FIX: UUID → INTEGER
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    action VARCHAR(20) NOT NULL 
        CHECK (action IN ('deposit', 'withdraw', 'seized')),
    
    collateral_type VARCHAR(20) NOT NULL,
    token_contract VARCHAR(42),
    token_id NUMERIC(78, 0),
    amount NUMERIC(78, 0) NOT NULL,
    value NUMERIC(78, 0) NOT NULL,
    
    collateral_value_before NUMERIC(78, 0),
    collateral_value_after NUMERIC(78, 0),
    
    action_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    transaction_hash VARCHAR(66),
    block_number BIGINT
);

-- =========================
-- LENDING POOL CONFIG (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS lending_pool_config (
    id SERIAL PRIMARY KEY,
    parameter_key VARCHAR(50) NOT NULL UNIQUE,
    parameter_value TEXT NOT NULL,
    description TEXT,
    is_global BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- ✅ FIX: UUID → INTEGER
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_loans_user_id ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_wallet_address ON loans(wallet_address);
CREATE INDEX IF NOT EXISTS idx_loans_loan_id ON loans(loan_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_maturity_date ON loans(maturity_date);
CREATE INDEX IF NOT EXISTS idx_loans_is_undercollateralized ON loans(is_undercollateralized);
CREATE INDEX IF NOT EXISTS idx_loans_ltv ON loans(ltv);

CREATE INDEX IF NOT EXISTS idx_collateral_loan_id ON collateral_positions(loan_id);
CREATE INDEX IF NOT EXISTS idx_collateral_user_id ON collateral_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_collateral_position_id ON collateral_positions(position_id);
CREATE INDEX IF NOT EXISTS idx_collateral_type ON collateral_positions(collateral_type);
CREATE INDEX IF NOT EXISTS idx_collateral_token ON collateral_positions(token_contract, token_id);
CREATE INDEX IF NOT EXISTS idx_collateral_is_locked ON collateral_positions(is_locked);

CREATE INDEX IF NOT EXISTS idx_liquidation_loan_id ON liquidation_events(loan_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_liquidator ON liquidation_events(liquidator_address);
CREATE INDEX IF NOT EXISTS idx_liquidation_liquidator_id ON liquidation_events(liquidator_id);
CREATE INDEX IF NOT EXISTS idx_liquidation_status ON liquidation_events(status);
CREATE INDEX IF NOT EXISTS idx_liquidation_date ON liquidation_events(liquidated_at);

CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan_id ON loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_user_id ON loan_repayments(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_date ON loan_repayments(repaid_at);

CREATE INDEX IF NOT EXISTS idx_loan_collateral_history_loan_id ON loan_collateral_history(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_collateral_history_user_id ON loan_collateral_history(user_id);
CREATE INDEX IF NOT EXISTS idx_loan_collateral_history_action ON loan_collateral_history(action);
CREATE INDEX IF NOT EXISTS idx_loan_collateral_history_date ON loan_collateral_history(action_at);

INSERT INTO lending_pool_config (parameter_key, parameter_value, description, is_global) VALUES
    ('min_loan_size', '1000000000', 'Minimum loan size in USDC (6 decimals)', true),
    ('max_loan_size', '1000000000000', 'Maximum loan size in USDC (6 decimals)', true),
    ('max_loan_duration', '15552000', 'Maximum loan duration in seconds (180 days)', true),
    ('base_interest_rate', '500', 'Base interest rate in bps (5%)', true),
    ('liquidation_threshold', '8500', 'LTV threshold for liquidation in bps (85%)', true),
    ('min_collateral_ratio', '12000', 'Minimum collateral ratio in bps (120%)', true),
    ('liquidation_bonus', '500', 'Bonus for liquidators in bps (5%)', true),
    ('risk_score_weight', '30', 'Weight for credit score in LTV calculation (%)', true),
    ('collateral_weight', '70', 'Weight for collateral value in LTV calculation (%)', true),
    ('min_credit_score', '60', 'Minimum credit score required', true)
ON CONFLICT (parameter_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS lending_pool_stats (
    id SERIAL PRIMARY KEY,
    record_date DATE NOT NULL UNIQUE,
    
    -- Pool Metrics
    total_deposits NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_borrowed NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_interest_accrued NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_collateral_value NUMERIC(78, 0) NOT NULL DEFAULT 0,
    
    -- Loan Metrics
    active_loans_count INTEGER NOT NULL DEFAULT 0,
    total_loans_count INTEGER NOT NULL DEFAULT 0,
    liquidated_loans_count INTEGER NOT NULL DEFAULT 0,
    defaulted_loans_count INTEGER NOT NULL DEFAULT 0,
    
    -- Derived Metrics
    pool_utilization NUMERIC(5, 4) NOT NULL DEFAULT 0,
    average_ltv NUMERIC(5, 4) NOT NULL DEFAULT 0,
    average_interest_rate INTEGER NOT NULL DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lending_pool_stats_date ON lending_pool_stats(record_date);

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for loans
CREATE OR REPLACE TRIGGER update_loans_updated_at
    BEFORE UPDATE ON loans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Triggers for collateral_positions
CREATE OR REPLACE TRIGGER update_collateral_positions_updated_at
    BEFORE UPDATE ON collateral_positions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE loans IS 'Dynamic collateralized loans with LTV based on credit risk';
COMMENT ON TABLE collateral_positions IS 'Collateral deposits (ERC1155 fractions and escrow deposits)';
COMMENT ON TABLE liquidation_events IS 'Liquidation events for auditing';
COMMENT ON TABLE loan_repayments IS 'Loan repayment history';
COMMENT ON TABLE loan_collateral_history IS 'Collateral deposit and withdrawal history';
COMMENT ON TABLE lending_pool_config IS 'Lending pool protocol configuration';
COMMENT ON TABLE lending_pool_stats IS 'Aggregated lending pool statistics';

COMMENT ON COLUMN loans.ltv IS 'Loan-to-value ratio in basis points (0-10000)';
COMMENT ON COLUMN loans.is_undercollateralized IS 'Whether loan is below liquidation threshold';
COMMENT ON COLUMN loans.interest_rate IS 'Annual interest rate in basis points';
COMMENT ON COLUMN collateral_positions.collateral_type IS 'Type of collateral: fraction_token or escrow_deposit';
COMMENT ON COLUMN collateral_positions.is_locked IS 'Whether collateral is locked (cannot be withdrawn)';