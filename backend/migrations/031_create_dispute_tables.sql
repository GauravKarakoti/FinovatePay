CREATE TABLE IF NOT EXISTS dispute_evidence (
  id SERIAL PRIMARY KEY,
  invoice_id VARCHAR(255),
  uploaded_by VARCHAR(255),
  file_url TEXT,
  file_name TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispute_logs (
  id SERIAL PRIMARY KEY,
  invoice_id VARCHAR(255),
  action VARCHAR(255),
  performed_by VARCHAR(255),
  notes TEXT,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disputes (
  invoice_id VARCHAR(255) PRIMARY KEY,
  status VARCHAR(50) DEFAULT 'open',
  resolved_by VARCHAR(255),
  resolution_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
