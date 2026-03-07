const express = require('express');
const router = express.Router();
const AuditService = require('../services/auditService');
const { protect, authorize } = require('../middleware/auth');

/**
 * @route   GET /api/audit/logs
 * @desc    Get audit logs (Admin only)
 * @access  Private/Admin
 */
router.get('/logs', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      operationType,
      entityType,
      entityId,
      actorId,
      status,
      startDate,
      endDate,
      limit = 100,
      offset = 0,
    } = req.query;

    const filters = {
      operationType,
      entityType,
      entityId,
      actorId,
      status,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    const logs = await AuditService.getAuditLogs(filters);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/audit/entity/:entityType/:entityId
 * @desc    Get audit trail for a specific entity
 * @access  Private
 */
router.get('/entity/:entityType/:entityId', protect, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;

    const logs = await AuditService.getEntityAuditTrail(entityType, entityId);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching entity audit trail:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/audit/user/:userId
 * @desc    Get actions performed by a specific user
 * @access  Private/Admin
 */
router.get('/user/:userId', protect, authorize('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 100 } = req.query;

    const logs = await AuditService.getUserAuditTrail(userId, parseInt(limit));
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching user audit trail:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * @route   GET /api/audit/compliance-report
 * @desc    Generate compliance report for a date range
 * @access  Private/Admin
 */
router.get('/compliance-report', protect, authorize('admin'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required',
      });
    }

    const report = await AuditService.generateComplianceReport(
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ success: true, data: report });
  } catch (error) {
    console.error('Error generating compliance report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
