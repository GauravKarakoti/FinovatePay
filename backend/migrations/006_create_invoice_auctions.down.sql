-- Rollback: Create invoice auctions
DROP TABLE IF EXISTS invoice_auction_bids CASCADE;
DROP TABLE IF EXISTS invoice_auctions CASCADE;
DROP SEQUENCE IF EXISTS auction_bid_sequence;
DROP INDEX IF EXISTS idx_invoice_auctions_invoice CASCADE;
DROP INDEX IF EXISTS idx_invoice_auctions_status CASCADE;
DROP INDEX IF EXISTS idx_auction_bids_auction CASCADE;
