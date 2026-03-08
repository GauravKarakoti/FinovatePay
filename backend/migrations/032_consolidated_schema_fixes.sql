-- Migration: Consolidated Schema Fixes
-- Purpose: Fix organization_id column and role constraints
-- Consolidates: fix_schema.js and fix_role_constraint.js
-- Date: 2026-03-07

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
