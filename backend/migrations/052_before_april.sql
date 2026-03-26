CREATE TABLE idempotency_keys (
    idempotency_key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL, -- Change UUID to INT if your user IDs are integers
    action VARCHAR(100) NOT NULL,
    request_path VARCHAR(255),
    response_code INT,
    response_body JSONB,
    status VARCHAR(20) DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (idempotency_key, user_id)
);

-- Optional: Auto-cleanup old keys (e.g., older than 30 days) to save space
CREATE INDEX idx_idempotency_created_at ON idempotency_keys(created_at);