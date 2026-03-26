const { pool } = require('../config/database');
const logger = require('../utils/logger')('audit');

/**
 * Logs an audit event to the database for compliance and tracking purposes.
 * * @param {Object} params
 * @param {string} params.operationType - E.g., 'MULTI_PARTY_ESCROW_CREATE'
 * @param {string} params.entityType - E.g., 'ESCROW', 'MILESTONE'
 * @param {string} params.entityId - The ID of the entity being modified
 * @param {string} params.actorId - User ID performing the action
 * @param {string} params.actorWallet - Wallet address of the user
 * @param {string} params.actorRole - Role of the user (buyer, seller, admin, etc.)
 * @param {string} params.action - 'CREATE', 'UPDATE', 'DELETE', etc.
 * @param {string} params.status - 'SUCCESS', 'FAILED'
 * @param {Object} [params.oldValues] - Previous state (optional)
 * @param {Object} [params.newValues] - New state (optional)
 * @param {string} [params.errorMessage] - Error message if status is FAILED
 * @param {string} [params.ipAddress] - IP address of the requestor
 * @param {string} [params.userAgent] - User agent of the requestor
 */
const logAudit = async ({
    operationType,
    entityType,
    entityId,
    actorId,
    actorWallet,
    actorRole,
    action,
    status,
    oldValues = null,
    newValues = null,
    errorMessage = null,
    ipAddress = null,
    userAgent = null
}) => {
    try {
        const query = `
            INSERT INTO audit_logs (
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
                error_message, 
                ip_address, 
                user_agent,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            RETURNING id;
        `;

        const values = [
            operationType,
            entityType,
            entityId,
            actorId,
            actorWallet,
            actorRole,
            action,
            status,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            errorMessage,
            ipAddress,
            userAgent
        ];

        await pool.query(query, values);

    } catch (error) {
        // We log the error but don't throw it because audit logging 
        // shouldn't typically break the main application flow if it fails
        logger.error('Failed to write audit log to database:', error);
    }
};

module.exports = {
    logAudit
};