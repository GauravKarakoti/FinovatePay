const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }
});

// 1. Basic Table Schema (Create this if it doesn't exist)
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS invoices (
    invoice_id SERIAL PRIMARY KEY,
    client VARCHAR(255),
    amount VARCHAR(255),
    due_date DATE,
    status VARCHAR(50) DEFAULT 'pending',
    seller_address VARCHAR(255),
    buyer_address VARCHAR(255),
    escrow_status VARCHAR(50) DEFAULT 'created',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

// 2. The New Columns you want to add
const alterTableQuery = `
  ALTER TABLE invoices 
  ADD COLUMN IF NOT EXISTS lot_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS financing_status VARCHAR(50) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS is_tokenized BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS token_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS remaining_supply NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS is_discountable BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS annual_apr NUMERIC(5, 2) DEFAULT 18.00,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS early_paid_amount NUMERIC(20, 2),
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS release_tx_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS shipment_proof_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
  ADD COLUMN IF NOT EXISTS escrow_tx_hash VARCHAR(255);
`;

(async () => {
  try {
    console.log("🔌 Connecting to database...");
    
    // Step 1: Create Table
    await pool.query(createTableQuery);
    console.log("✅ Verified 'invoices' table exists.");

    // Step 2: Add Columns
    await pool.query(alterTableQuery);
    console.log("✅ SUCCESS! Database columns added.");

  } catch (err) {
    console.error("❌ ERROR DETAILS:", err); 
  } finally {
    await pool.end();
  }
})();
