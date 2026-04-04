-- Rollback: Create email schema
DROP TRIGGER IF EXISTS update_email_logs_timestamp ON email_logs;
DROP TRIGGER IF EXISTS update_user_notification_preferences_timestamp ON user_notification_preferences;
DROP TRIGGER IF EXISTS update_email_templates_timestamp ON email_templates;

DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS user_notification_preferences CASCADE;
DROP TABLE IF EXISTS email_templates CASCADE;

DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;