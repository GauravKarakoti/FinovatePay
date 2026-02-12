const { Pool } = require('pg');
require('dotenv').config();

// Create the connection pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    
    // SSL Configuration for Cloud Providers (Render, Heroku, Neon, etc.)
    ssl: (process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true') ? {
      rejectUnauthorized: false
    } : false,
    
    // Enhanced Pool Settings for Maximum Resilience
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
    query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 60000,
    max: parseInt(process.env.DB_POOL_MAX) || 20,
    min: parseInt(process.env.DB_POOL_MIN) || 2,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
    reapIntervalMillis: parseInt(process.env.DB_REAP_INTERVAL) || 1000,
    maxLifetimeSeconds: parseInt(process.env.DB_MAX_LIFETIME) || 3600,
};

const pool = new Pool(dbConfig);

// Circuit Breaker State Management
let circuitBreakerState = {
  isOpen: false,
  failureCount: 0,
  lastFailureTime: null,
  successCount: 0
};

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: parseInt(process.env.DB_CIRCUIT_FAILURE_THRESHOLD) || 5,
  recoveryTimeout: parseInt(process.env.DB_CIRCUIT_RECOVERY_TIMEOUT) || 60000,
  successThreshold: parseInt(process.env.DB_CIRCUIT_SUCCESS_THRESHOLD) || 3
};

/**
 * ENHANCED ERROR HANDLING: Graceful Error Handling with Circuit Breaker
 */
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle database client:', {
    error: err.message,
    code: err.code,
    timestamp: new Date().toISOString(),
    clientProcessId: client?.processID
  });
  updateCircuitBreakerOnFailure();
});

// Log the connection status
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database Connection Error:', err.message);
  } else {
    console.log('🔌 Connected to Database');
    release();
  }
});

// --- THE HYBRID EXPORT FIX ---
// This allows both "const pool = require()" AND "const { pool } = require()" to work
module.exports = pool;
module.exports.pool = pool;