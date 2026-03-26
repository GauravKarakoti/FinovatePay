-- Rollback: Create event sync table
DROP TABLE IF EXISTS event_sync_logs CASCADE;
DROP FUNCTION IF EXISTS notify_event_sync CASCADE;
DROP INDEX IF EXISTS idx_event_sync_entity CASCADE;
