const { pool } = require('../config/database');
const logger = require('./logger')('transactionAuditTrail');
const { v4: uuidv4 } = require('uuid');

/**
 * Transaction Audit Trail Manager
 * Comprehensive audit logging for all transactions
 * Enables compliance, debugging, and forensic analysis
 */
class TransactionAuditTrail {
  /**
   * Log a transaction audit entry
   * @param {Object} data - Audit data
   * @returns {Promise<string>} - Audit ID
   */
  static async logTransaction(data) {
    const {
      correlationId,
      operationType,
      entityType,
      entityId,
      action,
      actorId,
      status,
      metadata = {},
      ipAddress,
      userAgent,
      transactionHash,
    } = data;

    const auditId = uuidv4();

    try {
      await pool.query(
        `INSERT INTO transaction_audit_trail (
          audit_id, correlation_id, operation_type, entity_type, entity_id,
          action, actor_id, status, metadata, ip_address, user_agent,
          transaction_hash, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
        [
          auditId,
          correlationId,
          operationType,
          entityType,
          entityId,
          action,
          actorId,
          status,
          JSON.stringify(metadata),
          ipAddress,
          userAgent,
          transactionHash,
        ]
      );

      logger.info(
        `Audit logged: ${auditId} (${operationType}/${action}) - Status: ${status}`
      );
      return auditId;
    } catch (error) {
      logger.error(`Failed to log audit trail: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieve audit trail for a correlation ID
   * @param {string} correlationId - Correlation ID
   * @returns {Promise<Array>} - Audit entries
   */
  static async getAuditTrail(correlationId) {
    try {
      const result = await pool.query(
        `SELECT * FROM transaction_audit_trail 
         WHERE correlation_id = $1 
         ORDER BY created_at ASC`,
        [correlationId]
      );

      return result.rows.map((row) => ({
        ...row,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      logger.error(`Failed to retrieve audit trail: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get audit entries for a specific entity
   * @param {string} entityType - Entity type
   * @param {string} entityId - Entity ID
   * @param {number} limit - Maximum number of entries
   * @returns {Promise<Array>} - Audit entries
   */
  static async getEntityAuditTrail(entityType, entityId, limit = 50) {
    try {
      const result = await pool.query(
        `SELECT * FROM transaction_audit_trail 
         WHERE entity_type = $1 AND entity_id = $2 
         ORDER BY created_at DESC 
         LIMIT $3`,
        [entityType, entityId, limit]
      );

      return result.rows.map((row) => ({
        ...row,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      logger.error(`Failed to retrieve entity audit trail: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get audit entries by actor
   * @param {string} actorId - User/actor ID
   * @param {number} limit - Maximum number of entries
   * @returns {Promise<Array>} - Audit entries
   */
  static async getActorAuditTrail(actorId, limit = 50) {
    try {
      const result = await pool.query(
        `SELECT * FROM transaction_audit_trail 
         WHERE actor_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [actorId, limit]
      );

      return result.rows.map((row) => ({
        ...row,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      logger.error(`Failed to retrieve actor audit trail: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieve audit entries with filters
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} - Matching audit entries
   */
  static async queryAuditTrail(filters) {
    const {
      operationType,
      status,
      startDate,
      endDate,
      limit = 100,
    } = filters;

    let query = 'SELECT * FROM transaction_audit_trail WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (operationType) {
      query += ` AND operation_type = $${paramIndex}`;
      params.push(operationType);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    try {
      const result = await pool.query(query, params);

      return result.rows.map((row) => ({
        ...row,
        metadata: JSON.parse(row.metadata || '{}'),
      }));
    } catch (error) {
      logger.error(`Failed to query audit trail: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate audit report for a date range
   * @param {Date} startDate - Report start date
   * @param {Date} endDate - Report end date
   * @returns {Promise<Object>} - Audit summary report
   */
  static async generateAuditReport(startDate, endDate) {
    try {
      const totalResult = await pool.query(
        `SELECT COUNT(*) as total, 
                COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful,
                COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed
         FROM transaction_audit_trail 
         WHERE created_at BETWEEN $1 AND $2`,
        [startDate, endDate]
      );

      const byTypeResult = await pool.query(
        `SELECT operation_type, COUNT(*) as count, 
                COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_count
         FROM transaction_audit_trail 
         WHERE created_at BETWEEN $1 AND $2 
         GROUP BY operation_type`,
        [startDate, endDate]
      );

      const failureResult = await pool.query(
        `SELECT operation_type, status, COUNT(*) as count 
         FROM transaction_audit_trail 
         WHERE created_at BETWEEN $1 AND $2 AND status != 'SUCCESS'
         GROUP BY operation_type, status`,
        [startDate, endDate]
      );

      logger.info(`Generated audit report for ${startDate} to ${endDate}`);

      return {
        period: { startDate, endDate },
        summary: totalResult.rows[0],
        byOperationType: byTypeResult.rows,
        failures: failureResult.rows,
      };
    } catch (error) {
      logger.error(`Failed to generate audit report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleanup old audit entries
   * @param {number} daysOld - Delete entries older than this many days
   * @returns {Promise<number>} - Number of entries deleted
   */
  static async cleanup(daysOld = 365) {
    try {
      const result = await pool.query(
        `DELETE FROM transaction_audit_trail 
         WHERE created_at < NOW() - INTERVAL '${daysOld} days'`,
      );

      logger.info(`Cleaned up ${result.rowCount} old audit entries`);
      return result.rowCount;
    } catch (error) {
      logger.error(`Failed to cleanup audit entries: ${error.message}`);
      throw error;
    }
  }
}

module.exports = TransactionAuditTrail;
