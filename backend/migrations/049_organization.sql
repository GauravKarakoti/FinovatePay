ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE,
  ADD COLUMN IF NOT EXISTS domain VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS custom_domains TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_invoices INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
  ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- You might also need to populate a placeholder slug for existing rows since it's supposed to be UNIQUE NOT NULL
UPDATE organizations SET slug = 'org-' || id WHERE slug IS NULL;
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;

-- Drop the existing strict constraint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

-- Add the updated constraint including all states from your application logic
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check 
CHECK (status IN (
    'created', 
    'CREATED', 
    'PAYMENT_PENDING', 
    'ESCROW_LOCKED', 
    'RELEASED', 
    'DISPUTED', 
    'CANCELLED', 
    'FAILED', 
    'SETTLED'
));

ALTER TABLE invoices 
ADD COLUMN discount_rate INTEGER DEFAULT NULL,
ADD COLUMN discount_deadline TIMESTAMPTZ DEFAULT NULL;

-- Optional: Add a comment to clarify that rate is in Basis Points (BPS)
COMMENT ON COLUMN invoices.discount_rate IS 'Discount rate in basis points (100 = 1%)';

ALTER TABLE invoices ALTER COLUMN token_id TYPE VARCHAR(255);