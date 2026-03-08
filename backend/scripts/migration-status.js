#!/usr/bin/env node

/**
 * Migration Status Checker
 * 
 * Display detailed migration status including:
 * - Applied migrations with timestamps
 * - Pending migrations
 * - Current batch information
 * - Migration execution times
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
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function getMigrationStatus() {
  const client = await pool.connect();

  try {
    log('\n📊 Migration Status Report\n', 'blue');

    // Check if migrations table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = '_migrations'
      );
    `);

    if (!tableExists.rows[0].exists) {
      log('⚠ Migrations table does not exist yet', 'yellow');
      log('Run: npm run migrate:db\n', 'cyan');
      return;
    }

    // Get applied migrations
    const applied = await client.query(`
      SELECT name, executed_at, batch, execution_time_ms, status 
      FROM _migrations 
      ORDER BY executed_at ASC;
    `);

    // Get all migration files
    const allFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.endsWith('.down.sql'))
      .sort();

    const appliedNames = applied.rows.map(row => row.name);
    const pending = allFiles.filter(file => !appliedNames.includes(file));

    // Display applied migrations
    log('✅ Applied Migrations:', 'green');
    if (applied.rows.length === 0) {
      log('  (none)\n', 'gray');
    } else {
      const table = applied.rows.map((m, i) => ({
        '#': i + 1,
        'Migration': m.name,
        'Batch': m.batch,
        'Time (ms)': m.execution_time_ms || '-',
        'Status': m.status,
        'Applied': m.executed_at ? new Date(m.executed_at).toLocaleString() : '-',
      }));

      console.table(table);
    }

    // Display pending migrations
    log('⏳ Pending Migrations:', 'yellow');
    if (pending.length === 0) {
      log('  (none)\n', 'gray');
    } else {
      pending.forEach((file, i) => {
        log(`  ${i + 1}. ${file}`, 'yellow');
      });
      log('', 'reset');
    }

    // Summary stats
    log('📈 Summary:', 'cyan');
    log(`  Total Migrations: ${allFiles.length}`, 'cyan');
    log(`  Applied: ${applied.rows.length}`, 'cyan');
    log(`  Pending: ${pending.length}`, 'cyan');

    if (applied.rows.length > 0) {
      const totalTime = applied.rows.reduce((sum, m) => sum + (m.execution_time_ms || 0), 0);
      log(`  Avg Execution Time: ${Math.round(totalTime / applied.rows.length)}ms`, 'cyan');
      log(`  Last Batch: ${Math.max(...applied.rows.map(m => m.batch))}`, 'cyan');
    }

    log('', 'reset');
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
  } finally {
    client.release();
    await pool.end();
  }
}

getMigrationStatus();
