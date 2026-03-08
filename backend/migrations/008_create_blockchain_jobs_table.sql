-- Migration: 008_create_blockchain_jobs_table.sql
-- Creates table for tracking blockchain transaction jobs
-- This provides persistent storage for blockchain jobs independent of Redis

-- Create blockchain_jobs table
CREATE TABLE IF NOT EXISTS blockchain_jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(255) UNIQUE NOT NULL,
    job_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    payload JSONB,
    result JSONB,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    scheduled_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_job_id ON blockchain_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_status ON blockchain_jobs(status);
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_job_type ON blockchain_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_created_at ON blockchain_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_scheduled_at ON blockchain_jobs(scheduled_at) WHERE status = 'pending';

-- Create composite index for job type and status queries
CREATE INDEX IF NOT EXISTS idx_blockchain_jobs_type_status ON blockchain_jobs(job_type, status);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_blockchain_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_blockchain_jobs_updated_at
    BEFORE UPDATE ON blockchain_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_blockchain_jobs_updated_at();

-- Add comments for documentation
COMMENT ON TABLE blockchain_jobs IS 'Tracks blockchain transaction jobs for the queue system';
COMMENT ON COLUMN blockchain_jobs.job_id IS 'Unique identifier from BullMQ';
COMMENT ON COLUMN blockchain_jobs.job_type IS 'Type of blockchain operation (e.g., escrow:release, streaming:create)';
COMMENT ON COLUMN blockchain_jobs.status IS 'Current job status: pending, processing, retrying, completed, failed';
COMMENT ON COLUMN blockchain_jobs.payload IS 'Original job data/parameters';
COMMENT ON COLUMN blockchain_jobs.result IS 'Result of successful job execution';
COMMENT ON COLUMN blockchain_jobs.attempts IS 'Number of attempts made';
COMMENT ON COLUMN blockchain_jobs.priority IS 'Job priority (higher = more important)';

-- Create view for active jobs
CREATE OR REPLACE VIEW blockchain_jobs_active AS
SELECT 
    job_id,
    job_type,
    status,
    payload,
    attempts,
    created_at,
    started_at,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(started_at, created_at))) as duration_seconds
FROM blockchain_jobs
WHERE status IN ('pending', 'processing', 'retrying')
ORDER BY priority DESC, created_at ASC;

-- Create view for recent completed jobs
CREATE OR REPLACE VIEW blockchain_jobs_recent_completed AS
SELECT 
    job_id,
    job_type,
    status,
    payload->>'invoiceId' as invoice_id,
    payload->>'streamId' as stream_id,
    result->>'txHash' as tx_hash,
    result->>'blockNumber' as block_number,
    result->>'gasUsed' as gas_used,
    created_at,
    completed_at,
    EXTRACT(EPOCH FROM (completed_at - started_at)) as processing_time_seconds
FROM blockchain_jobs
WHERE status = 'completed'
ORDER BY completed_at DESC
LIMIT 100;

-- Create view for failed jobs
CREATE OR REPLACE VIEW blockchain_jobs_failed AS
SELECT 
    job_id,
    job_type,
    status,
    payload,
    error_message,
    attempts,
    max_attempts,
    created_at,
    updated_at
FROM blockchain_jobs
WHERE status = 'failed'
ORDER BY updated_at DESC;

-- Create function to get job statistics
CREATE OR REPLACE FUNCTION get_blockchain_job_stats()
RETURNS TABLE (
    total_jobs BIGINT,
    pending_jobs BIGINT,
    processing_jobs BIGINT,
    completed_jobs BIGINT,
    failed_jobs BIGINT,
    retrying_jobs BIGINT,
    avg_processing_time_seconds NUMERIC,
    success_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_jobs,
        COUNT(*) FILTER (WHERE status = 'pending')::BIGINT as pending_jobs,
        COUNT(*) FILTER (WHERE status = 'processing')::BIGINT as processing_jobs,
        COUNT(*) FILTER (WHERE status = 'completed')::BIGINT as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed')::BIGINT as failed_jobs,
        COUNT(*) FILTER (WHERE status = 'retrying')::BIGINT as retrying_jobs,
        COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE status = 'completed'), 0)::NUMERIC as avg_processing_time_seconds,
        CASE 
            WHEN COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) > 0 
            THEN ROUND(COUNT(*) FILTER (WHERE status = 'completed')::NUMERIC / 
                 COUNT(*) FILTER (WHERE status IN ('completed', 'failed'))::NUMERIC * 100, 2)
            ELSE 0
        END as success_rate
    FROM blockchain_jobs
    WHERE created_at > NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;
