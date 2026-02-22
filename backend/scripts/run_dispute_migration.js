const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const runMigration = async () => {
  const sqlFile = path.join(__dirname, '../migrations/dispute_tables.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');

  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Dispute tables migration completed successfully.');
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
};

runMigration();