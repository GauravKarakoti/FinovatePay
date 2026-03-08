const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

/**
 * Enhanced Migration Runner
 */

class MigrationRunner {
  constructor() {
    this.migrationsDir = path.join(__dirname, '../migrations');
    this.logger = require('../utils/logger')('migration_runner');
  }

  async init() {
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

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
      ON schema_migrations(version)
    `);
  }

  async getMigrationFiles() {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

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
    const executed = await this.getExecutedMigrations();
    const executedVersions = new Set(executed.map(m => m.version));

    return allMigrations.filter(m => !executedVersions.has(m.version));
  }

  async executeMigration(migration, dryRun = false) {
    const start = Date.now();

    try {
      const sql = fs.readFileSync(migration.path, 'utf8');
      const checksum = require('crypto').createHash('md5').update(sql).digest('hex');

      this.logger.info(`${dryRun ? '[DRY RUN]' : ''} Running ${migration.filename}`);

      if (!dryRun) {
        await pool.query(sql);

        await pool.query(`
          INSERT INTO schema_migrations (version, filename, execution_time_ms, checksum)
          VALUES ($1,$2,$3,$4)
        `, [
          migration.version,
          migration.filename,
          Date.now() - start,
          checksum
        ]);
      }

      this.logger.info(`✅ ${migration.filename} finished`);
      return true;

    } catch (error) {
      this.logger.error(`❌ ${migration.filename} failed`, error);
      throw error;
    }
  }

  async runMigrations(options = {}) {
    const { dryRun = false, target = null } = options;

    await this.init();

    const pending = await this.getPendingMigrations();

    if (!pending.length) {
      this.logger.info('No pending migrations');
      return;
    }

    let migrations = pending;

    if (target) {
      migrations = pending.filter(m => parseInt(m.version) <= parseInt(target));
    }

    for (const migration of migrations) {
      await this.executeMigration(migration, dryRun);
    }

    this.logger.info(`🎉 ${migrations.length} migrations executed`);
  }

  async rollback(steps = 1) {
    const executed = await this.getExecutedMigrations();

    const toRollback = executed.slice(-steps).reverse();

    for (const migration of toRollback) {

      const rollbackFile = migration.filename.replace('.sql', '_rollback.sql');
      const rollbackPath = path.join(this.migrationsDir, rollbackFile);

      if (fs.existsSync(rollbackPath)) {
        const sql = fs.readFileSync(rollbackPath, 'utf8');
        await pool.query(sql);
      }

      await pool.query(
        'DELETE FROM schema_migrations WHERE version=$1',
        [migration.version]
      );

      this.logger.info(`Rolled back ${migration.filename}`);
    }
  }

  async status() {
    await this.init();

    const all = await this.getMigrationFiles();
    const executed = await this.getExecutedMigrations();
    const executedVersions = new Set(executed.map(m => m.version));

    console.log('\nMigration Status\n');

    for (const migration of all) {
      const status = executedVersions.has(migration.version)
        ? 'Applied'
        : 'Pending';

      console.log(`${migration.version} - ${status} - ${migration.filename}`);
    }
  }
}

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

      default:
        console.log(`
Usage:
node scripts/run-migrations.js up
node scripts/run-migrations.js dry-run
node scripts/run-migrations.js rollback 1
node scripts/run-migrations.js status
        `);
    }

  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = MigrationRunner;