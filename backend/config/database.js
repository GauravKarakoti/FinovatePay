const { Pool } = require("pg");
require("dotenv").config();

// --------------------------------------------------
// Environment
// --------------------------------------------------

const isProduction = process.env.NODE_ENV === "production";

// Enhanced Database Configuration with Resilience
const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
    ? parseInt(process.env.DB_PORT)
    : 5432,

  // Enable SSL with proper certificate validation in production
  ssl: isProduction
    ? {
        rejectUnauthorized: true,
        ca: process.env.DB_CA_CERT ? [process.env.DB_CA_CERT] : undefined,
      }
    : { rejectUnauthorized: false }, // Only allow in development

  // Pool configuration (valid pg options only)
  max: process.env.DB_POOL_MAX
    ? parseInt(process.env.DB_POOL_MAX)
    : 20,

  idleTimeoutMillis: process.env.DB_IDLE_TIMEOUT
    ? parseInt(process.env.DB_IDLE_TIMEOUT)
    : 30000,

  connectionTimeoutMillis: process.env.DB_CONNECTION_TIMEOUT
    ? parseInt(process.env.DB_CONNECTION_TIMEOUT)
    : 20000,
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 60000,
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
  reapIntervalMillis: parseInt(process.env.DB_REAP_INTERVAL) || 1000,
  maxLifetimeSeconds: parseInt(process.env.DB_MAX_LIFETIME) || 3600,
};

// --------------------------------------------------
// Pool Initialization
// --------------------------------------------------

const pool = new Pool(dbConfig);

// --------------------------------------------------
// Pool Event Handlers for Better Error Handling
// --------------------------------------------------

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle database client:', err.message);
  // Don't crash in production - log and continue
  // The pool will create a new client automatically
});

pool.on('connect', (client) => {
  console.log('🔌 New database client connected. Total clients:', pool.totalCount);
});

pool.on('acquire', (client) => {
  // Log when a client is acquired from the pool (useful for debugging)
  if (process.env.NODE_ENV !== 'production') {
    console.log('📊 Database client acquired. Idle:', pool.idleCount, 'Waiting:', pool.waitingCount);
  }
});

pool.on('remove', (client) => {
  // Log when a client is removed from the pool
  if (process.env.NODE_ENV !== 'production') {
    console.log('📤 Database client removed from pool. Total:', pool.totalCount);
  }
});

// --------------------------------------------------
// Initial Connection Test (Fail-Fast)
// --------------------------------------------------

<<<<<<< security/remove-console-logs-production-code
pool
  .connect()
  .then((client) => {
  console.log("Connected to PostgreSQL");
=======
async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("🔌 Connected to PostgreSQL");
>>>>>>> contrib
    client.release();
  } catch (error) {
    console.error("❌ Failed to connect to PostgreSQL:", error.message);
    process.exit(1);
  }
}

testConnection();

// --------------------------------------------------
// Pool Statistics Helper
// --------------------------------------------------

function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  };
}

// --------------------------------------------------
// Graceful Shutdown
// --------------------------------------------------

async function closePool() {
  try {
    await pool.end();
    console.log('🔌 Database pool closed gracefully');
  } catch (err) {
    console.error('❌ Error closing database pool:', err.message);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, closing database pool...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, closing database pool...');
  await closePool();
  process.exit(0);
});

// --------------------------------------------------
// Export
// --------------------------------------------------

module.exports = { pool, getPoolStats, closePool };