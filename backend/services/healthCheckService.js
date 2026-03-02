const { pool } = require('../config/database');
const { getProvider } = require('../config/blockchain');

/**
 * Check database health
 */
const checkDatabase = async () => {
    try {
        const result = await pool.query('SELECT NOW()');
        return {
            status: 'healthy',
            latency: Date.now() - new Date(result.rows[0].now).getTime(),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

/**
 * Check blockchain connection
 */
const checkBlockchain = async () => {
    try {
        const provider = getProvider();
        const blockNumber = await provider.getBlockNumber();
        
        return {
            status: 'healthy',
            blockNumber,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

/**
 * Check recovery queue health
 */
const checkRecoveryQueue = async () => {
    try {
        const result = await pool.query(
            `SELECT 
                COUNT(*) FILTER (WHERE status = 'PENDING') as pending_count,
                COUNT(*) FILTER (WHERE status = 'PROCESSING') as processing_count,
                COUNT(*) FILTER (WHERE retry_count >= max_retries - 1) as near_dlq_count
             FROM transaction_recovery_queue`
        );

        const stats = result.rows[0];
        const isHealthy = parseInt(stats.near_dlq_count) < 10;

        return {
            status: isHealthy ? 'healthy' : 'degraded',
            pending: parseInt(stats.pending_count),
            processing: parseInt(stats.processing_count),
            nearDLQ: parseInt(stats.near_dlq_count),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

/**
 * Check dead letter queue size
 */
const checkDLQ = async () => {
    try {
        const result = await pool.query(
            `SELECT 
                COUNT(*) as total_count,
                COUNT(*) FILTER (WHERE requires_compensation = TRUE AND compensation_status = 'PENDING') as needs_compensation
             FROM dead_letter_queue
             WHERE resolved_at IS NULL`
        );

        const stats = result.rows[0];
        const totalCount = parseInt(stats.total_count);
        const isHealthy = totalCount < 50;

        return {
            status: isHealthy ? 'healthy' : 'degraded',
            total: totalCount,
            needsCompensation: parseInt(stats.needs_compensation),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

/**
 * Check for stuck transactions
 */
const checkStuckTransactions = async () => {
    try {
        const result = await pool.query('SELECT * FROM get_stuck_transactions()');
        const stuckCount = result.rows.length;
        const isHealthy = stuckCount === 0;

        return {
            status: isHealthy ? 'healthy' : 'degraded',
            count: stuckCount,
            transactions: result.rows.slice(0, 5), // Return first 5
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

/**
 * Get overall system health
 */
const getSystemHealth = async () => {
    const [database, blockchain, recoveryQueue, dlq, stuckTransactions] = await Promise.all([
        checkDatabase(),
        checkBlockchain(),
        checkRecoveryQueue(),
        checkDLQ(),
        checkStuckTransactions()
    ]);

    const allHealthy = [database, blockchain, recoveryQueue, dlq, stuckTransactions]
        .every(check => check.status === 'healthy');

    const anyDegraded = [database, blockchain, recoveryQueue, dlq, stuckTransactions]
        .some(check => check.status === 'degraded');

    return {
        status: allHealthy ? 'healthy' : (anyDegraded ? 'degraded' : 'unhealthy'),
        checks: {
            database,
            blockchain,
            recoveryQueue,
            dlq,
            stuckTransactions
        },
        timestamp: new Date().toISOString()
    };
};

/**
 * Get system metrics
 */
const getSystemMetrics = async () => {
    try {
        const result = await pool.query(
            `SELECT 
                metric_type,
                metric_name,
                AVG(metric_value) as avg_value,
                MAX(metric_value) as max_value,
                MIN(metric_value) as min_value,
                COUNT(*) as sample_count
             FROM system_health_metrics
             WHERE recorded_at > NOW() - INTERVAL '1 hour'
             GROUP BY metric_type, metric_name
             ORDER BY metric_type, metric_name`
        );

        return {
            metrics: result.rows,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};

module.exports = {
    checkDatabase,
    checkBlockchain,
    checkRecoveryQueue,
    checkDLQ,
    checkStuckTransactions,
    getSystemHealth,
    getSystemMetrics
};
