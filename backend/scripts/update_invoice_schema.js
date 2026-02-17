require('dotenv').config();
const { pool } = require('../config/database');

const updateSchema = async () => {
  const client = await pool.connect();
  try {
    console.log('🔄 Checking invoices table schema...');

    // Add tx_hash column
    await client.query(`
      ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS tx_hash TEXT;
    `);
    console.log('✅ Added tx_hash column (if missing).');

    // Add updated_at column
    await client.query(`
      ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('✅ Added updated_at column (if missing).');

    // Ensure status has default value 'CREATED' if not set
    await client.query(`
      ALTER TABLE invoices
      ALTER COLUMN status SET DEFAULT 'CREATED';
    `);
    console.log('✅ Set default value for status to CREATED.');

    // Add discount columns
    await client.query(`
      ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS discount_rate INTEGER DEFAULT 0;
    `);
    console.log('✅ Added discount_rate column.');

    await client.query(`
      ALTER TABLE invoices
      ADD COLUMN IF NOT EXISTS discount_deadline BIGINT DEFAULT 0;
    `);
    console.log('✅ Added discount_deadline column.');

    console.log('🚀 Schema update complete!');
  } catch (err) {
    console.error('❌ Error updating schema:', err);
  } finally {
    client.release();
    pool.end();
  }
};

updateSchema();
