-- Migration: Create Comprehensive Audit Logging System
-- Purpose: Track all financial operations for compliance and fraud detection
-- Date: 2026-02-27

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
-- Immutable record of all critical operations
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    operation_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    operation_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    actor_id INTEGER,
    actor_wallet VARCHAR(42),
    actor_role VARCHAR(20),
    action VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
    old_values JSONB,
    new_values JSONB,
    metadata JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT audit_logs_operation_type_check CHECK (
        operation_type IN (
            'ESCROW_RELEASE', 'ESCROW_DISPUTE', 'ESCROW_CREATE',
            'ADMIN_FREEZE', 'ADMIN_UNFREEZE', 'ADMIN_ROLE_CHANGE', 'ADMIN_RESOLVE_DISPUTE',
            'FINANCING_REQUEST', 'FINANCING_REPAY', 'FINANCING_TOKENIZE',
            'INVOICE_CREATE', 'INVOICE_SETTLE_EARLY', 'INVOICE_UPDATE',
            'PAYMENT_DEPOSIT', 'PAYMENT_RELEASE', 'PAYMENT_DISPUTE',
            'USER_LOGIN', 'USER_REGISTER', 'USER_ROLE_CHANGE',
            'KYC_INITIATE', 'KYC_VERIFY', 'KYC_OVERRIDE'
        )
    )
);

-- Indexes for fast audit queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_type ON audit_logs(operation_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_id ON audit_logs(operation_id);

-- ============================================
-- IDEMPOTENCY KEYS TABLE
-- ============================================
-- Prevent duplicate operations
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id SERIAL PRIMARY KEY,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    operation_type VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,
    request_body JSONB NOT NULL,
    response_body JSONB,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL
);

-- Index for fast idempotency lookups
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);

-- ============================================
-- FINANCIAL TRANSACTIONS TABLE
-- ============================================
-- Track all money movements
CREATE TABLE IF NOT EXISTS financial_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    transaction_type VARCHAR(50) NOT NULL CHECK (
        transaction_type IN (
            'ESCROW_DEPOSIT', 'ESCROW_RELEASE', 'ESCROW_REFUND',
            'FINANCING_DISBURSEMENT', 'FINANCING_REPAYMENT',
            'EARLY_SETTLEMENT', 'DISPUTE_RESOLUTION',
            'FEE_COLLECTION', 'PLATFORM_FEE'
        )
    ),
    invoice_id VARCHAR(255),
    from_address VARCHAR(42),
    to_address VARCHAR(42),
    amount DECIMAL(20, 8) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'USDC',
    blockchain_tx_hash VARCHAR(66),
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'FAILED', 'REVERSED')),
    initiated_by INTEGER,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP
);

-- Indexes for financial queries
CREATE INDEX IF NOT EXISTS idx_financial_tx_type ON financial_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_financial_tx_invoice_id ON financial_transactions(invoice_id);
CREATE INDEX IF NOT EXISTS idx_financial_tx_from_address ON financial_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_financial_tx_to_address ON financial_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_financial_tx_status ON financial_transactions(status);
CREATE INDEX IF NOT EXISTS idx_financial_tx_created_at ON financial_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_tx_blockchain_hash ON financial_transactions(blockchain_tx_hash);

-- ============================================
-- CLEANUP FUNCTION FOR EXPIRED IDEMPOTENCY KEYS
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all critical operations (compliance requirement)';
COMMENT ON TABLE idempotency_keys IS 'Prevents duplicate operations by tracking request idempotency keys';
COMMENT ON TABLE financial_transactions IS 'Tracks all money movements for financial reconciliation';
COMMENT ON COLUMN audit_logs.operation_id IS 'Unique identifier for this audit entry';
COMMENT ON COLUMN audit_logs.old_values IS 'State before the operation (JSON)';
COMMENT ON COLUMN audit_logs.new_values IS 'State after the operation (JSON)';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'Keys expire after 24 hours';
COMMENT ON COLUMN financial_transactions.amount IS 'Amount in smallest unit (e.g., wei for ETH, cents for USD)';
