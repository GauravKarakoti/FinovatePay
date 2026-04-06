-- Rollback: Create meta transactions table
DROP TABLE IF EXISTS meta_transactions CASCADE;
DROP INDEX IF EXISTS idx_meta_transactions_user CASCADE;
DROP INDEX IF EXISTS idx_meta_transactions_nonce CASCADE;
DROP INDEX IF EXISTS idx_meta_transactions_status CASCADE;
DROP FUNCTION IF EXISTS validate_meta_transaction_signature CASCADE;
