#!/usr/bin/env node

/**
 * Migration Initialization Script
 * 
 * This script:
 * - Creates the _migrations tracking table
 * - Marks existing migrations in the directory as applied
 * - Allows fresh starts without re-running migrations
 * 
 * Useful after initial setup or when connecting a new database
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 5432,
  ssl: { rejectUnauthorized: false },
};

const pool = new Pool(dbConfig);
const migrationsDir = path.join(__dirname, '../migrations');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function initializeMigrations() {
  const client = await pool.connect();

  try {
    log('\n🚀 Initializing migrations system...\n', 'blue');

    // Create migrations table
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        batch INTEGER NOT NULL,
        execution_time_ms INTEGER,
        status VARCHAR(20) DEFAULT 'completed'
      );
      
      CREATE INDEX IF NOT EXISTS idx_migrations_name ON _migrations(name);
      CREATE INDEX IF NOT EXISTS idx_migrations_batch ON _migrations(batch);
    `;

    await client.query(createTableSQL);
    log('✓ Created _migrations tracking table', 'green');

    // Get existing migrations
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.endsWith('.down.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      log('⚠ No migration files found in migrations directory', 'yellow');
      log('', 'reset');
      return;
    }

    // Check if migrations already exist
    const result = await client.query(
      'SELECT COUNT(*) as count FROM _migrations'
    );

    const migrationCount = result.rows[0].count;

    if (migrationCount > 0) {
      log(`✓ Found ${migrationCount} existing migration record(s)`, 'cyan');
      log(
        '\n⚠ Migrations already exist in tracking table.',
        'yellow'
      );
      log(
        'Use "npm run migrate:status" to check the current state.\n',
        'yellow'
      );
      return;
    }

    // Mark all existing migrations as applied
    log(
      `\nMarking ${migrationFiles.length} migration file(s) as applied...`,
      'cyan'
    );

    for (const migrationFile of migrationFiles) {
      await client.query(
        `INSERT INTO _migrations (name, batch, execution_time_ms, status) 
         VALUES ($1, $2, $3, $4)`,
        [migrationFile, 1, 0, 'completed']
      );
      log(`  ✓ ${migrationFile}`, 'cyan');
    }

    log(`\n✅ Migration system initialized successfully!`, 'green');
    log(`\nMigrations registered: ${migrationFiles.length}`, 'cyan');
    log(`\nYou can now use:`, 'blue');
    log(`  npm run migrate:db      - Run new migrations`, 'cyan');
    log(`  npm run migrate:down    - Rollback migrations`, 'cyan');
    log(`  npm run migrate:status  - Check migration status\n`, 'cyan');
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
  } finally {
    client.release();
    await pool.end();
  }
}

initializeMigrations();
