-- Rollback: Create insurance policies
DROP TABLE IF EXISTS insurance_policy_claims CASCADE;
DROP TABLE IF EXISTS insurance_policies CASCADE;
DROP INDEX IF EXISTS idx_insurance_policies_invoice CASCADE;
DROP INDEX IF EXISTS idx_insurance_policies_status CASCADE;
DROP INDEX IF EXISTS idx_policy_claims_status CASCADE;
