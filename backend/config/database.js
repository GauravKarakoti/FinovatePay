const { Pool } = require('pg');

// Enhanced Database Configuration with Resilience
const dbConfig = {
    // Your Database Credentials from .env
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
      rejectUnauthorized: false
    },
    
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

/**
 * CIRCUIT BREAKER FUNCTIONS
 */
function updateCircuitBreakerOnFailure() {
  circuitBreakerState.failureCount++;
  circuitBreakerState.lastFailureTime = Date.now();
  
  if (circuitBreakerState.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    circuitBreakerState.isOpen = true;
    console.error('Circuit breaker OPENED - Database connections suspended');
  }
}

function updateCircuitBreakerOnSuccess() {
  if (circuitBreakerState.isOpen) {
    circuitBreakerState.successCount++;
    
    if (circuitBreakerState.successCount >= CIRCUIT_BREAKER_CONFIG.successThreshold) {
      circuitBreakerState.isOpen = false;
      circuitBreakerState.failureCount = 0;
      circuitBreakerState.successCount = 0;
      console.log('Circuit breaker CLOSED - Database connections restored');
    }
  } else {
    circuitBreakerState.failureCount = Math.max(0, circuitBreakerState.failureCount - 1);
  }
}

function isCircuitBreakerOpen() {
  if (!circuitBreakerState.isOpen) return false;
  
  const timeSinceLastFailure = Date.now() - circuitBreakerState.lastFailureTime;
  if (timeSinceLastFailure > CIRCUIT_BREAKER_CONFIG.recoveryTimeout) {
    console.log('Circuit breaker entering HALF-OPEN state for recovery attempt');
    return false;
  }
  
  return true;
}

/**
 * ENHANCED CONNECTION WRAPPER WITH CIRCUIT BREAKER
 */
async function getConnection() {
  if (isCircuitBreakerOpen()) {
    throw new Error('Database circuit breaker is OPEN - connections suspended');
  }
  
  try {
    const client = await pool.connect();
    updateCircuitBreakerOnSuccess();
    return client;
  } catch (error) {
    updateCircuitBreakerOnFailure();
    throw error;
  }
}

/**
 * DATABASE HEALTH CHECK FUNCTION
 */
async function getDatabaseHealth() {
  const health = {
    status: 'unknown',
    timestamp: new Date().toISOString(),
    pool: {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
      config: {
        max: dbConfig.max,
        min: dbConfig.min,
        connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
        idleTimeoutMillis: dbConfig.idleTimeoutMillis
      }
    },
    circuitBreaker: {
      isOpen: circuitBreakerState.isOpen,
      failureCount: circuitBreakerState.failureCount,
      successCount: circuitBreakerState.successCount,
      lastFailureTime: circuitBreakerState.lastFailureTime
    }
  };
  
  try {
    if (isCircuitBreakerOpen()) {
      health.status = 'circuit_breaker_open';
      health.message = 'Database circuit breaker is open';
      return health;
    }
    
    const startTime = Date.now();
    const client = await pool.connect();
    
    const result = await client.query('SELECT NOW() as current_time, version() as db_version');
    const responseTime = Date.now() - startTime;
    
    client.release();
    
    health.status = 'healthy';
    health.responseTimeMs = responseTime;
    health.database = {
      currentTime: result.rows[0].current_time,
      version: result.rows[0].db_version
    };
    
    updateCircuitBreakerOnSuccess();
    
  } catch (error) {
    health.status = 'unhealthy';
    health.error = {
      message: error.message,
      code: error.code
    };
    updateCircuitBreakerOnFailure();
  }
  
  return health;
}

// const initializeDbQuery = `
//   -- Add a column to track the available quantity, separate from the initial quantity
//   ALTER TABLE produce_lots ADD COLUMN current_quantity DECIMAL(18, 2);

//   -- Add a column for the seller to set the price per kg
//   ALTER TABLE produce_lots ADD COLUMN price DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

//   -- Initialize the new column with the initial quantity for existing lots
//   UPDATE produce_lots SET current_quantity = quantity WHERE current_quantity IS NULL;

//   -- Add a column to the invoices table to link it to a specific produce lot
//   ALTER TABLE invoices ADD COLUMN lot_id INTEGER REFERENCES produce_lots(lot_id);
// `;

// const initializeDatabase = async () => {
//   const client = await pool.connect();
//   try {
//     await client.query(initializeDbQuery);
//     console.log('✅ Database schema checked and initialized successfully.');
//   } catch (err) {
//     console.error('❌ Error initializing database schema:', err.stack);
//     process.exit(1); 
// --- EXPORTS ---
module.exports = {
  pool,
  getConnection,
  getDatabaseHealth,
  circuitBreakerState: () => ({ ...circuitBreakerState })
};