const { Pool } = require('pg');
require('dotenv').config();

// Create the connection pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
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