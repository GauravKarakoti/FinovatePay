const { pool } = require('../config/database');

/**
 * EventSync Model
 * Tracks the last processed block number for blockchain event synchronization
 * to prevent missed events during server restarts or crashes
 */
class EventSync {
  /**
   * Initialize the event_sync table if it doesn't exist
   */
  static async initializeTable() {
    const query = `
      CREATE TABLE IF NOT EXISTS event_sync (
        id SERIAL PRIMARY KEY,
        event_name VARCHAR(100) UNIQUE NOT NULL,
        last_processed_block BIGINT NOT NULL DEFAULT 0,
        last_processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      -- Create index for faster lookups
      CREATE INDEX IF NOT EXISTS idx_event_sync_event_name ON event_sync(event_name);
      
      -- Insert default entry for Tokenized event if not exists
      INSERT INTO event_sync (event_name, last_processed_block)
      VALUES ('Tokenized', 0)
      ON CONFLICT (event_name) DO NOTHING;
    `;
    
    try {
      await pool.query(query);
      console.log('✅ EventSync table initialized');
    } catch (error) {
      console.error('❌ Failed to initialize EventSync table:', error);
      throw error;
    }
  }

  /**
   * Get the last processed block number for a specific event
   * @param {string} eventName - Name of the blockchain event
   * @returns {Promise<number>} Last processed block number
   */
  static async getLastProcessedBlock(eventName) {
    const query = `
      SELECT last_processed_block 
      FROM event_sync 
      WHERE event_name = $1
    `;
    
    try {
      const result = await pool.query(query, [eventName]);
      
      if (result.rows.length === 0) {
        // If no record exists, create one starting from block 0
        await pool.query(
          'INSERT INTO event_sync (event_name, last_processed_block) VALUES ($1, 0)',
          [eventName]
        );
        return 0;
      }
      
      return parseInt(result.rows[0].last_processed_block);
    } catch (error) {
      console.error(`❌ Failed to get last processed block for ${eventName}:`, error);
      throw error;
    }
  }

  /**
   * Update the last processed block number for a specific event
   * @param {string} eventName - Name of the blockchain event
   * @param {number} blockNumber - Block number to save
   * @returns {Promise<void>}
   */
  static async updateLastProcessedBlock(eventName, blockNumber) {
    const query = `
      UPDATE event_sync 
      SET 
        last_processed_block = $1,
        last_processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE event_name = $2
      RETURNING *
    `;
    
    try {
      const result = await pool.query(query, [blockNumber, eventName]);
      
      if (result.rows.length === 0) {
        // If no record exists, create one
        await pool.query(
          'INSERT INTO event_sync (event_name, last_processed_block) VALUES ($1, $2)',
          [eventName, blockNumber]
        );
      }
      
      return result.rows[0];
    } catch (error) {
      console.error(`❌ Failed to update last processed block for ${eventName}:`, error);
      throw error;
    }
  }

  /**
   * Get sync status for all events
   * @returns {Promise<Array>} Array of event sync records
   */
  static async getAllSyncStatus() {
    const query = `
      SELECT * FROM event_sync 
      ORDER BY event_name
    `;
    
    try {
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get all sync status:', error);
      throw error;
    }
  }
}

module.exports = EventSync;
