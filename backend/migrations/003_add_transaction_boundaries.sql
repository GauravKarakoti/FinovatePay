-- Migration: Add Transaction Boundaries and ACID Property Support
-- Date: 2026-03-08
-- Purpose: Create tables to support transaction tracking, recovery, and audit trails

-- Transaction States Table
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
  completed_at TIMESTAMP,
  
  INDEX idx_correlation_id (correlation_id),
  INDEX idx_operation_type (operation_type),
  INDEX idx_entity_ref (entity_type, entity_id),
  INDEX idx_current_state (current_state),
  INDEX idx_created_at (created_at)
);

-- Transaction Recovery Queue Table
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
  
  FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE CASCADE,
  INDEX idx_status_retry (status, next_retry_at),
  INDEX idx_correlation_id (correlation_id),
  INDEX idx_created_at (created_at)
);

-- Dead Letter Queue Table
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
  
  FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE CASCADE,
  INDEX idx_requires_compensation (requires_compensation, compensation_status),
  INDEX idx_correlation_id (correlation_id),
  INDEX idx_created_at (created_at)
);

-- Idempotency Keys Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key VARCHAR(255) PRIMARY KEY,
  operation_type VARCHAR(100) NOT NULL,
  operation_data JSONB NOT NULL,
  result JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_operation_type (operation_type),
  INDEX idx_created_at (created_at)
);

-- Blockchain Operation Snapshots Table
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
  
  FOREIGN KEY (related_snapshot_id) REFERENCES blockchain_operation_snapshots(snapshot_id) ON DELETE SET NULL,
  INDEX idx_snapshot_id (snapshot_id),
  INDEX idx_operation_entity (operation_type, entity_type, entity_id),
  INDEX idx_snapshot_type (snapshot_type),
  INDEX idx_related_snapshot (related_snapshot_id),
  INDEX idx_created_at (created_at)
);

-- Transaction Audit Trail Table
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
  
  FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE SET NULL,
  INDEX idx_audit_id (audit_id),
  INDEX idx_correlation_id (correlation_id),
  INDEX idx_operation_type (operation_type),
  INDEX idx_entity_ref (entity_type, entity_id),
  INDEX idx_actor_id (actor_id),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  INDEX idx_tx_hash (transaction_hash)
);

-- Financial Transactions Table (enhanced for audit)
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
  updated_at TIMESTAMP DEFAULT NOW(),
  
  INDEX idx_transaction_id (transaction_id),
  INDEX idx_invoice_id (invoice_id),
  INDEX idx_tx_hash (blockchain_tx_hash),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_transaction_states_search 
ON transaction_states(operation_type, entity_type, entity_id, current_state)
WHERE current_state != 'COMPLETED';

CREATE INDEX IF NOT EXISTS idx_recovery_queue_ready 
ON transaction_recovery_queue(next_retry_at, status)
WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_snapshots_pair 
ON blockchain_operation_snapshots(snapshot_id, related_snapshot_id, snapshot_type);

CREATE INDEX IF NOT EXISTS idx_audit_entity_timeline 
ON transaction_audit_trail(entity_type, entity_id, created_at DESC);

-- Add audit trigger for transaction_states table
CREATE OR REPLACE FUNCTION update_transaction_states_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_transaction_states_timestamp ON transaction_states;
CREATE TRIGGER trigger_update_transaction_states_timestamp
  BEFORE UPDATE ON transaction_states
  FOR EACH ROW
  EXECUTE FUNCTION update_transaction_states_timestamp();
