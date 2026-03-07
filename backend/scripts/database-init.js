#!/usr/bin/env node

/**
 * Database Initialization Script
 * 
 * This script should be run once after database setup:
 * 1. Creates the _migrations table
 * 2. Optionally runs all pending migrations
 * 3. Seeds initial data if needed 
 * 
 * Usage:
 *   node scripts/database-init.js          # Initialize only
 *   node scripts/database-init.js --migrate # Initialize and run migrations
 *   node scripts/database-init.js --seed    # Initialize and seed data
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

async function initializeDatabase() {
  const client = await pool.connect();

  try {
    log('\n🚀 Initializing Database...\n', 'blue');

    // 1. Create extensions
    log('Creating PostgreSQL extensions...', 'cyan');
    const extensions = [
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"',
      'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
      'CREATE EXTENSION IF NOT EXISTS "pg_trgm"',
      'CREATE EXTENSION IF NOT EXISTS "citus"'
    ];

    for (const ext of extensions) {
      try {
        await client.query(ext);
        log(`  ✓ ${ext.split('IF NOT EXISTS ')[1]}`, 'green');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          log(`  ⚠ ${error.message}`, 'yellow');
        }
      }
    }

    // 2. Create base functions
    log('\nCreating base functions...', 'cyan');

    const baseFunctions = `
      -- Update timestamp function
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      -- UUIDs for cascade tracking
      CREATE OR REPLACE FUNCTION set_id_if_null()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.id IS NULL THEN
          NEW.id = gen_random_uuid();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await client.query(baseFunctions);
    log('  ✓ Base functions created', 'green');

    // 3. Create migrations table
    log('\nSetting up migrations tracking...', 'cyan');

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
    log('  ✓ Migrations table created', 'green');

    // 4. Verify critical tables exist
    log('\nVerifying schema...\n', 'cyan');

    const criticalTables = [
      'users',
      'invoices',
      'wallets'
    ];

    for (const table of criticalTables) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        )`,
        [table]
      );

      if (result.rows[0].exists) {
        log(`  ✓ ${table}`, 'green');
      } else {
        log(`  ✗ ${table} (missing - create via migrations)`, 'yellow');
      }
    }

    log('\n✅ Database initialization completed!', 'green');

    // Suggest next steps
    const args = process.argv.slice(2);
    log('\n📋 Next steps:', 'cyan');

    if (args.includes('--migrate')) {
      log('  Running migrations automatically...', 'yellow');
      return 'migrate';
    } else if (args.includes('--seed')) {
      log('  Run seeding after migrations...', 'yellow');
      return 'seed';
    } else {
      log('  1. npm run migrate:db       - Run database migrations', 'cyan');
      log('  2. npm run migrate:status   - Check migration status', 'cyan');
      log('  3. npm run seed:db          - Seed initial data', 'cyan');
      log('  4. npm start                - Start application', 'cyan');
    }

    return 'complete';
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations() {
  try {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const migrate = spawn('node', ['scripts/run-migrations.js', 'up'], {
        cwd: __dirname + '/..',
        stdio: 'inherit'
      });

      migrate.on('close', (code) => {
        resolve(code === 0);
      });
    });
  } catch (error) {
    log(`❌ Migration error: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  try {
    const nextStep = await initializeDatabase();

    if (args.includes('--migrate') && nextStep === 'migrate') {
      log('\n🔄 Running migrations...', 'blue');
      await runMigrations();
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    await pool.end();
    process.exit(1);
  }
}

main();
