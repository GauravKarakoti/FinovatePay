# Database Migration Management Guide

## Overview

This project uses a custom Node.js-based database migration system with PostgreSQL. It provides:

- ✅ Automatic discovery and execution of migration files
- ✅ Migration history tracking in `_migrations` table
- ✅ Rollback capability with `.down.sql` files
- ✅ Batch-based migration grouping
- ✅ Transaction-based execution (automatic rollback on error)
- ✅ Migration timing and status reporting
- ✅ CI/CD integration ready

## Getting Started

### 1. Initialize the Migrations System

On first setup or when connecting to a new database:

```bash
npm run migrate:init
```

This creates the `_migrations` tracking table and registers existing migrations.

### 2. Run Pending Migrations

Execute all pending migrations:

```bash
npm run migrate:db
```

**Output example:**
```
🔄 Starting database migrations...

✓ Migrations tracking table initialized
Found 3 pending migration(s)

  Running: 001_create_email_schema.sql...
  ✓ 001_create_email_schema.sql (234ms)
  Running: 002_create_wallet_kyc_mappings.sql...
  ✓ 002_create_wallet_kyc_mappings.sql (156ms)
  Running: 003_add_currencies.sql...
  ✓ 003_add_currencies.sql (89ms)

✅ Migration completed successfully!
Batch: 2
Migrations run: 3
```

### 3. Check Migration Status

View which migrations have been applied:

```bash
npm run migrate:status
```

**Output example:**
```
📊 Migration Status Report

✅ Applied Migrations:
┌───┬──────────────────────────────┬───────┬─────────┬───────────┬──────────────────────────┐
│   │ Migration                    │ Batch │ Time(ms)│ Status    │ Applied                  │
├───┼──────────────────────────────┼───────┼─────────┼───────────┼──────────────────────────┤
│ 1 │ 001_create_email_schema.sql  │   1   │   234   │ completed │ 3/7/2026, 10:30:45 AM   │
│ 2 │ 002_create_wallet_kyc_...   │   1   │   156   │ completed │ 3/7/2026, 10:30:46 AM   │
└───┴──────────────────────────────┴───────┴─────────┴───────────┴──────────────────────────┘

⏳ Pending Migrations:
  (none)

📈 Summary:
  Total Migrations: 5
  Applied: 2
  Pending: 3
  Avg Execution Time: 195ms
  Last Batch: 1
```

### 4. Rollback Migrations

Revert the last migration batch:

```bash
npm run migrate:down
```

## Migration File Format

### Creating a New Migration

1. **File naming convention**: Use the format `NNN_description.sql` where NNN is a sequence number.

   Examples:
   - `001_create_email_schema.sql`
   - `002_add_user_preferences.sql`
   - `003_create_audit_logs.sql`

2. **File contents**: Pure SQL, supporting multiple statements.

   ```sql
   -- Create new table
   CREATE TABLE invoices_audit_log (
     id SERIAL PRIMARY KEY,
     invoice_id UUID NOT NULL,
     action VARCHAR(50) NOT NULL,
     changed_by UUID REFERENCES users(id),
     changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     old_data JSONB,
     new_data JSONB
   );

   -- Create indexes
   CREATE INDEX idx_audit_log_invoice ON invoices_audit_log(invoice_id);
   CREATE INDEX idx_audit_log_timestamp ON invoices_audit_log(changed_at);

   -- Add comment
   COMMENT ON TABLE invoices_audit_log IS 'Audit trail for invoice changes';
   ```

### Creating Rollback Migrations

For each migration requiring rollback, create a `.down.sql` file:

**Example: `001_create_email_schema.down.sql`**
```sql
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS user_notification_preferences CASCADE;
DROP TABLE IF EXISTS email_templates CASCADE;
```

**Important**: 
- Not all migrations need down files (some changes cannot be easily reversed)
- If a down file is missing, the migration will be marked but not rolled back
- Down migrations are executed in reverse order during rollback

## Migration Tracking Table

The `_migrations` table tracks all migrations:

```sql
CREATE TABLE _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  batch INTEGER NOT NULL,
  execution_time_ms INTEGER,
  status VARCHAR(20) DEFAULT 'completed'
);
```

**Fields:**
- `name`: Migration filename
- `executed_at`: When the migration was applied
- `batch`: Batch number (migrations run together)
- `execution_time_ms`: How long the migration took
- `status`: 'completed' or 'rolled_back'

## Best Practices

### ✅ DO

- **Use transactions**: Migrations are wrapped in transactions automatically
- **Be descriptive**: Use clear names that describe what changed
- **Test locally first**: Always test migrations on a development database
- **Keep migrations small**: Easier to debug and rollback if needed
- **Add comments**: Explain complex SQL changes
- **Create down migrations**: For critical data-affecting changes
- **Use idempotent DDL**: Use `IF NOT EXISTS` / `IF EXISTS` when possible

  ```sql
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  DROP INDEX IF EXISTS idx_users_email;
  CREATE INDEX idx_users_email ON users(email);
  ```

### ❌ DON'T

- **Hardcode values**: Data migrations should be generated
- **Mix DDL and DML**: Keep schema and data changes separate
- **Forget indexes**: Always add indexes for foreign keys and frequently queried columns
- **Skip testing**: Test migrations backward and forward
- **Make assumptions about data**: Check data before transformations

## CI/CD Integration

### GitHub Actions Example

Add this to `.github/workflows/deploy.yml`:

```yaml
- name: Run Database Migrations
  env:
    DB_USER: ${{ secrets.DB_USER }}
    DB_HOST: ${{ secrets.DB_HOST }}
    DB_NAME: ${{ secrets.DB_NAME }}
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
    DB_PORT: ${{ secrets.DB_PORT }}
  run: |
    cd backend
    npm install
    npm run migrate:db
```

### Docker Example

Add to `Dockerfile`:

```dockerfile
# Run migrations before starting app
RUN npm run migrate:db

# Start application
CMD ["node", "server.js"]
```

### Pre-deployment Checks

```bash
#!/bin/bash

# Check migration status
npm run migrate:status

# Verify no pending migrations
PENDING=$(npm run migrate:status 2>&1 | grep "Pending: " | tail -1)
if [[ $PENDING != *"Pending: 0"* ]]; then
  echo "❌ Pending migrations found!"
  exit 1
fi

echo "✅ All migrations applied"
```

## Troubleshooting

### Problem: Migrations table already exists with different schema

**Solution**: Manually drop and recreate:
```sql
DROP TABLE _migrations;
-- Then run: npm run migrate:init
```

### Problem: Migration failed midway

**Solution**: Automatic rollback happens via transaction, but verify with:
```bash
npm run migrate:status
```

Check `_migrations` table for status:
```sql
SELECT * FROM _migrations WHERE status != 'completed';
```

### Problem: Down migration doesn't exist

**Solution**: Create it manually or skip rollback:
```bash
# View what would be rolled back
npm run migrate:status

# Manually revert if down file missing
psql -U $DB_USER -h $DB_HOST -d $DB_NAME < path/to/manual-revert.sql
```

### Problem: Connection fails

**Verify environment variables:**
```bash
# Check .env file
cat .env | grep DB_

# Test connection
psql -U $DB_USER -h $DB_HOST -d $DB_NAME -c "SELECT 1;"
```

## Migration Examples

### Example 1: Create a New Table

**File: `010_create_disputes_table.sql`**
```sql
CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  raised_by UUID NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'open',
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_disputes_invoice ON disputes(invoice_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_created_at ON disputes(created_at DESC);
```

**File: `010_create_disputes_table.down.sql`**
```sql
DROP TABLE IF EXISTS disputes CASCADE;
```

### Example 2: Add Column with Default

**File: `011_add_dispute_resolution.sql`**
```sql
ALTER TABLE disputes 
ADD COLUMN resolution_notes TEXT,
ADD COLUMN resolved_by UUID REFERENCES users(id),
ADD COLUMN arbitrator_id UUID REFERENCES users(id);

CREATE INDEX idx_disputes_arbitrator ON disputes(arbitrator_id);
```

**File: `011_add_dispute_resolution.down.sql`**
```sql
ALTER TABLE disputes 
DROP COLUMN resolution_notes,
DROP COLUMN resolved_by,
DROP COLUMN arbitrator_id;
```

### Example 3: Data Migration

**File: `012_migrate_dispute_status.sql`**
```sql
-- Create new status enum if needed
DO $$ BEGIN
  CREATE TYPE dispute_status_new AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Migrate data
UPDATE disputes SET status = 'in_progress' WHERE status = 'pending';
UPDATE disputes SET status = 'closed' WHERE status = 'resolved' AND resolved_at IS NOT NULL;

-- Drop old type and rename new one
ALTER TABLE disputes ALTER COLUMN status TYPE dispute_status_new USING status::text::dispute_status_new;
DROP TYPE IF EXISTS dispute_status;
ALTER TYPE dispute_status_new RENAME TO dispute_status;
```

## Running Manually

If you need to run migrations outside of npm scripts:

```bash
# Run migrations
node backend/scripts/run-migrations.js up

# Rollback
node backend/scripts/run-migrations.js down

# Check status
node backend/scripts/migration-status.js

# Initialize
node backend/scripts/initialize-migrations.js
```

## Additional Resources

- [PostgreSQL ALTER TABLE Documentation](https://www.postgresql.org/docs/current/sql-altertable.html)
- [PostgreSQL CREATE TABLE Documentation](https://www.postgresql.org/docs/current/sql-createtable.html)
- [Database Schema Best Practices](https://www.postgresql.org/docs/current/ddl.html)
