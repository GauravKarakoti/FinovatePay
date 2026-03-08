-- Rollback: Create reconciliation logs
DROP TABLE IF EXISTS reconciliation_logs CASCADE;
DROP TABLE IF EXISTS reconciliation_discrepancies CASCADE;
DROP INDEX IF EXISTS idx_reconciliation_logs_timestamp CASCADE;
DROP INDEX IF EXISTS idx_reconciliation_discrepancies_invoice CASCADE;
DROP FUNCTION IF EXISTS detect_reconciliation_discrepancies CASCADE;
