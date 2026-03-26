-- Rollback: Create dispute tables
DROP TABLE IF EXISTS dispute_evidence CASCADE;
DROP TABLE IF EXISTS dispute_messages CASCADE;
DROP TABLE IF EXISTS disputes CASCADE;
DROP INDEX IF EXISTS idx_disputes_invoice CASCADE;
DROP INDEX IF EXISTS idx_disputes_status CASCADE;
DROP INDEX IF EXISTS idx_dispute_messages_timestamp CASCADE;
DROP SEQUENCE IF EXISTS dispute_sequence;
