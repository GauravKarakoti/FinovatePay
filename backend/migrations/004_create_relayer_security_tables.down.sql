-- Rollback: Create relayer security tables
DROP TABLE IF EXISTS relayer_logs CASCADE;
DROP TABLE IF EXISTS relayer_security_config CASCADE;
DROP FUNCTION IF EXISTS rotate_relayer_key CASCADE;
DROP INDEX IF EXISTS idx_relayer_logs_timestamp CASCADE;
