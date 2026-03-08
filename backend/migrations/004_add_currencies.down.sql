-- Rollback: Add currencies
ALTER TABLE invoices DROP COLUMN IF EXISTS supported_currencies;
DROP TABLE IF EXISTS currencies CASCADE;
DROP INDEX IF EXISTS idx_currencies_code CASCADE;
