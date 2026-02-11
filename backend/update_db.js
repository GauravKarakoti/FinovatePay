const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'user',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'finovatepay',
  password: process.env.DB_PASSWORD || 'password',
  port: process.env.DB_PORT || 5432,
});

const createTables = async () => {
  try {
    // 1. Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        wallet_address VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50) NOT NULL, -- 'buyer', 'seller', 'investor'
        kyc_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Invoices Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        invoice_id VARCHAR(255) PRIMARY KEY, -- UUID from frontend
        user_id INTEGER REFERENCES users(id),
        amount DECIMAL(18, 2) NOT NULL,
        client VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'paid'
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        escrow_status VARCHAR(50) DEFAULT 'created', -- 'created', 'deposited', 'shipped', 'released', 'disputed'
        shipment_proof TEXT, -- Hash or Link to proof
        produce_type VARCHAR(255),
        quantity VARCHAR(255),
        origin VARCHAR(255),
        contract_address VARCHAR(255),
        invoice_hash VARCHAR(255),
        token_address VARCHAR(255)
      );
    `);

    // 3. Produce Lots Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS produce_lots (
        lot_id SERIAL PRIMARY KEY,
        seller_address VARCHAR(255) NOT NULL,
        produce_type VARCHAR(255) NOT NULL,
        quantity DECIMAL(18,2) NOT NULL,
        current_quantity DECIMAL(18,2) NOT NULL,
        quality_metrics JSONB, -- Store JSON data like { "grade": "A", "moisture": "12%" }
        harvest_date TIMESTAMP,
        origin VARCHAR(255),
        status VARCHAR(50) DEFAULT 'available',
        tx_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Quotations Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id SERIAL PRIMARY KEY,
        seller_address VARCHAR(255) NOT NULL,
        buyer_address VARCHAR(255) NOT NULL,
        produce_type VARCHAR(255) NOT NULL,
        quantity DECIMAL(18,2) NOT NULL,
        price_per_unit DECIMAL(18,2) NOT NULL,
        total_amount DECIMAL(18,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending', -- pending, accepted, rejected, converted
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ All Database Tables Created Successfully!");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  } finally {
    pool.end();
  }
};

createTables();