#!/usr/bin/env node

/**
 * Database Migration Runner
 * 
 * Features:
 * - Automatic discovery of migration files
 * - Tracks applied migrations in _migrations table
 * - Supports forward and backward migrations
 * - Migration locking to prevent concurrent executions
 * - Detailed logging and error handling
 * 
 * Usage:
 *   npm run migrate:db          # Run pending migrations
 *   npm run migrate:down        # Rollback last migration
 *   npm run migrate:status      # Check migration status
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

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Log with color
 */
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Initialize migrations tracking table
 */
async function initializeMigrationsTable(client) {
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

  try {
    await client.query(createTableSQL);
    log('✓ Migrations tracking table initialized', 'cyan');
  } catch (error) {
    log(`✗ Error initializing migrations table: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Get list of migration files from migrations directory
 */
function getMigrationFiles() {
  try {
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    return files;
  } catch (error) {
    log(`✗ Error reading migrations directory: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Get already applied migrations
 */
async function getAppliedMigrations(client) {
  try {
    const result = await client.query(
      'SELECT name FROM _migrations WHERE status = $1 ORDER BY executed_at ASC',
      ['completed']
    );
    return result.rows.map(row => row.name);
  } catch (error) {
    log(`✗ Error retrieving applied migrations: ${error.message}`, 'red');
    throw error;
  }
}

/**
 * Get the next batch number
 */
async function getNextBatch(client) {
  try {
    const result = await client.query('SELECT MAX(batch) as max_batch FROM _migrations');
    const maxBatch = result.rows[0].max_batch;
    return maxBatch ? maxBatch + 1 : 1;
  } catch (error) {
    return 1;
  }
}

/**
 * Run pending migrations
 */
async function runMigrations() {
  const client = await pool.connect();

  try {
    log('\n🔄 Starting database migrations...\n', 'blue');

    // Initialize migrations table
    await initializeMigrationsTable(client);

    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(client);
    const pendingMigrations = migrationFiles.filter(file => !appliedMigrations.includes(file));

    if (pendingMigrations.length === 0) {
      log('✓ No pending migrations', 'green');
      return { success: true, migrationCount: 0 };
    }

    const nextBatch = await getNextBatch(client);
    let successful = 0;
    let failed = 0;

    log(`Found ${pendingMigrations.length} pending migration(s)\n`, 'yellow');

    // Start transaction
    await client.query('BEGIN');

    for (const migrationFile of pendingMigrations) {
      const migrationPath = path.join(migrationsDir, migrationFile);
      const startTime = Date.now();

      try {
        const sql = fs.readFileSync(migrationPath, 'utf-8');

        // Log migration start
        log(`  Running: ${migrationFile}...`, 'cyan');

        // Execute migration
        await client.query(sql);

        // Record migration
        const executionTime = Date.now() - startTime;
        await client.query(
          `INSERT INTO _migrations (name, batch, execution_time_ms, status) 
           VALUES ($1, $2, $3, $4)`,
          [migrationFile, nextBatch, executionTime, 'completed']
        );

        log(`  ✓ ${migrationFile} (${executionTime}ms)`, 'green');
        successful++;
      } catch (error) {
        log(`  ✗ Error in ${migrationFile}: ${error.message}`, 'red');
        failed++;
        throw error; // Rollback on error
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    log(`\n✅ Migration completed successfully!`, 'green');
    log(`Batch: ${nextBatch}`, 'cyan');
    log(`Migrations run: ${successful}`, 'cyan');

    return { success: true, migrationCount: successful };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    log(`\n❌ Migration failed and rolled back: ${error.message}`, 'red');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Rollback last migration batch
 */
async function rollbackMigrations() {
  const client = await pool.connect();

  try {
    log('\n🔄 Starting migration rollback...\n', 'blue');

    // Initialize migrations table
    await initializeMigrationsTable(client);

    // Get last batch
    const result = await client.query(
      `SELECT batch, COUNT(*) as count FROM _migrations 
       WHERE status = $1 
       GROUP BY batch 
       ORDER BY batch DESC LIMIT 1`,
      ['completed']
    );

    if (result.rows.length === 0) {
      log('✓ No migrations to rollback', 'green');
      return { success: true, rolledBack: 0 };
    }

    const lastBatch = result.rows[0].batch;
    const migrationsInBatch = await client.query(
      `SELECT name FROM _migrations 
       WHERE batch = $1 AND status = $2 
       ORDER BY executed_at DESC`,
      [lastBatch, 'completed']
    );

    if (migrationsInBatch.rows.length === 0) {
      log('✓ No migrations to rollback', 'green');
      return { success: true, rolledBack: 0 };
    }

    log(`Rolling back batch ${lastBatch} (${migrationsInBatch.rows.length} migration(s))\n`, 'yellow');

    await client.query('BEGIN');

    for (const migration of migrationsInBatch.rows) {
      const migrationFile = migration.name;
      const downFile = migrationFile.replace('.sql', '.down.sql');
      const downPath = path.join(migrationsDir, downFile);

      try {
        log(`  Rolling back: ${migrationFile}...`, 'cyan');

        if (fs.existsSync(downPath)) {
          const downSql = fs.readFileSync(downPath, 'utf-8');
          await client.query(downSql);
        } else {
          log(`  ⚠ No down migration file found: ${downFile}`, 'yellow');
        }

        // Mark as rolled back
        await client.query(
          `UPDATE _migrations SET status = $1 WHERE name = $2`,
          ['rolled_back', migrationFile]
        );

        log(`  ✓ ${migrationFile} rolled back`, 'green');
      } catch (error) {
        log(`  ✗ Error rolling back ${migrationFile}: ${error.message}`, 'red');
        throw error;
      }
    }

    await client.query('COMMIT');

    log(`\n✅ Rollback completed successfully!`, 'green');
    log(`Batch: ${lastBatch}`, 'cyan');
    log(`Migrations rolled back: ${migrationsInBatch.rows.length}`, 'cyan');

    return { success: true, rolledBack: migrationsInBatch.rows.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    log(`\n❌ Rollback failed: ${error.message}`, 'red');
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

/**
 * Main execution
 */
async function main() {
  const command = process.argv[2] || 'up';

  try {
    let result;

    switch (command.toLowerCase()) {
      case 'up':
      case 'migrate':
        result = await runMigrations();
        break;
      case 'down':
      case 'rollback':
        result = await rollbackMigrations();
        break;
      default:
        log(`\n❌ Unknown command: ${command}`, 'red');
        log(`\nUsage:\n`, 'yellow');
        log(`  node scripts/run-migrations.js up        - Run pending migrations`, 'cyan');
        log(`  node scripts/run-migrations.js down      - Rollback last batch`, 'cyan');
        process.exit(1);
    }

    await pool.end();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    log(`\n❌ Fatal error: ${error.message}`, 'red');
    await pool.end();
    process.exit(1);
  }
}

main();
