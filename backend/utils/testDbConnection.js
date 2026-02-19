const { pool, getConnection } = require('../config/database');

/**
 * ENHANCED DATABASE CONNECTION TEST WITH EXPONENTIAL BACKOFF
 * Implements robust retry logic with exponential backoff and jitter
 */
const testDbConnection = async () => {
  const maxRetries = parseInt(process.env.DB_MAX_RETRIES) || 5;
  const baseDelay = parseInt(process.env.DB_RETRY_BASE_DELAY) || 1000;
  const maxDelay = parseInt(process.env.DB_RETRY_MAX_DELAY) || 30000;

  let retries = 0;

  while (retries < maxRetries) {
    try {
      console.log(`Attempting database connection (${retries + 1}/${maxRetries})...`);

      const client = await getConnection();
      await client.query('SELECT 1 as test');
      client.release();

      console.log('Database connection established successfully');
      console.log('Initial database pool status:', {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount
      });

      return true;
    } catch (err) {
      retries++;

      console.error(`❌ Database connection attempt ${retries} failed:`, {
        error: err.message,
        code: err.code,
        attempt: `${retries}/${maxRetries}`,
        timestamp: new Date().toISOString()
      });

      if (retries >= maxRetries) {
        console.error('Failed to connect to database after maximum retries.');
        console.error('Server will continue but database features may not work.');
        console.error('Please check your database configuration and network connectivity.');
        return false;
      }

      const exponentialDelay = Math.min(baseDelay * Math.pow(2, retries - 1), maxDelay);
      const jitter = Math.random() * 0.1 * exponentialDelay;
      const delay = exponentialDelay + jitter;

      console.log(`Retrying database connection in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return false;
};

module.exports = testDbConnection;
