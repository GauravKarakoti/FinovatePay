-- Multi-Currency Stablecoin Support
-- Adds support for additional stablecoins (DAI, EUROC, PYUSD) with smart routing

INSERT INTO currencies (code, name, symbol, decimal_places, is_crypto, is_active, is_default) VALUES
    ('DAI', 'Dai Stablecoin', 'DAI', 18, TRUE, TRUE, FALSE),
    ('EUR', 'Euro Coin', 'EUROC', 6, TRUE, TRUE, FALSE),
    ('PYU', 'PayPal USD', 'PYUSD', 6, TRUE, TRUE, FALSE)
ON CONFLICT (code) DO NOTHING

-- Add initial exchange rates for new stablecoins (pegged to USD)
INSERT INTO exchange_rates (currency_code, rate) VALUES
    ('DAI', 1.0),
    ('EUR', 0.92),
    ('PYU', 1.0)
ON CONFLICT (currency_code) DO NOTHING;

-- Create currency routes table for smart routing
CREATE TABLE IF NOT EXISTS currency_routes (
    id SERIAL PRIMARY KEY,
    from_currency VARCHAR(10) NOT NULL REFERENCES currencies(code),
    to_currency VARCHAR(10) NOT NULL REFERENCES currencies(code),
    route_type VARCHAR(20) NOT NULL, -- 'direct', 'via_usd', 'dex'
    provider VARCHAR(50), -- 'coingecko', 'binance', 'uniswap', 'curve'
    route_path VARCHAR(200), -- JSON array of path e.g., ["DAI","USDC"]
    rate NUMERIC(20, 12),
    slippage_bps INTEGER DEFAULT 50, -- slippage in basis points
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0, -- higher = preferred
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(from_currency, to_currency, provider)
);

-- Create table for exchange quotes (temporary, used for routing decisions)
CREATE TABLE IF NOT EXISTS exchange_quotes (
    id SERIAL PRIMARY KEY,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    amount_in NUMERIC(40, 0) NOT NULL,
    amount_out NUMERIC(40, 0) NOT NULL,
    rate NUMERIC(20, 12) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    route_path VARCHAR(200),
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create table for multi-currency payment transactions
CREATE TABLE IF NOT EXISTS multi_currency_payments (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(100) UNIQUE,
    from_currency VARCHAR(10) NOT NULL,
    to_currency VARCHAR(10) NOT NULL,
    from_amount NUMERIC(40, 0) NOT NULL,
    to_amount NUMERIC(40, 0) NOT NULL,
    rate NUMERIC(20, 12) NOT NULL,
    provider VARCHAR(50),
    route_path VARCHAR(200),
    user_id INTEGER REFERENCES users(id),
    invoice_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'pending', -- pending, completed, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create table for supported stablecoin pairs
CREATE TABLE IF NOT EXISTS stablecoin_pairs (
    id SERIAL PRIMARY KEY,
    token_a VARCHAR(10) NOT NULL REFERENCES currencies(code),
    token_b VARCHAR(10) NOT NULL REFERENCES currencies(code),
    dex_name VARCHAR(50), -- 'uniswap', 'curve', 'sushiswap'
    pool_address VARCHAR(100),
    liquidity_usd NUMERIC(20, 2),
    volume_24h NUMERIC(20, 2),
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_a, token_b, dex_name)
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_routes_from_to ON currency_routes(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_routes_active ON currency_routes(is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_expiry ON exchange_quotes(expires_at);
CREATE INDEX IF NOT EXISTS idx_payments_user ON multi_currency_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON multi_currency_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pairs_tokens ON stablecoin_pairs(token_a, token_b);

INSERT INTO currencies (code, name, symbol, decimal_places, is_crypto, is_active, is_default) VALUES
    ('USC', 'USD Coin', 'USDC', 6, true, true, false),
    ('UST', 'Tether USD', 'USDT', 6, true, true, false),
    ('DAI', 'Dai Stablecoin', 'DAI', 18, true, true, false),
    ('PYU', 'PayPal USD', 'PYUSD', 6, true, true, false),
    ('EUR', 'Euro Coin', 'EUROC', 6, true, true, false),
    ('ERO', 'Euro', '€', 2, false, true, false),
    ('USD', 'US Dollar', '$', 2, false, true, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO currency_routes (from_currency, to_currency, route_type, provider, route_path, rate, slippage_bps, priority) VALUES
    ('USC', 'UST', 'direct', 'coingecko', '["USDC","USDT"]', 1.0, 10, 10),
    ('UST', 'USC', 'direct', 'coingecko', '["USDT","USDC"]', 1.0, 10, 10),
    ('DAI', 'USC', 'direct', 'coingecko', '["DAI","USDC"]', 1.0, 20, 8),
    ('USC', 'DAI', 'direct', 'coingecko', '["USDC","DAI"]', 1.0, 20, 8),
    ('DAI', 'UST', 'direct', 'coingecko', '["DAI","USDT"]', 1.0, 20, 8),
    ('UST', 'DAI', 'direct', 'coingecko', '["USDT","DAI"]', 1.0, 20, 8),
    ('PYU', 'USC', 'direct', 'coingecko', '["PYUSD","USDC"]', 1.0, 15, 7),
    ('USC', 'PYU', 'direct', 'coingecko', '["USDC","PYUSD"]', 1.0, 15, 7),
    ('PYU', 'UST', 'direct', 'coingecko', '["PYUSD","USDT"]', 1.0, 15, 7),
    ('UST', 'PYU', 'direct', 'coingecko', '["USDT","PYUSD"]', 1.0, 15, 7),
    ('EUR', 'ERO', 'direct', 'coingecko', '["EUROC","EUR"]', 1.0, 30, 5),
    ('ERO', 'EUR', 'direct', 'coingecko', '["EUR","EUROC"]', 1.0, 30, 5),
    ('EUR', 'USC', 'via_usd', 'coingecko', '["EUROC","EUR","USD","USDC"]', 0.92, 50, 3),
    ('USC', 'EUR', 'via_usd', 'coingecko', '["USDC","USD","EUR","EUROC"]', 1.087, 50, 3),
    ('USC', 'USD', 'via_usd', 'coingecko', '["USDC"]', 1.0, 5, 20),
    ('UST', 'USD', 'via_usd', 'coingecko', '["USDT"]', 1.0, 5, 20),
    ('DAI', 'USD', 'via_usd', 'coingecko', '["DAI"]', 1.0, 10, 15),
    ('PYU', 'USD', 'via_usd', 'coingecko', '["PYUSD"]', 1.0, 10, 12),
    ('USD', 'USC', 'via_usd', 'coingecko', '["USDC"]', 1.0, 5, 20),
    ('USD', 'UST', 'via_usd', 'coingecko', '["USDT"]', 1.0, 5, 20),
    ('USD', 'DAI', 'via_usd', 'coingecko', '["DAI"]', 1.0, 10, 15),
    ('USD', 'PYU', 'via_usd', 'coingecko', '["PYUSD"]', 1.0, 10, 12)
ON CONFLICT (from_currency, to_currency, provider) DO NOTHING;

INSERT INTO stablecoin_pairs (token_a, token_b, dex_name, pool_address, liquidity_usd, volume_24h, is_active) VALUES
    ('USC', 'UST', 'uniswap', '0x3041cbd36888becc7bbcbc0045e3b1f144466f5f', 50000000, 25000000, TRUE),
    ('DAI', 'USC', 'uniswap', '0xae461ca67b15dc8dc81ce7615e0320da1a9ab8ed', 25000000, 15000000, TRUE),
    ('DAI', 'UST', 'uniswap', '0x3e8468f66d30fc99f9e8aa87002d42cffc17f3a3', 20000000, 12000000, TRUE),
    ('USC', 'UST', 'curve', '0x42b7a526b3176ade2bcf6a0b3d6b4ee3d9f3a0b6', 100000000, 50000000, TRUE),
    ('DAI', 'USC', 'curve', '0x3b6831c0077a1e50011a92b73eed2a76e5e7a0c7', 30000000, 18000000, TRUE)
ON CONFLICT (token_a, token_b, dex_name) DO NOTHING;

-- Add trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_multi_currency_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_multi_currency_payments_updated_at
    BEFORE UPDATE ON multi_currency_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_multi_currency_updated_at_column();

CREATE TRIGGER update_currency_routes_updated_at
    BEFORE UPDATE ON currency_routes
    FOR EACH ROW
    EXECUTE FUNCTION update_multi_currency_updated_at_column();

CREATE TRIGGER update_stablecoin_pairs_updated_at
    BEFORE UPDATE ON stablecoin_pairs
    FOR EACH ROW
    EXECUTE FUNCTION update_multi_currency_updated_at_column();

-- Comments
COMMENT ON TABLE currency_routes IS 'Smart routing paths for currency conversion';
COMMENT ON TABLE exchange_quotes IS 'Real-time exchange quotes from multiple providers';
COMMENT ON TABLE multi_currency_payments IS 'Multi-currency payment transactions';
COMMENT ON TABLE stablecoin_pairs IS 'Supported stablecoin trading pairs on DEXs';

-- Grant necessary permissions (if needed)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO your_app_user;

