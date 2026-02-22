const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const isProduction = process.env.NODE_ENV === "production";

// Enhanced Database Configuration with Resilience
const dbConfig = {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: isProduction
      ? { rejectUnauthorized: false }
      : false,
    
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

pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Error acquiring client', err.stack);
  } else {
    console.log('🔌 Connected to Database');
    release();
  }
});

module.exports = { pool };
