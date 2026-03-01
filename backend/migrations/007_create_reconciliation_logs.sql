-- Reconciliation Logs Table
-- Stores reconciliation results between on-chain escrow events and off-chain invoice records

CREATE TABLE IF NOT EXISTS reconciliation_logs (
    id SERIAL PRIMARY KEY,
    invoice_id VARCHAR(66) NOT NULL,
    chain_status VARCHAR(20) NOT NULL CHECK (chain_status IN ('created', 'funded', 'disputed', 'released', 'expired', 'not_found', 'error')),
    db_status VARCHAR(20) NOT NULL CHECK (db_status IN ('created', 'payment_pending', 'escrow_locked', 'funded', 'released', 'disputed', 'cancelled', 'failed', 'settled', 'not_found')),
    chain_amount VARCHAR(78),
    db_amount VARCHAR(78),
    discrepancy_amount VARCHAR(78) DEFAULT '0',
    discrepancy_type VARCHAR(20) CHECK (discrepancy_type IN ('none', 'amount_mismatch', 'status_mismatch', 'missing_chain', 'missing_db')),
    chain_buyer VARCHAR(42),
    db_buyer VARCHAR(42),
    chain_seller VARCHAR(42),
    db_seller VARCHAR(42),
    reconciliation_type VARCHAR(20) DEFAULT 'full' CHECK (reconciliation_type IN ('full', 'partial', 'manual', 'scheduled')),
    run_id VARCHAR(36),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_reconciliation_invoice ON reconciliation_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_run_id ON reconciliation_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_created ON reconciliation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancy ON reconciliation_logs(discrepancy_type) WHERE discrepancy_type != 'none';
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON reconciliation_logs(chain_status, db_status);

-- Reconciliation Summary Table
-- Stores summary information for each reconciliation run

CREATE TABLE IF NOT EXISTS reconciliation_summary (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(36) UNIQUE NOT NULL,
    run_type VARCHAR(20) NOT NULL CHECK (run_type IN ('full', 'partial', 'manual', 'scheduled')),
    total_invoices INTEGER NOT NULL DEFAULT 0,
    matched_count INTEGER NOT NULL DEFAULT 0,
    discrepancy_count INTEGER NOT NULL DEFAULT 0,
    missing_chain_count INTEGER NOT NULL DEFAULT 0,
    missing_db_count INTEGER NOT NULL DEFAULT 0,
    total_discrepancy_amount VARCHAR(78) DEFAULT '0',
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for reconciliation summary
CREATE INDEX IF NOT EXISTS idx_reconciliation_summary_run ON reconciliation_summary(run_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_summary_status ON reconciliation_summary(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_summary_created ON reconciliation_summary(created_at DESC);

-- Trigger to update updated_at timestamp (if update_updated_at_column function exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        CREATE TRIGGER update_reconciliation_summary_updated_at
            BEFORE UPDATE ON reconciliation_summary
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

COMMENT ON TABLE reconciliation_logs IS 'Stores individual invoice reconciliation results between blockchain and database';
COMMENT ON TABLE reconciliation_summary IS 'Stores summary information for each reconciliation run';
COMMENT ON COLUMN reconciliation_logs.discrepancy_type IS 'Type of discrepancy detected: none, amount_mismatch, status_mismatch, missing_chain, missing_db';
COMMENT ON COLUMN reconciliation_logs.run_id IS 'Unique identifier for a reconciliation run';
