const { pool } = require('../config/database');
const logger = require('./logger')('transactionWrapper');
const { v4: uuidv4 } = require('uuid');

/**
 * Transaction Wrapper Utility
 * Provides safe transaction handling with automatic rollback on errors
 * and comprehensive state tracking for recovery
 */
class TransactionWrapper {
  constructor() {
    this.client = null;
    this.correlationId = null;
    this.stepsCompleted = [];
    this.snapshots = {};
  }

  /**
   * Initialize a new transaction
   * @param {string} operationType - Type of operation
   * @param {Object} context - Context data for the transaction
   * @returns {Promise<string>} - Correlation ID
   */
  async begin(operationType, context = {}) {
    try {
      this.client = await pool.connect();
      this.correlationId = context.correlationId || uuidv4();
      this.operationType = operationType;
      this.context = context;

      await this.client.query('BEGIN');
      logger.info(`Transaction started: ${this.correlationId} (${operationType})`);
      
      return this.correlationId;
    } catch (error) {
      logger.error(`Failed to begin transaction: ${error.message}`);
      if (this.client) this.client.release();
      throw error;
    }
  }

  /**
   * Execute a query within the transaction
   * @param {string} stepName - Name of the step for tracking
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} - Query result
   */
  async query(stepName, sql, params = []) {
    if (!this.client) {
      throw new Error('Transaction not initialized. Call begin() first.');
    }

    try {
      logger.debug(`Executing step: ${stepName}`);
      const result = await this.client.query(sql, params);
      
      this.stepsCompleted.push({
        name: stepName,
        timestamp: new Date(),
        rowsAffected: result.rowCount,
      });

      logger.debug(`Step completed: ${stepName} (${result.rowCount} rows)`);
      return result;
    } catch (error) {
      logger.error(`Step failed: ${stepName} - ${error.message}`);
      throw new Error(`Failed at step '${stepName}': ${error.message}`);
    }
  }

  /**
   * Create a state snapshot before a blockchain operation
   * @param {string} snapshotName - Name of the snapshot
   * @param {Object} data - Data to snapshot
   */
  addSnapshot(snapshotName, data) {
    this.snapshots[snapshotName] = {
      timestamp: new Date(),
      data,
    };
    logger.debug(`Snapshot created: ${snapshotName}`);
  }

  /**
   * Get a previously created snapshot
   * @param {string} snapshotName - Name of the snapshot
   * @returns {Object} - Snapshot data or null
   */
  getSnapshot(snapshotName) {
    return this.snapshots[snapshotName] || null;
  }

  /**
   * Commit the transaction
   * @returns {Promise<void>}
   */
  async commit() {
    if (!this.client) {
      throw new Error('No active transaction to commit.');
    }

    try {
      await this.client.query('COMMIT');
      logger.info(
        `Transaction committed: ${this.correlationId} ` +
        `(${this.stepsCompleted.length} steps completed)`
      );
    } catch (error) {
      logger.error(`Failed to commit transaction: ${error.message}`);
      throw error;
    } finally {
      if (this.client) this.client.release();
    }
  }

  /**
   * Rollback the transaction
   * @returns {Promise<void>}
   */
  async rollback() {
    if (!this.client) {
      throw new Error('No active transaction to rollback.');
    }

    try {
      await this.client.query('ROLLBACK');
      logger.warn(
        `Transaction rolled back: ${this.correlationId} ` +
        `(after ${this.stepsCompleted.length} completed steps)`
      );
    } catch (error) {
      logger.error(`Failed to rollback transaction: ${error.message}`);
      throw error;
    } finally {
      if (this.client) this.client.release();
    }
  }

  /**
   * Get transaction context for logging/recovery
   * @returns {Object} - Transaction context
   */
  getContext() {
    return {
      correlationId: this.correlationId,
      operationType: this.operationType,
      stepsCompleted: this.stepsCompleted,
      snapshotKeys: Object.keys(this.snapshots),
      createdAt: new Date(),
    };
  }

  /**
   * Execute a function within transaction context
   * @param {Function} fn - Async function to execute
   * @param {string} operationType - Type of operation
   * @param {Object} context - Initial context
   * @returns {Promise<Object>} - Function result and transaction context
   */
  static async withTransaction(fn, operationType, context = {}) {
    const tx = new TransactionWrapper();
    const correlationId = await tx.begin(operationType, context);

    try {
      const result = await fn(tx);
      await tx.commit();

      return {
        success: true,
        result,
        correlationId,
        context: tx.getContext(),
      };
    } catch (error) {
      await tx.rollback();

      return {
        success: false,
        error: error.message,
        correlationId,
        context: tx.getContext(),
      };
    }
  }
}

module.exports = TransactionWrapper;
