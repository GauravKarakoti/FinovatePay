const { pool } = require('../config/database');
const logger = require('./logger')('stateSnapshot');
const { v4: uuidv4 } = require('uuid');

/**
 * State Snapshot Manager
 * Captures and manages blockchain operation state snapshots
 * Enables recovery and state consistency verification
 */
class StateSnapshotManager {
  /**
   * Create a before-operation snapshot
   * @param {string} operationType - Type of operation
   * @param {string} entityType - Entity type (e.g., 'INVOICE', 'ESCROW')
   * @param {string} entityId - Entity ID
   * @param {Object} beforeState - Before state data
   * @returns {Promise<string>} - Snapshot ID
   */
  static async createBeforeSnapshot(operationType, entityType, entityId, beforeState) {
    const snapshotId = uuidv4();

    try {
      await pool.query(
        `INSERT INTO blockchain_operation_snapshots (
          snapshot_id, operation_type, entity_type, entity_id, 
          snapshot_type, state_data, created_at
        ) VALUES ($1, $2, $3, $4, 'BEFORE', $5, NOW())`,
        [snapshotId, operationType, entityType, entityId, JSON.stringify(beforeState)]
      );

      logger.info(`Created BEFORE snapshot: ${snapshotId} for ${entityType}:${entityId}`);
      return snapshotId;
    } catch (error) {
      logger.error(`Failed to create before snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create an after-operation snapshot
   * @param {string} operationType - Type of operation
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   * @param {Object} afterState - After state data
   * @param {string} beforeSnapshotId - ID of the before snapshot
   * @returns {Promise<string>} - Snapshot ID
   */
  static async createAfterSnapshot(
    operationType,
    entityType,
    entityId,
    afterState,
    beforeSnapshotId
  ) {
    const snapshotId = uuidv4();

    try {
      await pool.query(
        `INSERT INTO blockchain_operation_snapshots (
          snapshot_id, operation_type, entity_type, entity_id,
          snapshot_type, state_data, related_snapshot_id, created_at
        ) VALUES ($1, $2, $3, $4, 'AFTER', $5, $6, NOW())`,
        [snapshotId, operationType, entityType, entityId, JSON.stringify(afterState), beforeSnapshotId]
      );

      logger.info(`Created AFTER snapshot: ${snapshotId} for ${entityType}:${entityId}`);
      return snapshotId;
    } catch (error) {
      logger.error(`Failed to create after snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieve a snapshot by ID
   * @param {string} snapshotId - Snapshot ID
   * @returns {Promise<Object|null>} - Snapshot data or null
   */
  static async getSnapshot(snapshotId) {
    try {
      const result = await pool.query(
        'SELECT * FROM blockchain_operation_snapshots WHERE snapshot_id = $1',
        [snapshotId]
      );

      if (result.rows.length > 0) {
        return {
          ...result.rows[0],
          state_data: JSON.parse(result.rows[0].state_data),
        };
      }

      return null;
    } catch (error) {
      logger.error(`Failed to retrieve snapshot: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get before and after snapshots for a transaction
   * @param {string} beforeSnapshotId - ID of the before snapshot
   * @returns {Promise<Object>} - Before and after snapshot pair
   */
  static async getSnapshotPair(beforeSnapshotId) {
    try {
      const beforeSnapshot = await this.getSnapshot(beforeSnapshotId);

      if (!beforeSnapshot) {
        throw new Error(`Before snapshot not found: ${beforeSnapshotId}`);
      }

      const afterResult = await pool.query(
        `SELECT * FROM blockchain_operation_snapshots 
         WHERE related_snapshot_id = $1 AND snapshot_type = 'AFTER'`,
        [beforeSnapshotId]
      );

      let afterSnapshot = null;
      if (afterResult.rows.length > 0) {
        afterSnapshot = {
          ...afterResult.rows[0],
          state_data: JSON.parse(afterResult.rows[0].state_data),
        };
      }

      return { beforeSnapshot, afterSnapshot };
    } catch (error) {
      logger.error(`Failed to retrieve snapshot pair: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify state consistency between before and after snapshots
   * @param {string} beforeSnapshotId - ID of the before snapshot
   * @returns {Promise<Object>} - Verification result
   */
  static async verifyStateConsistency(beforeSnapshotId) {
    try {
      const { beforeSnapshot, afterSnapshot } = await this.getSnapshotPair(beforeSnapshotId);

      if (!afterSnapshot) {
        return {
          consistent: false,
          reason: 'After snapshot not found',
          beforeSnapshot,
          afterSnapshot: null,
        };
      }

      // Verify entity is the same
      const sameEntity = 
        beforeSnapshot.entity_type === afterSnapshot.entity_type &&
        beforeSnapshot.entity_id === afterSnapshot.entity_id;

      // Verify operation type matches
      const sameOperation = beforeSnapshot.operation_type === afterSnapshot.operation_type;

      const consistent = sameEntity && sameOperation;

      logger.info(
        `State consistency verification for ${beforeSnapshotId}: ${consistent ? 'PASSED' : 'FAILED'}`
      );

      return {
        consistent,
        beforeSnapshot,
        afterSnapshot,
        validations: {
          sameEntity,
          sameOperation,
        },
      };
    } catch (error) {
      logger.error(`Failed to verify state consistency: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleanup old snapshots
   * @param {number} daysOld - Delete snapshots older than this many days
   * @returns {Promise<number>} - Number of snapshots deleted
   */
  static async cleanup(daysOld = 90) {
    try {
      const result = await pool.query(
        `DELETE FROM blockchain_operation_snapshots 
         WHERE created_at < NOW() - INTERVAL '${daysOld} days'`,
      );

      logger.info(`Cleaned up ${result.rowCount} old snapshots`);
      return result.rowCount;
    } catch (error) {
      logger.error(`Failed to cleanup snapshots: ${error.message}`);
      throw error;
    }
  }
}

module.exports = StateSnapshotManager;
