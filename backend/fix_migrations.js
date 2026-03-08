const fs = require('fs');
const path = require('path');

/**
 * Migration Renumbering and Consistency Fix Script
 * 
 * This script fixes the following issues:
 * 1. Duplicate migration numbers
 * 2. Inconsistent migration naming
 * 3. Missing organization_id column in users table
 * 4. Consolidates manual fixes into proper migrations
 */

const migrationsDir = path.join(__dirname, 'migrations');

// Define the correct migration order and new numbering
const migrationPlan = [
  // Core schema migrations (001-010)
  { old: '001_create_email_schema.sql', new: '001_create_email_schema.sql' },
  { old: '002_create_event_sync_table.sql', new: '002_create_event_sync_table.sql' },
  { old: '003_create_wallet_kyc_mappings.sql', new: '003_create_wallet_kyc_mappings.sql' },
  { old: '004_add_currencies.sql', new: '004_add_currencies.sql' },
  { old: '004_create_streaming_payments.sql', new: '005_create_streaming_payments.sql' },
  { old: '005_create_audit_logs.sql', new: '006_create_audit_logs.sql' },
  { old: '005_create_credit_scores.sql', new: '007_create_credit_scores.sql' },
  { old: '005_create_refresh_tokens.sql', new: '008_create_refresh_tokens.sql' },
  { old: '005_create_relayer_security_tables.sql', new: '009_create_relayer_security_tables.sql' },
  { old: '006_add_invoice_indexes.sql', new: '010_add_invoice_indexes.sql' },
  
  // API and security migrations (011-020)
  { old: '006_create_api_keys.sql', new: '011_create_api_keys.sql' },
  { old: '006_create_invoice_auctions.sql', new: '012_create_invoice_auctions.sql' },
  { old: '006_create_recovery_system.sql', new: '013_create_recovery_system.sql' },
  { old: '007_create_reconciliation_logs.sql', new: '014_create_reconciliation_logs.sql' },
  { old: '007_create_webhooks_table.sql', new: '015_create_webhooks_table.sql' },
  { old: '008_create_blockchain_jobs_table.sql', new: '016_create_blockchain_jobs_table.sql' },
  { old: '008_create_insurance_policies.sql', new: '017_create_insurance_policies.sql' },
  { old: '009_create_push_subscriptions.sql', new: '018_create_push_subscriptions.sql' },
  { old: '009_create_rate_limits_table.sql', new: '019_create_rate_limits_table.sql' },
  { old: '009_create_whitelabel_configurations.sql', new: '020_create_whitelabel_configurations.sql' },
  
  // Advanced features migrations (021-030)
  { old: '010_create_cross_chain_fractions.sql', new: '021_create_cross_chain_fractions.sql' },
  { old: '010_create_password_reset_tokens.sql', new: '022_create_password_reset_tokens.sql' },
  { old: '011_create_revolving_credit_lines.sql', new: '023_create_revolving_credit_lines.sql' },
  { old: '012_create_yield_pool_tables.sql', new: '024_create_yield_pool_tables.sql' },
  { old: '013_create_multi_sig_wallets.sql', new: '025_create_multi_sig_wallets.sql' },
  { old: '014_create_governance.sql', new: '026_create_governance.sql' },
  { old: '015_create_proxy_tracking.sql', new: '027_create_proxy_tracking.sql' },
  { old: '016_add_multi_currency_support.sql', new: '028_add_multi_currency_support.sql' },
  { old: '017_create_credit_risk_profiles.sql', new: '029_create_credit_risk_profiles.sql' },
  
  // Special migrations (030+)
  { old: 'create_meta_transactions_table.sql', new: '030_create_meta_transactions_table.sql' },
  { old: 'dispute_tables.sql', new: '031_create_dispute_tables.sql' }
];

async function fixMigrations() {
  console.log('🔧 Starting migration consistency fix...\n');

  try {
    // Step 1: Create backup directory
    const backupDir = path.join(__dirname, 'migrations_backup');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
      console.log('📁 Created backup directory');
    }

    // Step 2: Backup existing migrations
    console.log('💾 Backing up existing migrations...');
    const existingFiles = fs.readdirSync(migrationsDir);
    for (const file of existingFiles) {
      if (file.endsWith('.sql')) {
        fs.copyFileSync(
          path.join(migrationsDir, file),
          path.join(backupDir, file)
        );
      }
    }
    console.log(`   ✅ Backed up ${existingFiles.length} files\n`);

    // Step 3: Rename migrations according to plan
    console.log('🔄 Renumbering migrations...');
    const tempDir = path.join(__dirname, 'migrations_temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // First, move all files to temp directory with new names
    for (const migration of migrationPlan) {
      const oldPath = path.join(migrationsDir, migration.old);
      const tempPath = path.join(tempDir, migration.new);
      
      if (fs.existsSync(oldPath)) {
        fs.copyFileSync(oldPath, tempPath);
        console.log(`   ✅ ${migration.old} → ${migration.new}`);
      } else {
        console.log(`   ⚠️  ${migration.old} not found, skipping`);
      }
    }

    // Step 4: Clear migrations directory and move files back
    console.log('\n🧹 Cleaning up migrations directory...');
    for (const file of fs.readdirSync(migrationsDir)) {
      if (file.endsWith('.sql')) {
        fs.unlinkSync(path.join(migrationsDir, file));
      }
    }

    // Move renamed files back
    for (const file of fs.readdirSync(tempDir)) {
      fs.copyFileSync(
        path.join(tempDir, file),
        path.join(migrationsDir, file)
      );
    }

    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true });
    console.log('   ✅ Migration directory cleaned and reorganized\n');

    // Step 5: Create new migration for organization_id and role fixes
    console.log('📝 Creating consolidated schema fix migration...');
    await createSchemaFixMigration();

    console.log('🎉 Migration consistency fix completed successfully!\n');
    console.log('📋 Summary:');
    console.log(`   • Renumbered ${migrationPlan.length} migration files`);
    console.log('   • Fixed duplicate migration numbers');
    console.log('   • Created consolidated schema fix migration');
    console.log('   • Backup created in migrations_backup/');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Review the new migration files');
    console.log('   2. Test migrations on a development database');
    console.log('   3. Remove manual fix scripts (fix_schema.js, fix_role_constraint.js)');
    console.log('   4. Update migration runner to use new numbering');

  } catch (error) {
    console.error('❌ Error during migration fix:', error);
    process.exit(1);
  }
}

async function createSchemaFixMigration() {
  const migrationContent = `-- Migration: Consolidated Schema Fixes
-- Purpose: Fix organization_id column and role constraints
-- Consolidates: fix_schema.js and fix_role_constraint.js
-- Date: ${new Date().toISOString().split('T')[0]}

-- ============================================
-- FIX USERS TABLE SCHEMA
-- ============================================

-- Add organization_id column if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization_id INTEGER;

-- Add missing columns from manual fixes
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_id VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Ensure all required columns exist with proper defaults
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'seller';
ALTER TABLE users ALTER COLUMN kyc_status SET DEFAULT 'pending';

-- ============================================
-- FIX ROLE CONSTRAINTS
-- ============================================

-- Drop old constraint if it exists
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Add new constraint with all supported roles
ALTER TABLE users ADD CONSTRAINT users_role_check 
CHECK (role IN ('buyer', 'seller', 'investor', 'shipment'));

-- ============================================
-- ADD MISSING INDEXES
-- ============================================

-- Index for organization_id lookups
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);

-- Index for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Index for KYC status queries
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON COLUMN users.organization_id IS 'Links user to an organization (for enterprise accounts)';
COMMENT ON COLUMN users.first_name IS 'User first name for KYC and display';
COMMENT ON COLUMN users.last_name IS 'User last name for KYC and display';
COMMENT ON COLUMN users.tax_id IS 'Tax identification number for compliance';
COMMENT ON CONSTRAINT users_role_check ON users IS 'Ensures role is one of: buyer, seller, investor, shipment';

-- ============================================
-- DATA MIGRATION (if needed)
-- ============================================

-- Update any existing users with NULL roles to 'seller'
UPDATE users SET role = 'seller' WHERE role IS NULL;

-- Update any existing users with NULL kyc_status to 'pending'
UPDATE users SET kyc_status = 'pending' WHERE kyc_status IS NULL;
`;

  const migrationPath = path.join(migrationsDir, '032_consolidated_schema_fixes.sql');
  fs.writeFileSync(migrationPath, migrationContent);
  console.log('   ✅ Created 032_consolidated_schema_fixes.sql');
}

// Run the fix
if (require.main === module) {
  fixMigrations();
}

module.exports = { fixMigrations, migrationPlan };