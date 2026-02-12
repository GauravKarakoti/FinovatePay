-- ============================================
-- CREATE EMAIL LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER,
  recipient_email VARCHAR(255) NOT NULL,
  template_name VARCHAR(100),
  event_type VARCHAR(50),
  subject VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  sent_at TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT email_logs_status_check CHECK (status IN ('pending', 'sent', 'failed', 'bounced'))
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient ON email_logs(recipient_email);

-- ============================================
-- CREATE USER NOTIFICATION PREFERENCES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS user_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER UNIQUE,
  invoice_notifications BOOLEAN DEFAULT true,
  payment_notifications BOOLEAN DEFAULT true,
  dispute_notifications BOOLEAN DEFAULT true,
  shipment_notifications BOOLEAN DEFAULT true,
  kyc_notifications BOOLEAN DEFAULT true,
  email_frequency VARCHAR(20) DEFAULT 'immediate',
  unsubscribe_token VARCHAR(100) UNIQUE,
  is_subscribed BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT email_frequency_check CHECK (email_frequency IN ('immediate', 'daily', 'weekly', 'never'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user_id ON user_notification_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_token ON user_notification_preferences(unsubscribe_token);

-- ============================================
-- CREATE EMAIL TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) UNIQUE NOT NULL,
  subject VARCHAR(255) NOT NULL,
  html_content TEXT NOT NULL,
  text_content TEXT,
  variables JSONB,
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_email_templates_name ON email_templates(name);
CREATE INDEX IF NOT EXISTS idx_email_templates_active ON email_templates(is_active);

-- ============================================
-- CREATE TRIGGER FUNCTION FOR UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;
CREATE TRIGGER update_email_logs_updated_at BEFORE UPDATE ON email_logs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_email_templates_updated_at ON email_templates;
CREATE TRIGGER update_email_templates_updated_at BEFORE UPDATE ON email_templates
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notification_prefs_updated_at ON user_notification_preferences;
CREATE TRIGGER update_notification_prefs_updated_at BEFORE UPDATE ON user_notification_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- MIGRATION VERIFICATION
-- ============================================
-- Run these to verify tables were created:
-- \dt email_logs;
-- \dt user_notification_preferences;
-- \dt email_templates;
