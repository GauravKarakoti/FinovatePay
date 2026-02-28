const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const healthCheckService = require('../services/healthCheckService');
const recoveryService = require('../services/recoveryService');

// Public health check endpoint
router.get('/', async (req, res) => {
    try {
        const health = await healthCheckService.getSystemHealth();
        const statusCode = health.status === 'healthy' ? 200 : (health.status === 'degraded' ? 200 : 503);
        res.status(statusCode).json(health);
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Detailed health check (admin only)
router.get('/detailed', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const [health, metrics, stuckTransactions, dlqStats] = await Promise.all([
            healthCheckService.getSystemHealth(),
            healthCheckService.getSystemMetrics(),
            recoveryService.getStuckTransactions(),
            recoveryService.getDLQStats()
        ]);

        res.json({
            health,
            metrics,
            stuckTransactions,
            dlqStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get recovery queue status (admin only)
router.get('/recovery-queue', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const queueCheck = await healthCheckService.checkRecoveryQueue();
        res.json(queueCheck);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get dead letter queue (admin only)
router.get('/dlq', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const dlqCheck = await healthCheckService.checkDLQ();
        const dlqStats = await recoveryService.getDLQStats();
        
        res.json({
            ...dlqCheck,
            stats: dlqStats
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Trigger manual recovery (admin only)
router.post('/recovery/trigger', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const processed = await recoveryService.processRecoveryQueue();
        res.json({
            success: true,
            processed,
            message: `Processed ${processed} operations from recovery queue`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
