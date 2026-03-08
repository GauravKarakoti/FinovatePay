const express = require('express');
const router = express.Router();
const treasuryController = require('../controllers/treasuryController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Public balance endpoint (requires auth)
router.get('/balance', authenticateToken, requireRole(['admin','governance']), treasuryController.getBalance);

// Withdraw - governance/admin only
router.post('/withdraw', authenticateToken, requireRole(['admin','governance']), treasuryController.postWithdraw);

// Transactions and reports
router.get('/transactions', authenticateToken, requireRole(['admin','governance']), treasuryController.getTransactions);
router.get('/reports', authenticateToken, requireRole(['admin','governance']), treasuryController.getReports);

module.exports = router;
