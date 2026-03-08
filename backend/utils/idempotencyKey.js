const { pool } = require('../config/database');
const crypto = require('crypto');
const logger = require('./logger')('idempotencyKey');

/**
 * Idempotency Key Manager
 * Prevents duplicate operations using idempotency keys
 * Ensures retry safety for critical operations
 */
class IdempotencyKeyManager {
  /**
   * Generate a unique idempotency key
   * @param {string} prefix - Prefix for the key (e.g., 'escrow-release')
   * @param {Object} data - Data to hash for uniqueness
   * @returns {string} - Idempotency key
   */
  static generateKey(prefix, data) {
    const hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
    return `${prefix}_${hash}`;
  }

  /**
   * Record an idempotency key with its result
   * @param {string} idempotencyKey - Idempotency key
   * @param {string} operationType - Type of operation
   * @param {Object} operationData - Operation data
   * @param {Object} result - Operation result
   * @returns {Promise<void>}
   */
  static async recordKey(idempotencyKey, operationType, operationData, result) {
    try {
      await pool.query(
        `INSERT INTO idempotency_keys (
          idempotency_key, operation_type, operation_data, result, 
          created_at
        ) VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, operationType, JSON.stringify(operationData), JSON.stringify(result)]
      );

      logger.info(`Recorded idempotency key: ${idempotencyKey}`);
    } catch (error) {
      logger.error(`Failed to record idempotency key: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if an idempotency key has been processed
   * @param {string} idempotencyKey - Idempotency key to check
   * @returns {Promise<Object|null>} - Previous result if key exists, null otherwise
   */
  static async checkKey(idempotencyKey) {
    try {
      const result = await pool.query(
        'SELECT result FROM idempotency_keys WHERE idempotency_key = $1',
        [idempotencyKey]
      );

      if (result.rows.length > 0) {
        logger.info(`Idempotency key found: ${idempotencyKey}, returning cached result`);
        return result.rows[0].result;
      }

      return null;
    } catch (error) {
      logger.error(`Failed to check idempotency key: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleanup old idempotency keys (older than specified days)
   * @param {number} daysOld - Delete keys older than this many days
   * @returns {Promise<number>} - Number of keys deleted
   */
  static async cleanup(daysOld = 30) {
    try {
      const result = await pool.query(
        `DELETE FROM idempotency_keys 
         WHERE created_at < NOW() - INTERVAL '${daysOld} days'`,
      );

      logger.info(`Cleaned up ${result.rowCount} old idempotency keys`);
      return result.rowCount;
    } catch (error) {
      logger.error(`Failed to cleanup idempotency keys: ${error.message}`);
      throw error;
    }
  }
}

module.exports = IdempotencyKeyManager;
