-- Invoice Auctions Table
-- Stores auction details for invoices being sold to investors

CREATE TABLE IF NOT EXISTS invoice_auctions (
    id SERIAL PRIMARY KEY,
    auction_id VARCHAR(66) UNIQUE NOT NULL,
    seller_address VARCHAR(42) NOT NULL,
    invoice_contract_address VARCHAR(42),
    invoice_id VARCHAR(66) NOT NULL,
    face_value VARCHAR(78) NOT NULL, -- Using VARCHAR for large numbers
    payment_token VARCHAR(42) NOT NULL,
    min_yield_bps INTEGER NOT NULL CHECK (min_yield_bps >= 0 AND min_yield_bps <= 10000),
    auction_end_time TIMESTAMP NOT NULL,
    min_bid_increment VARCHAR(78) DEFAULT '0',
    highest_bid VARCHAR(78) DEFAULT '0',
    highest_bidder VARCHAR(42),
    status VARCHAR(20) NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'active', 'ended', 'cancelled', 'settled')),
    tx_hash VARCHAR(66),
    winner_address VARCHAR(42),
    winning_yield_bps INTEGER,
    platform_fee VARCHAR(78),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_auctions_seller ON invoice_auctions(seller_address);
CREATE INDEX IF NOT EXISTS idx_auctions_status ON invoice_auctions(status);
CREATE INDEX IF NOT EXISTS idx_auctions_invoice_id ON invoice_auctions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_auctions_created ON invoice_auctions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON invoice_auctions(auction_end_time);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_auctions_updated_at
    BEFORE UPDATE ON invoice_auctions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auction Bids Table
-- Stores all bids placed on auctions

CREATE TABLE IF NOT EXISTS auction_bids (
    id SERIAL PRIMARY KEY,
    bid_id VARCHAR(66) UNIQUE NOT NULL,
    auction_id VARCHAR(66) NOT NULL REFERENCES invoice_auctions(auction_id) ON DELETE CASCADE,
    bidder_address VARCHAR(42) NOT NULL,
    yield_bps INTEGER NOT NULL CHECK (yield_bps >= 0 AND yield_bps <= 10000),
    bid_amount VARCHAR(78) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'outbid', 'winner', 'cancelled'))
);

-- Indexes for bids
CREATE INDEX IF NOT EXISTS idx_bids_auction ON auction_bids(auction_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON auction_bids(bidder_address);
CREATE INDEX IF NOT EXISTS idx_bids_timestamp ON auction_bids(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bids_yield ON auction_bids(yield_bps ASC);

-- Composite index for sorting auctions by yield (best first)
CREATE INDEX IF NOT EXISTS idx_bids_best_yield ON auction_bids(auction_id, yield_bps ASC);

COMMENT ON TABLE invoice_auctions IS 'Stores invoice auction listings where sellers can receive bids from investors';
COMMENT ON TABLE auction_bids IS 'Stores all bids placed on invoice auctions';
COMMENT ON COLUMN invoice_auctions.min_yield_bps IS 'Minimum yield rate seller accepts (in basis points) - lower is better for buyer';
COMMENT ON COLUMN invoice_auctions.highest_bid IS 'Current highest bid amount';
COMMENT ON COLUMN auction_bids.yield_bps IS 'Yield rate offered by bidder (in basis points) - lower is better for seller';
