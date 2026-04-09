# Database Migration System - Quick Reference

## Commands

```bash
# Initialize migration system (run once on new database)
npm run migrate:init

# Run pending migrations
npm run migrate:db

# Rollback last migration batch
npm run migrate:down

# Check migration status
npm run migrate:status

# Pre-deployment validation
bash scripts/pre-deploy-check.sh

# Database initialization with all base structures
node scripts/database-init.js --migrate
```

## Migration File Directory Structure

```
backend/
├── migrations/
│   ├── 001_create_email_schema.sql
│   ├── 001_create_email_schema.down.sql
│   ├── 002_create_wallet_kyc_mappings.sql
│   ├── 002_create_wallet_kyc_mappings.down.sql
│   ├── ... more migrations
│   └── dispute_tables.down.sql
├── scripts/
│   ├── run-migrations.js          # Main migration runner (up/down)
│   ├── migration-status.js        # Status checker
│   ├── initialize-migrations.js   # One-time setup
│   ├── database-init.js           # Full database setup
│   └── pre-deploy-check.sh        # Pre-deployment validation
└── package.json
```

## How It Works

### 1. Migration Discovery
- All `.sql` files in `backend/migrations/` are discovered
- Files are executed in alphabetical order (001_, 002_, etc.)
- Down migrations (`.down.sql`) handle rollbacks

### 2. Migration Tracking
- `_migrations` table tracks applied migrations
- Stores: migration name, timestamp, batch number, execution time, status
- Prevents re-running the same migration

### 3. Batch Processing
- Migrations run in batches
- All migrations in a batch had transaction atomicity
- If one fails, all roll back automatically

### 4. Rollback Safety
- Rollbacks happen in reverse order
- Down migrations must exist for partial rollbacks
- Transaction-based for consistency

## Database Schema Tracking

When you run migrations, a `_migrations` table is created:

```sql
CREATE TABLE _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,      -- Migration filename
  executed_at TIMESTAMP DEFAULT NOW(),     -- When it ran
  batch INTEGER NOT NULL,                  -- Batch number
  execution_time_ms INTEGER,               -- How long it took
  status VARCHAR(20) DEFAULT 'completed'   -- 'completed', 'rolled_back'
);
```

Query it anytime:
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT name, executed_at, batch, execution_time_ms FROM _migrations ORDER BY executed_at;"
```

## CI/CD Integration

GitHub Actions workflow runs automatically on:
- Push to main/staging/develop with migrations/ changes
- Manual workflow dispatch
- Pull requests to main/staging/develop

The workflow:
1. Spins up test PostgreSQL database
2. Initializes migrations system
3. Runs all migrations
4. Validates no pending migrations exist
5. Adds PR comment with status

## Common Workflows

### Adding a New Migration

```bash
# 1. Create migration file
cat > backend/migrations/NNN_description.sql << 'EOF'
-- Your SQL here
CREATE TABLE ...
EOF

# 2. Create down migration (optional but recommended)
cat > backend/migrations/NNN_description.down.sql << 'EOF'
-- Rollback SQL
DROP TABLE IF EXISTS ... CASCADE;
EOF

# 3. Test locally
npm run migrate:db

# 4. Check status
npm run migrate:status

# 5. Commit and push (CI will validate)
git add backend/migrations/
git commit -m "feat: add migration for ..."
git push
```

### Rolling Back Migrations

```bash
# Rollback last batch
npm run migrate:down

# Check status
npm run migrate:status

# Manual rollback (if down file is missing)
npm run migrate:status  # Note the migration name
# Edit migration manually to mark as rolled_back
```

### Fresh Database Setup

```bash
# 1. Initialize database structure
node scripts/database-init.js

# 2. Run all migrations
npm run migrate:db

# 3. Check status
npm run migrate:status

# 4. Seed initial data (optional)
npm run seed:db
```

### Pre-Deployment Check

```bash
# Run this before deploying
bash scripts/pre-deploy-check.sh

# It will:
# - Check database connection
# - List migration files
# - Verify no pending migrations
# - Show migration history
```

## Troubleshooting

### Problem: "Migrations table does not exist"

```bash
npm run migrate:init
```

### Problem: Connection refused

```bash
# Check environment variables
cat .env | grep DB_

# Test connection
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;"
```

### Problem: Migration failed

```bash
# Check status
npm run migrate:status

# View raw migration table
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT * FROM _migrations WHERE status != 'completed';"

# If transaction still pending, kill it:
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query != '<idle>';"
```

### Problem: Can't rollback (no down file)

```bash
# Option 1: Create down migration manually
# Option2: Manually undo changes then mark as rolled back:
psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  "UPDATE _migrations SET status = 'rolled_back' WHERE name = 'NNN_migration.sql';"
```

## Files Modified/Created

### New Files Created:
- `backend/scripts/run-migrations.js` - Main migration runner
- `backend/scripts/migration-status.js` - Status checker
- `backend/scripts/initialize-migrations.js` - Initialize system
- `backend/scripts/database-init.js` - Full database setup
- `backend/scripts/pre-deploy-check.sh` - Pre-deployment validation
- `.github/workflows/migrations.yml` - CI/CD automation
- `MIGRATION_GUIDE.md` - Comprehensive guide
- `MIGRATION_QUICK_REFERENCE.md` - This file

### Modified Files:
- `backend/package.json` - Added migration npm scripts
- `backend/Dockerfile` - Runs migrations before starting app

### Migration Down Files (Rollback):
- `backend/migrations/XXX.down.sql` - Created for each migration

## Next Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Test migrations locally:**
   ```bash
   npm run migrate:db
   npm run migrate:status
   ```

3. **Add to your deployment:**
   - Docker containers run migrations automatically
   - Pre-deployment checks verify consistency
   - CI/CD pipeline validates all changes

4. **Create new migrations:**
   - Use clear naming: `NNN_description.sql`
   - Always include down migration
   - Test before committing
   - Follow SQL best practices

## Support

For detailed guides, see:
- [MIGRATION_GUIDE.md](../MIGRATION_GUIDE.md) - Full documentation
- [GitHub Workflows](.github/workflows/migrations.yml) - CI/CD setup
- [Database Scripts](backend/scripts/) - Available utilities
