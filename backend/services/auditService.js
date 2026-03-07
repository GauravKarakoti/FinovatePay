const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Audit Service - Comprehensive logging for compliance and fraud detection
 * Logs all critical operations with full context and state changes
 */

class AuditService {
  /**
   * Log an audit entry for any operation
   * @param {Object} auditData - Audit log data
   * @param {string} auditData.operationType - Type of operation (e.g., USER_LOGIN, ESCROW_RELEASE)
   * @param {string} auditData.entityType - Type of entity affected (user, invoice, escrow, etc.)
   * @param {string} auditData.entityId - ID of the entity
   * @param {string} auditData.action - Action performed
   * @param {number} auditData.actorId - User performing the action
   * @param {string} auditData.actorWallet - Wallet address of actor
   * @param {string} auditData.actorRole - Role of the actor
   * @param {Object} auditData.oldValues - Previous state (before change)
   * @param {Object} auditData.newValues - New state (after change)
   * @param {string} auditData.ipAddress - IP address of requester
   * @param {string} auditData.userAgent - User agent string
   * @param {string} auditData.status - Operation status (SUCCESS, FAILED, PENDING)
   * @param {string} auditData.errorMessage - Error message if failed
   * @param {Object} auditData.metadata - Additional metadata
   * @returns {Promise<Object>} - Audit log record
   */
  static async createAuditLog(auditData) {
    const client = await pool.connect();
    try {
      const operationId = uuidv4();

      const query = `
        INSERT INTO audit_logs (
          operation_id,
          operation_type,
          entity_type,
          entity_id,
          actor_id,
          actor_wallet,
          actor_role,
          action,
          status,
          old_values,
          new_values,
          metadata,
          ip_address,
          user_agent,
          error_message,
          created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
        )
        RETURNING *;
      `;

      const result = await client.query(query, [
        operationId,
        auditData.operationType || 'UNKNOWN',
        auditData.entityType || 'unknown',
        auditData.entityId || 'unknown',
        auditData.actorId || null,
        auditData.actorWallet || null,
        auditData.actorRole || null,
        auditData.action || 'performed',
        auditData.status || 'PENDING',
        auditData.oldValues || null,
        auditData.newValues || null,
        auditData.metadata || null,
        auditData.ipAddress || null,
        auditData.userAgent || null,
        auditData.errorMessage || null,
      ]);

      return result.rows[0];
    } catch (error) {
      console.error('Error creating audit log:', error);
      // Don't throw - audit logging should not break the main operation
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Log user authentication events
   */
  static async logUserAuth(auditData) {
    return this.createAuditLog({
      operationType: auditData.type === 'login' ? 'USER_LOGIN' : (auditData.type === 'register' ? 'USER_REGISTER' : 'USER_LOGOUT'),
      entityType: 'user',
      entityId: auditData.userId,
      action: auditData.action || auditData.type,
      actorId: auditData.userId,
      actorWallet: auditData.wallet,
      actorRole: auditData.role,
      status: auditData.status || 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      errorMessage: auditData.errorMessage,
      metadata: {
        email: auditData.email,
        method: auditData.method || 'password',
        attemptCount: auditData.attemptCount,
        failureReason: auditData.failureReason,
      },
    });
  }

  /**
   * Log failed authentication attempts
   */
  static async logFailedAuth(auditData) {
    return this.createAuditLog({
      operationType: 'USER_LOGIN',
      entityType: 'user',
      entityId: auditData.userId,
      action: 'login_attempt_failed',
      actorId: auditData.userId,
      actorRole: 'unknown',
      status: 'FAILED',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      errorMessage: auditData.errorMessage,
      metadata: {
        email: auditData.email,
        failureReason: auditData.reason,
        attemptCount: auditData.attemptCount,
      },
    });
  }

  /**
   * Log role and permission changes
   */
  static async logRoleChange(auditData) {
    return this.createAuditLog({
      operationType: 'ADMIN_ROLE_CHANGE',
      entityType: 'user',
      entityId: auditData.targetUserId,
      action: 'role_changed',
      actorId: auditData.actorId,
      actorRole: auditData.actorRole,
      actorWallet: auditData.actorWallet,
      oldValues: { role: auditData.oldRole },
      newValues: { role: auditData.newRole },
      status: 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      metadata: {
        targetUser: auditData.targetUserId,
        reason: auditData.reason,
      },
    });
  }

  /**
   * Log invoice status changes
   */
  static async logInvoiceChange(auditData) {
    return this.createAuditLog({
      operationType: auditData.operationType || 'INVOICE_UPDATE',
      entityType: 'invoice',
      entityId: auditData.invoiceId,
      action: auditData.action || 'status_changed',
      actorId: auditData.actorId,
      actorRole: auditData.actorRole,
      actorWallet: auditData.actorWallet,
      oldValues: auditData.oldValues || { status: auditData.oldStatus },
      newValues: auditData.newValues || { status: auditData.newStatus },
      status: 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      metadata: {
        amount: auditData.amount,
        currency: auditData.currency,
        buyerId: auditData.buyerId,
        sellerId: auditData.sellerId,
        reason: auditData.reason,
      },
    });
  }

  /**
   * Log escrow and payment operations
   */
  static async logEscrowOperation(auditData) {
    return this.createAuditLog({
      operationType: auditData.operationType || 'ESCROW_RELEASE',
      entityType: 'escrow',
      entityId: auditData.escrowId || auditData.invoiceId,
      action: auditData.action || 'operation_performed',
      actorId: auditData.actorId,
      actorRole: auditData.actorRole,
      actorWallet: auditData.actorWallet,
      oldValues: auditData.oldValues,
      newValues: auditData.newValues,
      status: auditData.status || 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      errorMessage: auditData.errorMessage,
      metadata: {
        invoiceId: auditData.invoiceId,
        amount: auditData.amount,
        currency: auditData.currency,
        transactionHash: auditData.transactionHash,
        reason: auditData.reason,
      },
    });
  }

  /**
   * Log admin actions (freeze/unfreeze accounts)
   */
  static async logAdminAction(auditData) {
    return this.createAuditLog({
      operationType: auditData.operationType || 'ADMIN_FREEZE',
      entityType: 'user',
      entityId: auditData.targetUserId,
      action: auditData.action || 'admin_action_performed',
      actorId: auditData.actorId,
      actorRole: auditData.actorRole,
      actorWallet: auditData.actorWallet,
      oldValues: { status: auditData.oldStatus },
      newValues: { status: auditData.newStatus },
      status: 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      metadata: {
        targetUser: auditData.targetUserId,
        reason: auditData.reason,
        duration: auditData.duration,
      },
    });
  }

  /**
   * Log KYC verification events
   */
  static async logKYCEvent(auditData) {
    return this.createAuditLog({
      operationType: auditData.operationType || 'KYC_VERIFY',
      entityType: 'kyc',
      entityId: auditData.userId,
      action: auditData.action || 'kyc_verification_performed',
      actorId: auditData.actorId || auditData.userId,
      actorRole: auditData.actorRole,
      actorWallet: auditData.actorWallet,
      oldValues: { kycStatus: auditData.oldStatus },
      newValues: { kycStatus: auditData.newStatus },
      status: auditData.status || 'SUCCESS',
      ipAddress: auditData.ipAddress,
      userAgent: auditData.userAgent,
      errorMessage: auditData.errorMessage,
      metadata: {
        provider: auditData.provider,
        documentType: auditData.documentType,
        verificationMethod: auditData.verificationMethod,
        message: auditData.message,
      },
    });
  }

  /**
   * Get audit logs with filtering
   */
  static async getAuditLogs(filters = {}) {
    let query = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (filters.operationType) {
      query += ` AND operation_type = $${paramIndex}`;
      params.push(filters.operationType);
      paramIndex++;
    }

    if (filters.entityType) {
      query += ` AND entity_type = $${paramIndex}`;
      params.push(filters.entityType);
      paramIndex++;
    }

    if (filters.entityId) {
      query += ` AND entity_id = $${paramIndex}`;
      params.push(filters.entityId);
      paramIndex++;
    }

    if (filters.actorId) {
      query += ` AND actor_id = $${paramIndex}`;
      params.push(filters.actorId);
      paramIndex++;
    }

    if (filters.status) {
      query += ` AND status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(filters.startDate);
      paramIndex++;
    }

    if (filters.endDate) {
      query += ` AND created_at <= $${paramIndex}`;
      params.push(filters.endDate);
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC LIMIT $' + paramIndex;
    params.push(filters.limit || 100);

    try {
      const result = await pool.query(query, params);
      return result.rows;
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      return [];
    }
  }

  /**
   * Get audit trail for a specific entity
   */
  static async getEntityAuditTrail(entityType, entityId) {
    try {
      const result = await pool.query(
        `SELECT * FROM audit_logs 
         WHERE entity_type = $1 AND entity_id = $2 
         ORDER BY created_at DESC`,
        [entityType, entityId]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching entity audit trail:', error);
      return [];
    }
  }

  /**
   * Get audit trail for a specific user (actions performed by user)
   */
  static async getUserAuditTrail(userId, limit = 100) {
    try {
      const result = await pool.query(
        `SELECT * FROM audit_logs 
         WHERE actor_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching user audit trail:', error);
      return [];
    }
  }

  /**
   * Generate compliance report
   */
  static async generateComplianceReport(startDate, endDate) {
    try {
      const result = await pool.query(
        `SELECT 
           operation_type,
           COUNT(*) as count,
           SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful,
           SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
         FROM audit_logs
         WHERE created_at >= $1 AND created_at <= $2
         GROUP BY operation_type
         ORDER BY count DESC`,
        [startDate, endDate]
      );
      return result.rows;
    } catch (error) {
      console.error('Error generating compliance report:', error);
      return [];
    }
  }
}

module.exports = AuditService;
