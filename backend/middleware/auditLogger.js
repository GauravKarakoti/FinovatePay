const { pool } = require('../config/database');

/**
 * Log an audit entry for compliance tracking
 * @param {Object} auditData - Audit log data
 * @returns {Promise<Object>} - Created audit log entry
 */
const logAudit = async (auditData) => {
    try {
        const {
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
            metadata = null,
            ipAddress = null,
            userAgent = null,
            errorMessage = null
        } = auditData;

        const result = await pool.query(
            `INSERT INTO audit_logs (
                operation_type, entity_type, entity_id, actor_id, actor_wallet, actor_role,
                action, status, old_values, new_values, metadata, ip_address, user_agent, error_message
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *`,
            [
                operationType, entityType, entityId, actorId, actorWallet, actorRole,
                action, status, 
                oldValues ? JSON.stringify(oldValues) : null,
                newValues ? JSON.stringify(newValues) : null,
                metadata ? JSON.stringify(metadata) : null,
                ipAddress, userAgent, errorMessage
            ]
        );

        return result.rows[0];
    } catch (error) {
        console.error('❌ Audit logging failed:', error);
        // Don't throw - audit logging failure shouldn't break the operation
        return null;
    }
};

/**
 * Log a financial transaction
 * @param {Object} txData - Transaction data
 * @returns {Promise<Object>} - Created transaction entry
 */
const logFinancialTransaction = async (txData) => {
    try {
        const {
            transactionType,
            invoiceId = null,
            fromAddress,
            toAddress,
            amount,
            currency = 'USDC',
            blockchainTxHash = null,
            status,
            initiatedBy,
            metadata = null
        } = txData;

        const result = await pool.query(
            `INSERT INTO financial_transactions (
                transaction_type, invoice_id, from_address, to_address, amount, currency,
                blockchain_tx_hash, status, initiated_by, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                transactionType, invoiceId, fromAddress, toAddress, amount, currency,
                blockchainTxHash, status, initiatedBy,
                metadata ? JSON.stringify(metadata) : null
            ]
        );

        return result.rows[0];
    } catch (error) {
        console.error('❌ Financial transaction logging failed:', error);
        return null;
    }
};

/**
 * Update financial transaction status
 * @param {string} transactionId - Transaction UUID
 * @param {string} status - New status
 * @param {string} blockchainTxHash - Blockchain transaction hash
 */
const updateFinancialTransaction = async (transactionId, status, blockchainTxHash = null) => {
    try {
        await pool.query(
            `UPDATE financial_transactions 
             SET status = $1, blockchain_tx_hash = $2, confirmed_at = NOW()
             WHERE transaction_id = $3`,
            [status, blockchainTxHash, transactionId]
        );
    } catch (error) {
        console.error('❌ Financial transaction update failed:', error);
    }
};

/**
 * Check and store idempotency key
 * @param {string} idempotencyKey - Unique key for the operation
 * @param {string} operationType - Type of operation
 * @param {number} userId - User ID
 * @param {Object} requestBody - Request body
 * @returns {Promise<Object|null>} - Existing response if duplicate, null if new
 */
const checkIdempotency = async (idempotencyKey, operationType, userId, requestBody) => {
    try {
        // Check if key exists
        const existing = await pool.query(
            'SELECT * FROM idempotency_keys WHERE idempotency_key = $1 AND user_id = $2',
            [idempotencyKey, userId]
        );

        if (existing.rows.length > 0) {
            const record = existing.rows[0];
            
            // If still processing, return conflict
            if (record.status === 'PROCESSING') {
                return { 
                    duplicate: true, 
                    status: 'PROCESSING',
                    message: 'Request is already being processed'
                };
            }

            // If completed, return cached response
            if (record.status === 'COMPLETED') {
                return {
                    duplicate: true,
                    status: 'COMPLETED',
                    response: record.response_body
                };
            }

            // If failed, allow retry
            if (record.status === 'FAILED') {
                await pool.query(
                    'DELETE FROM idempotency_keys WHERE idempotency_key = $1',
                    [idempotencyKey]
                );
            }
        }

        // Create new idempotency record
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        await pool.query(
            `INSERT INTO idempotency_keys (
                idempotency_key, operation_type, user_id, request_body, status, expires_at
            ) VALUES ($1, $2, $3, $4, 'PROCESSING', $5)`,
            [idempotencyKey, operationType, userId, JSON.stringify(requestBody), expiresAt]
        );

        return { duplicate: false };
    } catch (error) {
        console.error('❌ Idempotency check failed:', error);
        // If idempotency check fails, allow the operation to proceed
        return { duplicate: false };
    }
};

/**
 * Complete idempotency key with response
 * @param {string} idempotencyKey - Unique key for the operation
 * @param {string} status - COMPLETED or FAILED
 * @param {Object} responseBody - Response to cache
 */
const completeIdempotency = async (idempotencyKey, status, responseBody) => {
    try {
        await pool.query(
            `UPDATE idempotency_keys 
             SET status = $1, response_body = $2, completed_at = NOW()
             WHERE idempotency_key = $3`,
            [status, JSON.stringify(responseBody), idempotencyKey]
        );
    } catch (error) {
        console.error('❌ Idempotency completion failed:', error);
    }
};

/**
 * Middleware to automatically log audit entries
 * @param {string} operationType - Type of operation
 * @param {string} entityType - Type of entity
 */
const auditMiddleware = (operationType, entityType) => {
    return async (req, res, next) => {
        // Store original json method
        const originalJson = res.json.bind(res);

        // Override json method to capture response
        res.json = function(data) {
            // Log audit entry
            logAudit({
                operationType,
                entityType,
                entityId: req.params.id || req.params.userId || req.params.invoiceId || req.body.invoiceId || 'unknown',
                actorId: req.user?.id,
                actorWallet: req.user?.wallet_address,
                actorRole: req.user?.role,
                action: req.method,
                status: res.statusCode >= 200 && res.statusCode < 300 ? 'SUCCESS' : 'FAILED',
                newValues: data,
                metadata: {
                    endpoint: req.originalUrl,
                    method: req.method,
                    statusCode: res.statusCode
                },
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('user-agent'),
                errorMessage: data.error || null
            });

            // Call original json method
            return originalJson(data);
        };

        next();
    };
};

/**
 * Middleware to handle idempotency
 * @param {string} operationType - Type of operation
 */
const idempotencyMiddleware = (operationType) => {
    return async (req, res, next) => {
        const idempotencyKey = req.headers['idempotency-key'];

        if (!idempotencyKey) {
            return res.status(400).json({ 
                error: 'Idempotency-Key header is required for this operation' 
            });
        }

        const result = await checkIdempotency(
            idempotencyKey,
            operationType,
            req.user.id,
            req.body
        );

        if (result.duplicate) {
            if (result.status === 'PROCESSING') {
                return res.status(409).json({ 
                    error: 'Request is already being processed',
                    idempotencyKey 
                });
            }

            if (result.status === 'COMPLETED') {
                return res.status(200).json(result.response);
            }
        }

        // Store idempotency key in request for later use
        req.idempotencyKey = idempotencyKey;

        // Override res.json to complete idempotency
        const originalJson = res.json.bind(res);
        res.json = function(data) {
            const status = res.statusCode >= 200 && res.statusCode < 300 ? 'COMPLETED' : 'FAILED';
            completeIdempotency(idempotencyKey, status, data);
            return originalJson(data);
        };

        next();
    };
};

module.exports = {
    logAudit,
    logFinancialTransaction,
    updateFinancialTransaction,
    checkIdempotency,
    completeIdempotency,
    auditMiddleware,
    idempotencyMiddleware
};
