#!/bin/bash

# Pre-deployment Migration Check
# 
# This script should be run before deploying to ensure:
# 1. All migrations have been applied
# 2. No pending migrations exist
# 3. Database is in a consistent state
# 
# Usage: ./scripts/pre-deploy-check.sh
# Environment Variables:
#   - DB_USER: Database user
#   - DB_HOST: Database host
#   - DB_NAME: Database name
#   - DB_PASSWORD: Database password
#   - DB_PORT: Database port (default 5432)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 Pre-deployment Migration Check${NC}\n"

# Check environment variables
if [ -z "$DB_USER" ] || [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_PASSWORD" ]; then
  echo -e "${RED}❌ Missing required environment variables${NC}"
  echo "Required: DB_USER, DB_HOST, DB_NAME, DB_PASSWORD"
  exit 1
fi

DB_PORT=${DB_PORT:-5432}

echo -e "${BLUE}Database Configuration:${NC}"
echo "  Host: $DB_HOST"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo ""

# Change to backend directory
cd "$(dirname "$0")/.." 

# Check if migrations directory exists
if [ ! -d "migrations" ]; then
  echo -e "${RED}❌ Migrations directory not found${NC}"
  exit 1
fi

# Count migration files
migration_count=$(find migrations -name "*.sql" ! -name "*.down.sql" | wc -l)
echo -e "${BLUE}Found $migration_count migration files${NC}\n"

# Run migration status check
echo -e "${BLUE}Checking migration status...${NC}\n"

status_output=$(npm run migrate:status 2>&1)
echo "$status_output"

# Check for pending migrations
if echo "$status_output" | grep -q "Pending: 0"; then
  echo -e "\n${GREEN}✅ All migrations applied successfully${NC}"
  echo -e "${GREEN}✅ Ready for deployment${NC}"
  exit 0
else
  pending_count=$(echo "$status_output" | grep "Pending: " | tail -1 | grep -o "[0-9]*$" || echo "unknown")
  echo -e "\n${RED}❌ Pending migrations detected (⏳ $pending_count)${NC}"
  echo -e "${YELLOW}Run 'npm run migrate:db' to apply pending migrations${NC}"
  exit 1
fi
