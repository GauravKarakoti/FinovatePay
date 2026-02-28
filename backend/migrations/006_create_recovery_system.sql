-- Migration: Create Transaction Recovery & Dead Letter Queue System
-- Purpose: Handle failed multi-step operations with automatic retry and monitoring
-- Date: 2026-02-27

-- ============================================
-- TRANSACTION STATES TABLE
-- ============================================
-- Track progress of multi-step transactions
CREATE TABLE IF NOT EXISTS transaction_states (
    id SERIAL PRIMARY KEY,
    correlation_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    operation_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    current_state VARCHAR(50) NOT NULL CHECK (
        current_state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DLQ', 'COMPENSATING', 'COMPENSATED')
    ),
    steps_completed JSONB DEFAULT '[]'::jsonb,
    steps_remaining JSONB DEFAULT '[]'::jsonb,
    context_data JSONB,
    initiated_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    CONSTRAINT transaction_states_operation_type_check CHECK (
        operation_type IN (
            'FINANCING_PIPELINE', 'ESCROW_RELEASE', 'ESCROW_DISPUTE',
            'EVENT_PROCESSING', 'TOKENIZATION', 'BRIDGE_TRANSFER'
        )
    )
);

-- Indexes for transaction state queries
CREATE INDEX IF NOT EXISTS idx_transaction_states_correlation_id ON transaction_states(correlation_id);
CREATE INDEX IF NOT EXISTS idx_transaction_states_current_state ON transaction_states(current_state);
CREATE INDEX IF NOT EXISTS idx_transaction_states_operation_type ON transaction_states(operation_type);
CREATE INDEX IF NOT EXISTS idx_transaction_states_entity_id ON transaction_states(entity_id);
CREATE INDEX IF NOT EXISTS idx_transaction_states_created_at ON transaction_states(created_at DESC);

-- ============================================
-- TRANSACTION RECOVERY QUEUE TABLE
-- ============================================
-- Queue for failed operations that need retry
CREATE TABLE IF NOT EXISTS transaction_recovery_queue (
    id SERIAL PRIMARY KEY,
    correlation_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    operation_data JSONB NOT NULL,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at TIMESTAMP NOT NULL,
    last_error TEXT,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE CASCADE
);

-- Indexes for recovery queue
CREATE INDEX IF NOT EXISTS idx_recovery_queue_correlation_id ON transaction_recovery_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_status ON transaction_recovery_queue(status);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_next_retry_at ON transaction_recovery_queue(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_operation_type ON transaction_recovery_queue(operation_type);

-- ============================================
-- DEAD LETTER QUEUE TABLE
-- ============================================
-- Permanently failed operations for manual intervention
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id SERIAL PRIMARY KEY,
    correlation_id UUID NOT NULL,
    operation_type VARCHAR(50) NOT NULL,
    operation_data JSONB NOT NULL,
    failure_reason TEXT NOT NULL,
    retry_count INTEGER NOT NULL,
    last_error TEXT,
    requires_compensation BOOLEAN DEFAULT FALSE,
    compensation_status VARCHAR(20) CHECK (compensation_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TIMESTAMP,
    resolved_by INTEGER,
    resolution_notes TEXT,
    FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE CASCADE
);

-- Indexes for dead letter queue
CREATE INDEX IF NOT EXISTS idx_dlq_correlation_id ON dead_letter_queue(correlation_id);
CREATE INDEX IF NOT EXISTS idx_dlq_operation_type ON dead_letter_queue(operation_type);
CREATE INDEX IF NOT EXISTS idx_dlq_requires_compensation ON dead_letter_queue(requires_compensation);
CREATE INDEX IF NOT EXISTS idx_dlq_compensation_status ON dead_letter_queue(compensation_status);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON dead_letter_queue(created_at DESC);

-- ============================================
-- SYSTEM HEALTH METRICS TABLE
-- ============================================
-- Track system health and transaction metrics
CREATE TABLE IF NOT EXISTS system_health_metrics (
    id SERIAL PRIMARY KEY,
    metric_type VARCHAR(50) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(20, 4) NOT NULL,
    metadata JSONB,
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT system_health_metrics_type_check CHECK (
        metric_type IN (
            'SUCCESS_RATE', 'RETRY_COUNT', 'DLQ_SIZE', 'AVG_PROCESSING_TIME',
            'STUCK_TRANSACTIONS', 'COMPENSATION_RATE', 'ERROR_RATE'
        )
    )
);

-- Indexes for metrics
CREATE INDEX IF NOT EXISTS idx_health_metrics_type ON system_health_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_health_metrics_name ON system_health_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_health_metrics_recorded_at ON system_health_metrics(recorded_at DESC);

-- ============================================
-- COMPENSATION ACTIONS TABLE
-- ============================================
-- Track compensation actions for partial failures
CREATE TABLE IF NOT EXISTS compensation_actions (
    id SERIAL PRIMARY KEY,
    correlation_id UUID NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    action_description TEXT NOT NULL,
    action_data JSONB,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    executed_at TIMESTAMP,
    executed_by INTEGER,
    result JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (correlation_id) REFERENCES transaction_states(correlation_id) ON DELETE CASCADE
);

-- Indexes for compensation actions
CREATE INDEX IF NOT EXISTS idx_compensation_correlation_id ON compensation_actions(correlation_id);
CREATE INDEX IF NOT EXISTS idx_compensation_status ON compensation_actions(status);
CREATE INDEX IF NOT EXISTS idx_compensation_action_type ON compensation_actions(action_type);

-- ============================================
-- TRIGGERS
-- ============================================

-- Update updated_at timestamp for transaction_states
CREATE OR REPLACE FUNCTION update_transaction_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_transaction_state_timestamp
BEFORE UPDATE ON transaction_states
FOR EACH ROW
EXECUTE FUNCTION update_transaction_state_timestamp();

-- Update updated_at timestamp for recovery queue
CREATE TRIGGER trigger_update_recovery_queue_timestamp
BEFORE UPDATE ON transaction_recovery_queue
FOR EACH ROW
EXECUTE FUNCTION update_transaction_state_timestamp();

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Get stuck transactions (processing for > 5 minutes)
CREATE OR REPLACE FUNCTION get_stuck_transactions()
RETURNS TABLE (
    correlation_id UUID,
    operation_type VARCHAR,
    current_state VARCHAR,
    minutes_stuck INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ts.correlation_id,
        ts.operation_type,
        ts.current_state,
        EXTRACT(EPOCH FROM (NOW() - ts.updated_at))::INTEGER / 60 AS minutes_stuck
    FROM transaction_states ts
    WHERE ts.current_state IN ('PROCESSING', 'COMPENSATING')
    AND ts.updated_at < NOW() - INTERVAL '5 minutes'
    ORDER BY ts.updated_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Get DLQ statistics
CREATE OR REPLACE FUNCTION get_dlq_stats()
RETURNS TABLE (
    operation_type VARCHAR,
    count BIGINT,
    requires_compensation_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        dlq.operation_type,
        COUNT(*)::BIGINT AS count,
        COUNT(*) FILTER (WHERE dlq.requires_compensation = TRUE)::BIGINT AS requires_compensation_count
    FROM dead_letter_queue dlq
    WHERE dlq.resolved_at IS NULL
    GROUP BY dlq.operation_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE transaction_states IS 'Tracks progress of multi-step transactions across systems';
COMMENT ON TABLE transaction_recovery_queue IS 'Queue for failed operations that need automatic retry';
COMMENT ON TABLE dead_letter_queue IS 'Permanently failed operations requiring manual intervention';
COMMENT ON TABLE system_health_metrics IS 'System health and transaction metrics for monitoring';
COMMENT ON TABLE compensation_actions IS 'Compensation actions for partial transaction failures';
COMMENT ON COLUMN transaction_states.correlation_id IS 'Unique identifier for tracking transaction across all systems';
COMMENT ON COLUMN transaction_states.steps_completed IS 'Array of completed steps in the transaction';
COMMENT ON COLUMN transaction_states.steps_remaining IS 'Array of remaining steps to complete';
COMMENT ON COLUMN dead_letter_queue.requires_compensation IS 'Whether this failure requires compensation (e.g., refund)';
