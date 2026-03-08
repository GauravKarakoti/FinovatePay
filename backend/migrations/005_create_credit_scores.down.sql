-- Rollback: Create credit scores
DROP TABLE IF EXISTS credit_scores CASCADE;
DROP INDEX IF EXISTS idx_credit_scores_entity CASCADE;
DROP INDEX IF EXISTS idx_credit_scores_updated_at CASCADE;
