const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const fraudDetectionService = require('../services/fraudDetectionService');

router.use(authenticateToken);

router.post('/analyze', async (req, res) => {
  try {
    const {
      userId,
      walletAddress,
      invoiceId,
      transactionType,
      amount,
      currency,
      context
    } = req.body || {};

    if (!transactionType) {
      return res.status(400).json({ success: false, error: 'transactionType is required' });
    }

    if (!req.user || (req.user.role !== 'admin' && userId && userId !== req.user.id)) {
      return res.status(403).json({ success: false, error: 'Not authorized to analyze this user context' });
    }

    const result = await fraudDetectionService.evaluateTransactionRisk({
      userId: userId || req.user.id,
      walletAddress: walletAddress || req.user.wallet_address,
      invoiceId,
      transactionType,
      amount,
      currency,
      context: {
        ...(context || {}),
        kycStatus: req.user.kyc_status || context?.kycStatus || 'unknown',
        actorRole: req.user.role
      }
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[FraudDetectionRoute] Analyze failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to analyze transaction risk',
      details: error.details
    });
  }
});

router.get('/alerts', requireRole(['admin']), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const status = req.query.status || undefined;
    const severity = req.query.severity || undefined;

    const alerts = await fraudDetectionService.listAlerts({
      status,
      severity,
      limit,
      offset
    });

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('[FraudDetectionRoute] List alerts failed:', error);
    res.status(500).json({ success: false, error: 'Failed to list fraud alerts' });
  }
});

router.get('/summary', requireRole(['admin']), async (req, res) => {
  try {
    const summary = await fraudDetectionService.getDashboardSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[FraudDetectionRoute] Summary failed:', error);
    res.status(500).json({ success: false, error: 'Failed to get fraud summary' });
  }
});

router.patch('/alerts/:id/status', requireRole(['admin']), async (req, res) => {
  try {
    const alertId = parseInt(req.params.id, 10);
    if (!Number.isInteger(alertId) || alertId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid alert id' });
    }

    const { status, resolutionNote } = req.body || {};
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }

    const updated = await fraudDetectionService.updateAlertStatus({
      alertId,
      status,
      resolvedBy: req.user.id,
      resolutionNote
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[FraudDetectionRoute] Update alert failed:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Failed to update alert status'
    });
  }
});

module.exports = router;
