-- Rollback: Create recovery system tables
DROP TABLE IF EXISTS recovery_keys CASCADE;
DROP TABLE IF EXISTS recovery_attempts CASCADE;
DROP FUNCTION IF EXISTS validate_recovery_key CASCADE;
DROP INDEX IF EXISTS idx_recovery_keys_user CASCADE;
DROP INDEX IF EXISTS idx_recovery_attempts_timestamp CASCADE;
