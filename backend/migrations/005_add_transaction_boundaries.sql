-- Migration: Add Transaction Boundaries and ACID Property Support
-- Date: 2026-03-08

-- =========================
-- 1. TRANSACTION STATES
-- =========================
CREATE TABLE IF NOT EXISTS transaction_states (
  id SERIAL PRIMARY KEY,
  correlation_id UUID UNIQUE NOT NULL,
  operation_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  current_state VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  steps_completed JSONB DEFAULT '[]',
  steps_remaining JSONB DEFAULT '[]',
  context_data JSONB DEFAULT '{}',
  initiated_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- =========================
-- 2. RECOVERY QUEUE
-- =========================
CREATE TABLE IF NOT EXISTS transaction_recovery_queue (
  id SERIAL PRIMARY KEY,
  correlation_id UUID NOT NULL UNIQUE,
  operation_type VARCHAR(100) NOT NULL,
  operation_data JSONB NOT NULL,
  retry_count INT DEFAULT 0,
  max_retries INT DEFAULT 5,
  next_retry_at TIMESTAMP NOT NULL,
  last_error TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (correlation_id) 
    REFERENCES transaction_states(correlation_id) 
    ON DELETE CASCADE
);

-- =========================
-- 3. DEAD LETTER QUEUE
-- =========================
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id SERIAL PRIMARY KEY,
  correlation_id UUID NOT NULL UNIQUE,
  operation_type VARCHAR(100) NOT NULL,
  operation_data JSONB NOT NULL,
  failure_reason TEXT NOT NULL,
  retry_count INT NOT NULL,
  last_error TEXT,
  requires_compensation BOOLEAN DEFAULT FALSE,
  compensation_status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (correlation_id) 
    REFERENCES transaction_states(correlation_id) 
    ON DELETE CASCADE
);

-- =========================
-- 4. IDEMPOTENCY KEYS
-- =========================
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  operation_type VARCHAR(100) NOT NULL,
  operation_data JSONB NOT NULL,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- =========================
-- 5. BLOCKCHAIN SNAPSHOTS
-- =========================
CREATE TABLE IF NOT EXISTS blockchain_operation_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_id UUID UNIQUE NOT NULL,
  operation_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  snapshot_type VARCHAR(20) NOT NULL,
  state_data JSONB NOT NULL,
  related_snapshot_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (related_snapshot_id) 
    REFERENCES blockchain_operation_snapshots(snapshot_id) 
    ON DELETE SET NULL
);

-- =========================
-- 6. AUDIT TRAIL
-- =========================
CREATE TABLE IF NOT EXISTS transaction_audit_trail (
  id SERIAL PRIMARY KEY,
  audit_id UUID UNIQUE NOT NULL,
  correlation_id UUID,
  operation_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id VARCHAR(255),
  status VARCHAR(50) NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address VARCHAR(50),
  user_agent TEXT,
  transaction_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),

  FOREIGN KEY (correlation_id) 
    REFERENCES transaction_states(correlation_id) 
    ON DELETE SET NULL
);

-- =========================
-- 7. FINANCIAL TRANSACTIONS
-- =========================
CREATE TABLE IF NOT EXISTS financial_transactions (
  id SERIAL PRIMARY KEY,
  transaction_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  invoice_id VARCHAR(255),
  transaction_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  blockchain_tx_hash VARCHAR(255),
  amount DECIMAL(20, 6),
  initiated_by VARCHAR(255),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =========================
-- INDEXES
-- =========================

-- transaction_states
CREATE INDEX IF NOT EXISTS idx_ts_correlation_id 
ON transaction_states(correlation_id);

CREATE INDEX IF NOT EXISTS idx_ts_operation_type 
ON transaction_states(operation_type);

CREATE INDEX IF NOT EXISTS idx_ts_entity_ref 
ON transaction_states(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_ts_current_state 
ON transaction_states(current_state);

CREATE INDEX IF NOT EXISTS idx_ts_created_at 
ON transaction_states(created_at);

CREATE INDEX IF NOT EXISTS idx_ts_context_gin 
ON transaction_states USING GIN (context_data);

-- transaction_recovery_queue
CREATE INDEX IF NOT EXISTS idx_trq_status_retry 
ON transaction_recovery_queue(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_trq_created_at 
ON transaction_recovery_queue(created_at);

-- dead_letter_queue
CREATE INDEX IF NOT EXISTS idx_dlq_compensation 
ON dead_letter_queue(requires_compensation, compensation_status);

CREATE INDEX IF NOT EXISTS idx_dlq_created_at 
ON dead_letter_queue(created_at);

-- idempotency_keys
CREATE INDEX IF NOT EXISTS idx_idem_operation_type 
ON idempotency_keys(operation_type);

CREATE INDEX IF NOT EXISTS idx_idem_created_at 
ON idempotency_keys(created_at);

-- blockchain_operation_snapshots
CREATE INDEX IF NOT EXISTS idx_bos_snapshot_id 
ON blockchain_operation_snapshots(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_bos_entity 
ON blockchain_operation_snapshots(operation_type, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_bos_snapshot_type 
ON blockchain_operation_snapshots(snapshot_type);

CREATE INDEX IF NOT EXISTS idx_bos_related 
ON blockchain_operation_snapshots(related_snapshot_id);

-- audit trail
CREATE INDEX IF NOT EXISTS idx_audit_entity_timeline 
ON transaction_audit_trail(entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_status 
ON transaction_audit_trail(status);

-- financial transactions
CREATE INDEX IF NOT EXISTS idx_ft_status 
ON financial_transactions(status);

CREATE INDEX IF NOT EXISTS idx_ft_created_at 
ON financial_transactions(created_at);

-- =========================
-- PARTIAL INDEXES (PERF)
-- =========================

CREATE INDEX IF NOT EXISTS idx_ts_active 
ON transaction_states(operation_type, entity_type, entity_id, current_state)
WHERE current_state != 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_trq_ready 
ON transaction_recovery_queue(next_retry_at, status)
WHERE status = 'PENDING';

-- =========================
-- TRIGGER: AUTO UPDATE TIMESTAMP
-- =========================

CREATE OR REPLACE FUNCTION update_transaction_states_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_transaction_states_timestamp 
ON transaction_states;

CREATE TRIGGER trigger_update_transaction_states_timestamp
BEFORE UPDATE ON transaction_states
FOR EACH ROW
EXECUTE FUNCTION update_transaction_states_timestamp();