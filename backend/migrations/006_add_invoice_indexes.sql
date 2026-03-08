-- ============================================
-- ADD INDEXES TO INVOICES TABLE
-- ============================================
-- Purpose: Improve query performance for frequently filtered columns
-- Issue: Missing indexes causing slow queries on seller_address, buyer_address, escrow_status

-- Index for seller queries (Invoice.findBySeller)
CREATE INDEX IF NOT EXISTS idx_invoices_seller_address ON invoices(seller_address);

-- Index for buyer queries (Invoice.findByBuyer)
CREATE INDEX IF NOT EXISTS idx_invoices_buyer_address ON invoices(buyer_address);

-- Index for escrow status filtering (common in admin dashboard and status checks)
CREATE INDEX IF NOT EXISTS idx_invoices_escrow_status ON invoices(escrow_status);

-- Index for invoice_hash lookups (used in financing service)
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_hash ON invoices(invoice_hash);

-- Composite index for common query pattern: seller + escrow_status
CREATE INDEX IF NOT EXISTS idx_invoices_seller_escrow_status ON invoices(seller_address, escrow_status);

-- Composite index for common query pattern: buyer + escrow_status
CREATE INDEX IF NOT EXISTS idx_invoices_buyer_escrow_status ON invoices(buyer_address, escrow_status);

-- Index for created_at ordering (most list queries ORDER BY created_at DESC)
CREATE INDEX IF NOT EXISTS idx_invoices_created_at_desc ON invoices(created_at DESC);

-- Index for financing status filtering
CREATE INDEX IF NOT EXISTS idx_invoices_financing_status ON invoices(financing_status);

-- ============================================
-- ADD INDEXES TO QUOTATIONS TABLE
-- ============================================
-- Index for seller/buyer address lookups
CREATE INDEX IF NOT EXISTS idx_quotations_seller_address ON quotations(seller_address);
CREATE INDEX IF NOT EXISTS idx_quotations_buyer_address ON quotations(buyer_address);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);

-- Composite index for common query: buyer + status
CREATE INDEX IF NOT EXISTS idx_quotations_buyer_status ON quotations(buyer_address, status);

-- Composite index for common query: seller + status
CREATE INDEX IF NOT EXISTS idx_quotations_seller_status ON quotations(seller_address, status);

-- ============================================
-- ADD INDEXES TO PRODUCE_LOTS TABLE
-- ============================================
-- Index for farmer address lookups
CREATE INDEX IF NOT EXISTS idx_produce_lots_farmer_address ON produce_lots(farmer_address);

-- Index for produce type filtering
CREATE INDEX IF NOT EXISTS idx_produce_lots_produce_type ON produce_lots(produce_type);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Run these to verify indexes were created:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'invoices';
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'quotations';
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'produce_lots';
