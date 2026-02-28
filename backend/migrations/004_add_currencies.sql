-- Multi-Currency Support Tables
-- Stores supported currencies and exchange rates

-- Currencies table
CREATE TABLE IF NOT EXISTS currencies (
    id SERIAL PRIMARY KEY,
    code VARCHAR(3) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    decimal_places INTEGER NOT NULL DEFAULT 2,
    is_crypto BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Exchange rates table (stored with USD as base)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(3) NOT NULL REFERENCES currencies(code),
    rate NUMERIC(20, 8) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(currency_code)
);

-- User currency preferences table
CREATE TABLE IF NOT EXISTS user_currency_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preferred_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    display_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_currencies_active ON currencies(is_active);
CREATE INDEX IF NOT EXISTS idx_currencies_code ON currencies(code);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_code ON exchange_rates(currency_code);
CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_currency_preferences(user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_currency_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_currencies_updated_at
    BEFORE UPDATE ON currencies
    FOR EACH ROW
    EXECUTE FUNCTION update_currency_updated_at_column();

CREATE TRIGGER update_exchange_rates_updated_at
    BEFORE UPDATE ON exchange_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_currency_updated_at_column();

CREATE TRIGGER update_user_prefs_updated_at
    BEFORE UPDATE ON user_currency_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_currency_updated_at_column();

INSERT INTO currencies (code, name, symbol, decimal_places, is_crypto, is_active, is_default) VALUES
    ('USD', 'US Dollar', '$', 2, FALSE, TRUE, TRUE),
    ('EUR', 'Euro', '€', 2, FALSE, TRUE, FALSE),
    ('GBP', 'British Pound', '£', 2, FALSE, TRUE, FALSE),
    ('INR', 'Indian Rupee', '₹', 2, FALSE, TRUE, FALSE),
    ('JPY', 'Japanese Yen', '¥', 0, FALSE, TRUE, FALSE),
    ('AUD', 'Australian Dollar', 'A$', 2, FALSE, TRUE, FALSE),
    ('CAD', 'Canadian Dollar', 'C$', 2, FALSE, TRUE, FALSE),
    ('CHF', 'Swiss Franc', 'CHF', 2, FALSE, TRUE, FALSE),
    ('CNY', 'Chinese Yuan', '¥', 2, FALSE, TRUE, FALSE),
    ('USC', 'USD Coin', 'USDC', 6, TRUE, TRUE, FALSE),
    ('UDT', 'Tether', 'USDT', 6, TRUE, TRUE, FALSE),
    ('ETH', 'Ethereum', 'ETH', 18, TRUE, TRUE, FALSE),
    ('BTC', 'Bitcoin', 'BTC', 8, TRUE, TRUE, FALSE)
ON CONFLICT (code) DO NOTHING;

-- Insert default exchange rates (relative to USD)
-- These will be updated by the exchange rate service
INSERT INTO exchange_rates (currency_code, rate) VALUES
    ('USD', 1.0),
    ('EUR', 0.92),
    ('GBP', 0.79),
    ('INR', 83.12),
    ('JPY', 149.50),
    ('AUD', 1.53),
    ('CAD', 1.36),
    ('CHF', 0.88),
    ('CNY', 7.24),
    ('USC', 1.0),
    ('UDT', 1.0),
    ('ETH', 0.00042),
    ('BTC', 0.000015)
ON CONFLICT (currency_code) DO NOTHING;

COMMENT ON TABLE currencies IS 'Supported currencies for multi-currency support';
COMMENT ON TABLE exchange_rates IS 'Real-time exchange rates relative to USD';
COMMENT ON TABLE user_currency_preferences IS 'User currency preferences for display';
