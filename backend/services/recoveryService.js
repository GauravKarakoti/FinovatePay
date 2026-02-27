const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new transaction state
 * @param {Object} data - Transaction data
 * @returns {Promise<string>} - Correlation ID
 */
const createTransactionState = async (data) => {
    const {
        operationType,
        entityType,
        entityId,
        stepsRemaining = [],
        contextData = {},
        initiatedBy
    } = data;

    const correlationId = uuidv4();

    await pool.query(
        `INSERT INTO transaction_states (
            correlation_id, operation_type, entity_type, entity_id,
            current_state, steps_remaining, context_data, initiated_by
        ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7)`,
        [correlationId, operationType, entityType, entityId, JSON.stringify(stepsRemaining), JSON.stringify(contextData), initiatedBy]
    );

    console.log(`✅ Created transaction state: ${correlationId} (${operationType})`);
    return correlationId;
};

/**
 * Update transaction state
 * @param {string} correlationId - Correlation ID
 * @param {string} newState - New state
 * @param {Object} updates - Additional updates
 */
const updateTransactionState = async (correlationId, newState, updates = {}) => {
    const setClauses = ['current_state = $2'];
    const values = [correlationId, newState];
    let paramIndex = 3;

    if (updates.stepsCompleted) {
        setClauses.push(`steps_completed = $${paramIndex}`);
        values.push(JSON.stringify(updates.stepsCompleted));
        paramIndex++;
    }

    if (updates.stepsRemaining) {
        setClauses.push(`steps_remaining = $${paramIndex}`);
        values.push(JSON.stringify(updates.stepsRemaining));
        paramIndex++;
    }

    if (updates.contextData) {
        setClauses.push(`context_data = $${paramIndex}`);
        values.push(JSON.stringify(updates.contextData));
        paramIndex++;
    }

    if (newState === 'COMPLETED' || newState === 'FAILED' || newState === 'DLQ') {
        setClauses.push(`completed_at = NOW()`);
    }

    const query = `UPDATE transaction_states SET ${setClauses.join(', ')} WHERE correlation_id = $1`;
    await pool.query(query, values);

    console.log(`📝 Updated transaction state: ${correlationId} → ${newState}`);
};

/**
 * Add operation to recovery queue
 * @param {string} correlationId - Correlation ID
 * @param {Object} operationData - Operation data for retry
 * @param {number} retryCount - Current retry count
 * @param {string} error - Error message
 */
const addToRecoveryQueue = async (correlationId, operationData, retryCount = 0, error = null) => {
    // Calculate next retry time with exponential backoff
    const backoffMinutes = Math.min(Math.pow(2, retryCount), 60); // Max 60 minutes
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    const result = await pool.query(
        `INSERT INTO transaction_recovery_queue (
            correlation_id, operation_type, operation_data, retry_count,
            next_retry_at, last_error, status
        ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
        ON CONFLICT (correlation_id) DO UPDATE SET
            retry_count = $4,
            next_retry_at = $5,
            last_error = $6,
            status = 'PENDING',
            updated_at = NOW()
        RETURNING id`,
        [
            correlationId,
            operationData.operationType,
            JSON.stringify(operationData),
            retryCount,
            nextRetryAt,
            error
        ]
    );

    console.log(`🔄 Added to recovery queue: ${correlationId} (retry ${retryCount}, next: ${backoffMinutes}min)`);
    return result.rows[0].id;
};

/**
 * Move operation to dead letter queue
 * @param {string} correlationId - Correlation ID
 * @param {Object} operationData - Operation data
 * @param {string} failureReason - Reason for failure
 * @param {number} retryCount - Final retry count
 * @param {boolean} requiresCompensation - Whether compensation is needed
 */
const moveToDLQ = async (correlationId, operationData, failureReason, retryCount, requiresCompensation = false) => {
    await pool.query(
        `INSERT INTO dead_letter_queue (
            correlation_id, operation_type, operation_data, failure_reason,
            retry_count, last_error, requires_compensation, compensation_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
            correlationId,
            operationData.operationType,
            JSON.stringify(operationData),
            failureReason,
            retryCount,
            operationData.lastError || null,
            requiresCompensation,
            requiresCompensation ? 'PENDING' : null
        ]
    );

    // Update transaction state to DLQ
    await updateTransactionState(correlationId, 'DLQ');

    // Remove from recovery queue
    await pool.query(
        'DELETE FROM transaction_recovery_queue WHERE correlation_id = $1',
        [correlationId]
    );

    console.log(`💀 Moved to DLQ: ${correlationId} (${failureReason})`);
};

/**
 * Process recovery queue
 * @returns {Promise<number>} - Number of operations processed
 */
const processRecoveryQueue = async () => {
    const client = await pool.connect();
    
    try {
        // Get operations ready for retry
        const result = await client.query(
            `SELECT * FROM transaction_recovery_queue
             WHERE status = 'PENDING'
             AND next_retry_at <= NOW()
             ORDER BY next_retry_at ASC
             LIMIT 10`
        );

        const operations = result.rows;
        console.log(`🔄 Processing ${operations.length} operations from recovery queue`);

        for (const op of operations) {
            try {
                // Mark as processing
                await client.query(
                    'UPDATE transaction_recovery_queue SET status = $1 WHERE id = $2',
                    ['PROCESSING', op.id]
                );

                // Update transaction state
                await updateTransactionState(op.correlation_id, 'PROCESSING');

                // Execute the operation based on type
                const operationData = op.operation_data;
                const success = await executeOperation(operationData);

                if (success) {
                    // Mark as completed
                    await client.query(
                        'UPDATE transaction_recovery_queue SET status = $1 WHERE id = $2',
                        ['COMPLETED', op.id]
                    );
                    await updateTransactionState(op.correlation_id, 'COMPLETED');
                    
                    // Remove from queue
                    await client.query(
                        'DELETE FROM transaction_recovery_queue WHERE id = $1',
                        [op.id]
                    );

                    console.log(`✅ Recovered: ${op.correlation_id}`);
                } else {
                    throw new Error('Operation execution failed');
                }
            } catch (error) {
                console.error(`❌ Recovery failed for ${op.correlation_id}:`, error.message);

                const newRetryCount = op.retry_count + 1;

                if (newRetryCount >= op.max_retries) {
                    // Move to DLQ
                    await moveToDLQ(
                        op.correlation_id,
                        op.operation_data,
                        `Max retries (${op.max_retries}) exceeded`,
                        newRetryCount,
                        shouldCompensate(op.operation_data)
                    );
                } else {
                    // Re-queue with incremented retry count
                    await addToRecoveryQueue(
                        op.correlation_id,
                        op.operation_data,
                        newRetryCount,
                        error.message
                    );
                }
            }
        }

        return operations.length;
    } finally {
        client.release();
    }
};

/**
 * Execute operation based on type
 * @param {Object} operationData - Operation data
 * @returns {Promise<boolean>} - Success status
 */
const executeOperation = async (operationData) => {
    const { operationType, ...data } = operationData;

    switch (operationType) {
        case 'FINANCING_PIPELINE':
            return await retryFinancingPipeline(data);
        case 'ESCROW_RELEASE':
            return await retryEscrowRelease(data);
        case 'EVENT_PROCESSING':
            return await retryEventProcessing(data);
        default:
            console.warn(`Unknown operation type: ${operationType}`);
            return false;
    }
};

/**
 * Retry financing pipeline
 */
const retryFinancingPipeline = async (data) => {
    // Import here to avoid circular dependency
    const financingService = require('./financingService');
    
    try {
        await financingService.financeInvoice(
            data.invoiceHash,
            data.tokenId,
            data.sellerAddress,
            data.amount
        );
        return true;
    } catch (error) {
        console.error('Financing retry failed:', error);
        return false;
    }
};

/**
 * Retry escrow release
 */
const retryEscrowRelease = async (data) => {
    try {
        // Update database to match blockchain state
        await pool.query(
            'UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3',
            ['released', data.txHash, data.invoiceId]
        );
        return true;
    } catch (error) {
        console.error('Escrow release retry failed:', error);
        return false;
    }
};

/**
 * Retry event processing
 */
const retryEventProcessing = async (data) => {
    const contractListener = require('../listeners/contractListener');
    
    try {
        // Re-process the event
        await contractListener.processTokenizedEvent(
            data.invoiceHash,
            data.tokenId,
            data.totalSupply,
            data.faceValue,
            data.blockNumber
        );
        return true;
    } catch (error) {
        console.error('Event processing retry failed:', error);
        return false;
    }
};

/**
 * Determine if operation requires compensation
 */
const shouldCompensate = (operationData) => {
    const { operationType, stepsCompleted = [] } = operationData;

    // If blockchain transaction succeeded but DB failed, needs compensation
    if (operationType === 'ESCROW_RELEASE' && stepsCompleted.includes('BLOCKCHAIN_TX')) {
        return true;
    }

    if (operationType === 'FINANCING_PIPELINE' && stepsCompleted.includes('KATANA_LIQUIDITY')) {
        return true;
    }

    return false;
};

/**
 * Record system health metric
 */
const recordMetric = async (metricType, metricName, metricValue, metadata = {}) => {
    await pool.query(
        `INSERT INTO system_health_metrics (metric_type, metric_name, metric_value, metadata)
         VALUES ($1, $2, $3, $4)`,
        [metricType, metricName, metricValue, JSON.stringify(metadata)]
    );
};

/**
 * Get stuck transactions
 */
const getStuckTransactions = async () => {
    const result = await pool.query('SELECT * FROM get_stuck_transactions()');
    return result.rows;
};

/**
 * Get DLQ statistics
 */
const getDLQStats = async () => {
    const result = await pool.query('SELECT * FROM get_dlq_stats()');
    return result.rows;
};

/**
 * Start recovery worker
 */
const startRecoveryWorker = () => {
    console.log('🚀 Starting Transaction Recovery Worker...');
    
    // Process recovery queue every 30 seconds
    setInterval(async () => {
        try {
            const processed = await processRecoveryQueue();
            
            if (processed > 0) {
                await recordMetric('RETRY_COUNT', 'recovery_queue_processed', processed);
            }
        } catch (error) {
            console.error('Recovery worker error:', error);
        }
    }, 30000);

    // Check for stuck transactions every 5 minutes
    setInterval(async () => {
        try {
            const stuck = await getStuckTransactions();
            
            if (stuck.length > 0) {
                console.warn(`⚠️ Found ${stuck.length} stuck transactions`);
                await recordMetric('STUCK_TRANSACTIONS', 'count', stuck.length);
            }
        } catch (error) {
            console.error('Stuck transaction check error:', error);
        }
    }, 300000);

    // Record DLQ stats every 10 minutes
    setInterval(async () => {
        try {
            const stats = await getDLQStats();
            const totalDLQ = stats.reduce((sum, s) => sum + parseInt(s.count), 0);
            
            await recordMetric('DLQ_SIZE', 'total', totalDLQ);
        } catch (error) {
            console.error('DLQ stats error:', error);
        }
    }, 600000);
};

module.exports = {
    createTransactionState,
    updateTransactionState,
    addToRecoveryQueue,
    moveToDLQ,
    processRecoveryQueue,
    recordMetric,
    getStuckTransactions,
    getDLQStats,
    startRecoveryWorker
};
