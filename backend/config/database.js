const { Pool } = require("pg");
require("dotenv").config();

// --------------------------------------------------
// Environment
// --------------------------------------------------

const isProduction = process.env.NODE_ENV === "production";

// --------------------------------------------------
// Database Configuration
// --------------------------------------------------

const dbConfig = {
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,

  ssl: isProduction
    ? {
        rejectUnauthorized: true,
        ca: process.env.DB_CA_CERT ? [process.env.DB_CA_CERT] : undefined,
      }
    : { rejectUnauthorized: false },

  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 20,

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
// Pool Event Handlers
// --------------------------------------------------

async function testConnection() {
  try {
    const client = await pool.connect();
    console.log("🔌 Connected to PostgreSQL");
    client.release();
  } catch (error) {
    console.error("❌ Failed to connect to PostgreSQL:", error.message);
    process.exit(1);
  }
}

testConnection();

// --------------------------------------------------
// Export
// --------------------------------------------------

module.exports = {
  pool
};