const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  sendTestEmail,
  getNotificationPreferences,
  updateNotificationPreferences,
  getEmailHistory,
  getEmailStats,
  unsubscribe,
  retryFailedEmails
} = require('../controllers/notificationController');

// ============================================
// Protected Routes (Require Authentication)
// ============================================

// Send test email
router.post('/send-test', authenticateToken, sendTestEmail);

// Get user's notification preferences
router.get('/preferences', authenticateToken, getNotificationPreferences);

// Update notification preferences
router.put('/preferences', authenticateToken, updateNotificationPreferences);

// Get email sending history
router.get('/history', authenticateToken, getEmailHistory);

// Get email statistics
router.get('/stats', authenticateToken, getEmailStats);

// Retry failed emails (admin)
router.post('/retry-failed', authenticateToken, retryFailedEmails);

// ============================================
// Public Routes (No Authentication)
// ============================================

// Unsubscribe from emails
router.post('/unsubscribe/:token', unsubscribe);

module.exports = router;
