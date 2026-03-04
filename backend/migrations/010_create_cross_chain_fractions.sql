-- Cross-Chain Invoice Fractionalization Tracking
-- Tracks fractions that have been bridged to other chains

CREATE TABLE IF NOT EXISTS cross_chain_fractions (
    id SERIAL PRIMARY KEY,
    token_id VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(255) NOT NULL,
    owner_id INTEGER REFERENCES users(id),
    owner_wallet VARCHAR(255) NOT NULL,
    amount NUMERIC NOT NULL,
    destination_chain VARCHAR(50) NOT NULL,
    source_chain VARCHAR(50) DEFAULT 'finovate-cdk',
    bridge_lock_id VARCHAR(255),
    bridge_tx_hash VARCHAR(255),
    status VARCHAR(50) DEFAULT 'bridged', -- 'bridged', 'sold', 'returned', 'failed'
    price_per_fraction NUMERIC,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    bridged_at TIMESTAMP,
    returned_at TIMESTAMP
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_cross_chain_fractions_token_id ON cross_chain_fractions(token_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_fractions_invoice_id ON cross_chain_fractions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_fractions_owner_id ON cross_chain_fractions(owner_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_fractions_status ON cross_chain_fractions(status);
CREATE INDEX IF NOT EXISTS idx_cross_chain_fractions_destination_chain ON cross_chain_fractions(destination_chain);

-- Cross-chain marketplace listings (fractions listed on other chains)
CREATE TABLE IF NOT EXISTS cross_chain_marketplace_listings (
    id SERIAL PRIMARY KEY,
    token_id VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(255) NOT NULL,
    seller_id INTEGER REFERENCES users(id),
    seller_wallet VARCHAR(255) NOT NULL,
    amount NUMERIC NOT NULL,
    remaining_amount NUMERIC NOT NULL,
    price_per_fraction NUMERIC NOT NULL,
    destination_chain VARCHAR(50) NOT NULL,
    source_chain VARCHAR(50) DEFAULT 'finovate-cdk',
    listing_status VARCHAR(50) DEFAULT 'active', -- 'active', 'sold_out', 'cancelled'
    total_sold NUMERIC DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP
);

-- Index for marketplace lookups
CREATE INDEX IF NOT EXISTS idx_cross_chain_listings_token_id ON cross_chain_marketplace_listings(token_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_listings_destination_chain ON cross_chain_marketplace_listings(destination_chain);
CREATE INDEX IF NOT EXISTS idx_cross_chain_listings_status ON cross_chain_marketplace_listings(listing_status);

-- Cross-chain trades history
CREATE TABLE IF NOT EXISTS cross_chain_trades (
    id SERIAL PRIMARY KEY,
    listing_id INTEGER REFERENCES cross_chain_marketplace_listings(id),
    token_id VARCHAR(255) NOT NULL,
    invoice_id VARCHAR(255) NOT NULL,
    seller_id INTEGER REFERENCES users(id),
    buyer_id INTEGER REFERENCES users(id),
    seller_wallet VARCHAR(255) NOT NULL,
    buyer_wallet VARCHAR(255) NOT NULL,
    amount NUMERIC NOT NULL,
    price_per_fraction NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    destination_chain VARCHAR(50) NOT NULL,
    trade_tx_hash VARCHAR(255),
    status VARCHAR(50) DEFAULT 'completed', -- 'pending', 'completed', 'failed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cross_chain_trades_listing_id ON cross_chain_trades(listing_id);
CREATE INDEX IF NOT EXISTS idx_cross_chain_trades_token_id ON cross_chain_trades(token_id);

-- Add column to invoices table for cross-chain tracking (if not exists)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'cross_chain_enabled'
    ) THEN
        ALTER TABLE invoices ADD COLUMN cross_chain_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'primary_chain'
    ) THEN
        ALTER TABLE invoices ADD COLUMN primary_chain VARCHAR(50) DEFAULT 'finovate-cdk';
    END IF;
END $$;
