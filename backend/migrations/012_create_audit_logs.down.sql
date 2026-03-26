-- Rollback: Create audit logs
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP FUNCTION IF EXISTS fn_track_audit_logs CASCADE;
DROP INDEX IF EXISTS idx_audit_logs_user CASCADE;
DROP INDEX IF EXISTS idx_audit_logs_entity CASCADE;
DROP INDEX IF EXISTS idx_audit_logs_timestamp CASCADE;
