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
  port: process.env.DB_PORT
    ? parseInt(process.env.DB_PORT)
    : 5432,

  // Enable SSL only in production
  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,

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
};

// --------------------------------------------------
// Pool Initialization
// --------------------------------------------------

const pool = new Pool(dbConfig);

// --------------------------------------------------
// Initial Connection Test (Fail-Fast)
// --------------------------------------------------

pool
  .connect()
  .then((client) => {
    console.log("🔌 Connected to PostgreSQL");
    client.release();
  })
  .catch((error) => {
    console.error("❌ Failed to connect to PostgreSQL:", error.message);
  });

// --------------------------------------------------
// Export
// --------------------------------------------------

module.exports = { pool };