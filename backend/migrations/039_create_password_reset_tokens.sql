-- Migration: Create password reset tokens table
-- Description: Stores secure tokens for password reset functionality
-- Created: 2024

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_password_reset_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at);

-- Add comment
COMMENT ON TABLE password_reset_tokens IS 'Stores password reset tokens with expiration and one-time use tracking';
COMMENT ON COLUMN password_reset_tokens.token IS 'Cryptographically secure random token';
COMMENT ON COLUMN password_reset_tokens.expires_at IS 'Token expiration timestamp (15 minutes from creation)';
COMMENT ON COLUMN password_reset_tokens.used IS 'Flag to ensure one-time use';
