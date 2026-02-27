const { pool } = require('../config/database');

/**
 * Graceful Shutdown Utility for Node.js Server
 * 
 * Handles SIGINT and SIGTERM signals to properly close:
 * - Database connections
 * - Socket.io connections  
 * - Background workers/intervals
 */

let serverRef = null;
let ioRef = null;

/**
 * Helper function to wait for a specified duration
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Set up graceful shutdown handlers for the server
 * @param {http.Server} server - The HTTP server instance
 * @param {socketIo.Server} io - Socket.io instance (optional)
 */
function setupGracefulShutdown(server, io) {
  serverRef = server;
  ioRef = io;

  const handleShutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
    
    try {
      // Step 1: Stop accepting new connections immediately
      if (serverRef) {
        serverRef.close(() => {
          console.log('✅ HTTP server closed');
        });
      }

      // Step 2: Notify connected clients via Socket.io about impending shutdown
      if (ioRef) {
        console.log('📡 Notifying clients about shutdown...');
        ioRef.emit('shutdown', { 
          message: 'Server is shutting down',
          timestamp: Date.now()
        });
        
        // Give clients time to receive the notification before closing sockets
        await wait(2000);
        
        // Forcefully disconnect all socket connections after grace period
        ioRef.disconnectSockets(true);
      }

      // Step 3: Wait briefly for any pending operations
      await wait(1000);

      // Step 4: Close database connection pool
      console.log('🔌 Closing database connection pool...');
      try {
        await pool.end();
        console.log('✅ Database connections closed');
      } catch (err) {
        console.error('❌ Error closing database:', err.message);
      }

      console.log('👋 Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('❌ Error during graceful shutdown:', err.message);
      process.exit(1);
    }
  };

  // Register signal handlers for both SIGINT (Ctrl+C) and SIGTERM (Docker/k8s)
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => handleShutdown(signal));
  });

  console.log('✅ Graceful shutdown handlers registered');
  return true;
}

module.exports = {
  setupGracefulShutdown
};
