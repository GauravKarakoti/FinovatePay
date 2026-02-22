const express = require('express');
const router = express.Router();
const disputeController = require('../controllers/disputeController');
const upload = require('../middleware/upload');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Dispute routes
router.post('/:invoiceId/raise', authenticateToken, requireRole(['buyer', 'seller', 'admin']), disputeController.raiseDispute);
router.post('/:invoiceId/evidence', authenticateToken, requireRole(['buyer', 'seller', 'admin']), upload.single('file'), disputeController.uploadEvidence);
router.get('/:invoiceId/evidence', authenticateToken, disputeController.getEvidence);
router.get('/:invoiceId/logs', authenticateToken, disputeController.getLogs);
router.post('/:invoiceId/resolve', authenticateToken, requireRole(['arbitrator', 'admin']), disputeController.resolveDispute);
router.get('/:invoiceId/status', authenticateToken, disputeController.getDisputeStatus);

module.exports = router;