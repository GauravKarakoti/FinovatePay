-- Secondary Market AMM schema for invoice fractions
-- Provides persistent state for AMM pair configs, LP positions, and executed swaps

CREATE TABLE IF NOT EXISTS amm_pairs (
    id BIGSERIAL PRIMARY KEY,
    pair_id VARCHAR(66) UNIQUE NOT NULL,
    token_id NUMERIC(78, 0) NOT NULL,
    fraction_token_address VARCHAR(42) NOT NULL,
    stablecoin_address VARCHAR(42) NOT NULL,
    reserve_fractions NUMERIC(78, 0) NOT NULL DEFAULT 0,
    reserve_stable NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_lp_shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
    fee_bps INTEGER NOT NULL DEFAULT 30 CHECK (fee_bps >= 0 AND fee_bps <= 1000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(42),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_amm_reserves_non_negative CHECK (reserve_fractions >= 0 AND reserve_stable >= 0),
    CONSTRAINT chk_amm_total_lp_non_negative CHECK (total_lp_shares >= 0)
);

CREATE INDEX IF NOT EXISTS idx_amm_pairs_token_id ON amm_pairs(token_id);
CREATE INDEX IF NOT EXISTS idx_amm_pairs_active ON amm_pairs(is_active);
CREATE INDEX IF NOT EXISTS idx_amm_pairs_updated_at ON amm_pairs(updated_at DESC);

CREATE TABLE IF NOT EXISTS liquidity_positions (
    id BIGSERIAL PRIMARY KEY,
    position_id VARCHAR(66) UNIQUE NOT NULL,
    pair_id VARCHAR(66) NOT NULL REFERENCES amm_pairs(pair_id) ON DELETE CASCADE,
    provider_address VARCHAR(42) NOT NULL,
    lp_shares NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_fraction_added NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_stable_added NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_fraction_removed NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_stable_removed NUMERIC(78, 0) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_liquidity_provider_pair UNIQUE (pair_id, provider_address),
    CONSTRAINT chk_lp_shares_non_negative CHECK (lp_shares >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lp_positions_pair ON liquidity_positions(pair_id);
CREATE INDEX IF NOT EXISTS idx_lp_positions_provider ON liquidity_positions(provider_address);
CREATE INDEX IF NOT EXISTS idx_lp_positions_updated_at ON liquidity_positions(updated_at DESC);

CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,
    trade_id VARCHAR(66) UNIQUE NOT NULL,
    pair_id VARCHAR(66) NOT NULL REFERENCES amm_pairs(pair_id) ON DELETE CASCADE,
    trader_address VARCHAR(42) NOT NULL,
    side VARCHAR(20) NOT NULL CHECK (side IN ('BUY_FRACTIONS', 'SELL_FRACTIONS')),
    amount_in NUMERIC(78, 0) NOT NULL,
    amount_out NUMERIC(78, 0) NOT NULL,
    fee_amount NUMERIC(78, 0) NOT NULL DEFAULT 0,
    reserve_fractions_after NUMERIC(78, 0) NOT NULL,
    reserve_stable_after NUMERIC(78, 0) NOT NULL,
    tx_hash VARCHAR(66),
    block_number BIGINT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_trade_amounts_positive CHECK (amount_in > 0 AND amount_out > 0)
);

CREATE INDEX IF NOT EXISTS idx_trades_pair_id ON trades(pair_id);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader_address);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_side ON trades(side);

CREATE TRIGGER update_amm_pairs_updated_at
    BEFORE UPDATE ON amm_pairs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_liquidity_positions_updated_at
    BEFORE UPDATE ON liquidity_positions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE amm_pairs IS 'AMM pools for invoice fraction tokenId markets.';
COMMENT ON TABLE liquidity_positions IS 'Liquidity provider share balances and position accounting for AMM pairs.';
COMMENT ON TABLE trades IS 'Executed AMM swap trades for invoice fraction secondary market.';
