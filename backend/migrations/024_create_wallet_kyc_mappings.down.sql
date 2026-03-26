-- Rollback: Create wallet kyc mappings
DROP TABLE IF EXISTS wallet_kyc_mappings CASCADE;
DROP INDEX IF EXISTS idx_wallet_kyc_wallet_address CASCADE;
DROP INDEX IF EXISTS idx_wallet_kyc_user_id CASCADE;
