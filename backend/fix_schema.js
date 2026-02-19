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

const fixDatabase = async () => {
  try {
    console.log("🛠️ Updating Database Schema...");

    // 1. Reset the Users table to include Registration fields
    // We drop invoices first because they link to users
    await pool.query('DROP TABLE IF EXISTS invoices CASCADE');
    await pool.query('DROP TABLE IF EXISTS users CASCADE');
    
    // 2. Create the correct Users table
    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        wallet_address VARCHAR(255) UNIQUE,
        company_name VARCHAR(255),
        phone VARCHAR(50),
        role VARCHAR(50) DEFAULT 'seller', -- ✅ Default role is now SELLER
        kyc_status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // 3. Re-create Invoices table
    await pool.query(`
      CREATE TABLE invoices (
        invoice_id VARCHAR(255) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        amount DECIMAL(18, 2) NOT NULL,
        client VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending',
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        escrow_status VARCHAR(50) DEFAULT 'created',
        shipment_proof TEXT,
        produce_type VARCHAR(255),
        quantity VARCHAR(255),
        origin VARCHAR(255),
        contract_address VARCHAR(255),
        invoice_hash VARCHAR(255),
        token_address VARCHAR(255)
      );
    `);

    console.log("✅ Database Fixed! The next user you register will be a SELLER.");
  } catch (err) {
    console.error("❌ Error:", err);
  } finally {
    pool.end();
  }
};

fixDatabase();