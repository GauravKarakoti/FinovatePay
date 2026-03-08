require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
  });

  try {
const logger = require('../utils/logger')('migration');

    logger.info('Running migration...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../migrations/001_create_email_schema.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');

    // Execute migration
    await pool.query(sql);

    logger.info('Migration completed successfully!\n');
    logger.info('✓ email_logs table created');
    logger.info('✓ user_notification_preferences table created');
    logger.info('✓ email_templates table created');
    logger.info('✓ Indexes created');
    logger.info('✓ Triggers created');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

runMigration();