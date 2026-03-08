-- Rollback: Create streaming payments
DROP TABLE IF EXISTS streaming_payments CASCADE;
DROP INDEX IF EXISTS idx_streaming_payments_invoice CASCADE;
DROP INDEX IF EXISTS idx_streaming_payments_recipient CASCADE;
DROP INDEX IF EXISTS idx_streaming_payments_status CASCADE;
