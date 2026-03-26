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

const idempotencyMiddleware = (action) => {
    return async (req, res, next) => {
        const idempotencyKey = req.headers['x-idempotency-key'];

        // 1. Ensure the header exists (optional: remove this check if you want it to be optional)
        if (!idempotencyKey) {
            return res.status(400).json({ 
                error: 'Idempotency key is required. Please provide the x-idempotency-key header.' 
            });
        }

        // Use the authenticated user's ID to prevent cross-user key collisions
        const userId = req.user?.id || 'anonymous';

        try {
            // 2. Check if this request has already been processed or is processing
            const checkQuery = `
                SELECT status, response_code, response_body 
                FROM idempotency_keys 
                WHERE idempotency_key = $1 AND user_id = $2 AND action = $3
            `;
            const { rows } = await pool.query(checkQuery, [idempotencyKey, userId, action]);

            if (rows.length > 0) {
                const record = rows[0];
                
                // If another request with this key is currently hitting the route
                if (record.status === 'IN_PROGRESS') {
                    return res.status(409).json({ 
                        error: 'A request with this idempotency key is already in progress.' 
                    });
                }
                
                // If it already finished, return the exact same response as last time
                if (record.status === 'COMPLETED') {
                    return res.status(record.response_code).json(record.response_body);
                }
            }

            // 3. Mark the key as IN_PROGRESS in the database
            const insertQuery = `
                INSERT INTO idempotency_keys (idempotency_key, user_id, action, request_path, status)
                VALUES ($1, $2, $3, $4, 'IN_PROGRESS')
            `;
            await pool.query(insertQuery, [idempotencyKey, userId, action, req.originalUrl]);

            // 4. Intercept the standard res.json to capture the final output
            const originalJson = res.json;
            res.json = function (body) {
                const statusCode = res.statusCode;

                // Only cache successful or acceptable error responses (e.g., don't cache 500 server crashes)
                if (statusCode >= 200 && statusCode < 500) {
                    pool.query(`
                        UPDATE idempotency_keys 
                        SET status = 'COMPLETED', 
                            response_code = $1, 
                            response_body = $2, 
                            completed_at = NOW()
                        WHERE idempotency_key = $3 AND user_id = $4
                    `, [statusCode, JSON.stringify(body), idempotencyKey, userId])
                    .catch(err => {
                        logger.error('Failed to update idempotency key cache:', err);
                    });
                } else {
                    // If it was a 500 error, delete the key so the user can try again safely
                    pool.query(`DELETE FROM idempotency_keys WHERE idempotency_key = $1`, [idempotencyKey])
                    .catch(e => logger.error('Failed to clear failed idempotency key:', e));
                }

                // Call the original Express res.json method to actually send the data to the user
                return originalJson.call(this, body);
            };

            next(); // Proceed to your actual route logic
            
        } catch (error) {
            // Handle race condition: If two requests hit this exact block simultaneously, 
            // the DB's unique constraint on (idempotency_key, user_id) will throw a 23505 duplicate error.
            if (error.code === '23505') {
                return res.status(409).json({ error: 'A request with this idempotency key is already in progress.' });
            }

            logger.error('Idempotency middleware error:', error);
            return res.status(500).json({ error: 'Internal server error while verifying request uniqueness.' });
        }
    };
};

module.exports = {
    logAudit,
    idempotencyMiddleware
};