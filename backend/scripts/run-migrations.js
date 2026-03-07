const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

/**
 * Enhanced Migration Runner
 * 
 * Features:
 * - Sequential migration execution
 * - Migration tracking table
 * - Rollback support
 * - Dry-run mode
 * - Detailed logging
 */

class MigrationRunner {
  constructor() {
    this.migrationsDir = path.join(__dirname, '../migrations');
    this.logger = require('../utils/logger')('migration_runner');
  }

  async init() {
    // Create migrations tracking table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(255) NOT NULL UNIQUE,
        filename VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER,
        checksum VARCHAR(64)
      )
    `);

    // Create index for faster lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
      ON schema_migrations(version)
    `);
  }

  async getMigrationFiles() {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Natural sort will work with our 001_, 002_ format

    return files.map(file => {
      const version = file.split('_')[0];
      return {
        version,
        filename: file,
        path: path.join(this.migrationsDir, file)
      };
    });
  }

  async getExecutedMigrations() {
    const result = await pool.query(
      'SELECT version, filename, executed_at FROM schema_migrations ORDER BY version'
    );
    return result.rows;
  }

  async getPendingMigrations() {
    const allMigrations = await this.getMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    const executedVersions = new Set(executedMigrations.map(m => m.version));

    return allMigrations.filter(migration => !executedVersions.has(migration.version));
  }

  async executeMigration(migration, dryRun = false) {
    const startTime = Date.now();
    
    try {
      const sql = fs.readFileSync(migration.path, 'utf8');
      const checksum = require('crypto').createHash('md5').update(sql).digest('hex');

      this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}Executing migration: ${migration.filename}`);

      if (!dryRun) {
        // Execute the migration
        await pool.query(sql);

        // Record the migration
        await pool.query(`
          INSERT INTO schema_migrations (version, filename, execution_time_ms, checksum)
          VALUES ($1, $2, $3, $4)
        `, [
          migration.version,
          migration.filename,
          Date.now() - startTime,
          checksum
        ]);
      }

      this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}✅ Migration ${migration.filename} completed in ${Date.now() - startTime}ms`);
      return true;

    } catch (error) {
      this.logger.error(`❌ Migration ${migration.filename} failed:`, error.message);
      throw error;
    }
  }

  async runMigrations(options = {}) {
    const { dryRun = false, target = null } = options;

    try {
      await this.init();

      const pendingMigrations = await this.getPendingMigrations();
      
      if (pendingMigrations.length === 0) {
        this.logger.info('✅ No pending migrations to run');
        return;
      }

      this.logger.info(`Found ${pendingMigrations.length} pending migrations`);

      // Filter to target version if specified
      let migrationsToRun = pendingMigrations;
      if (target) {
        migrationsToRun = pendingMigrations.filter(m => 
          parseInt(m.version) <= parseInt(target)
        );
      }

      if (dryRun) {
        this.logger.info('🔍 DRY RUN MODE - No changes will be made');
      }

      // Execute migrations in order
      for (const migration of migrationsToRun) {
        await this.executeMigration(migration, dryRun);
      }

      this.logger.info(`🎉 Successfully ${dryRun ? 'validated' : 'executed'} ${migrationsToRun.length} migrations`);

    } catch (error) {
      this.logger.error('❌ Migration failed:', error);
      throw error;
    }
  }

  async rollback(steps = 1) {
    try {
      const executedMigrations = await this.getExecutedMigrations();
      
      if (executedMigrations.length === 0) {
        this.logger.info('No migrations to rollback');
        return;
      }

      const migrationsToRollback = executedMigrations
        .slice(-steps)
        .reverse();

      this.logger.info(`Rolling back ${migrationsToRollback.length} migrations`);

      for (const migration of migrationsToRollback) {
        // Check if rollback file exists
        const rollbackFile = migration.filename.replace('.sql', '_rollback.sql');
        const rollbackPath = path.join(this.migrationsDir, rollbackFile);

        if (fs.existsSync(rollbackPath)) {
          const rollbackSql = fs.readFileSync(rollbackPath, 'utf8');
          await pool.query(rollbackSql);
          this.logger.info(`✅ Rolled back migration: ${migration.filename}`);
        } else {
          this.logger.warn(`⚠️  No rollback file found for: ${migration.filename}`);
        }

        // Remove from tracking table
        await pool.query(
          'DELETE FROM schema_migrations WHERE version = $1',
          [migration.version]
        );
      }

      this.logger.info('🎉 Rollback completed');

    } catch (error) {
      this.logger.error('❌ Rollback failed:', error);
      throw error;
    }
  }

  async status() {
    await this.init();

    const allMigrations = await this.getMigrationFiles();
    const executedMigrations = await this.getExecutedMigrations();
    const executedVersions = new Set(executedMigrations.map(m => m.version));

    console.log('\n📋 Migration Status:\n');
    console.log('Version | Status    | Filename');
    console.log('--------|-----------|----------------------------------');

    for (const migration of allMigrations) {
      const status = executedVersions.has(migration.version) ? '✅ Applied' : '⏳ Pending';
      console.log(`${migration.version.padEnd(7)} | ${status.padEnd(9)} | ${migration.filename}`);
    }

    const pendingCount = allMigrations.length - executedMigrations.length;
    console.log(`\n📊 Summary: ${executedMigrations.length} applied, ${pendingCount} pending\n`);
  }
}

// CLI interface
async function main() {
  const runner = new MigrationRunner();
  const command = process.argv[2];

  try {
    switch (command) {
      case 'up':
        await runner.runMigrations();
        break;
      case 'dry-run':
        await runner.runMigrations({ dryRun: true });
        break;
      case 'rollback':
        const steps = parseInt(process.argv[3]) || 1;
        await runner.rollback(steps);
        break;
      case 'status':
        await runner.status();
        break;
      case 'target':
        const target = process.argv[3];
        if (!target) {
          console.error('Please specify target version: npm run migrate target 010');
          process.exit(1);
        }
        await runner.runMigrations({ target });
        break;
      default:
        console.log(`
🚀 FinovatePay Migration Runner

Usage:
  node scripts/run-migrations.js <command>

Commands:
  up        - Run all pending migrations
  dry-run   - Validate migrations without executing
  rollback  - Rollback last migration (or specify steps)
  status    - Show migration status
  target    - Run migrations up to specific version

Examples:
  node scripts/run-migrations.js up
  node scripts/run-migrations.js dry-run
  node scripts/run-migrations.js rollback 2
  node scripts/run-migrations.js target 010
        `);
        break;
    }
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = MigrationRunner;