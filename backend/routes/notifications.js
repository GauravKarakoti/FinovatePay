const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { emailTestLimiter, pushTestLimiter } = require('../middleware/rateLimiter');
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

// Send test email - WITH RATE LIMITING to prevent email bombing
router.post('/send-test', authenticateToken, emailTestLimiter, sendTestEmail);

// Get user's notification preferences
router.get('/preferences', authenticateToken, getNotificationPreferences);

// Update notification preferences
router.put('/preferences', authenticateToken, updateNotificationPreferences);

// Get email sending history
router.get('/history', authenticateToken, getEmailHistory);

// Get email statistics
router.get('/stats', authenticateToken, getEmailStats);

// Retry failed emails (admin) - WITH RATE LIMITING to prevent abuse
router.post('/retry-failed', authenticateToken, emailTestLimiter, retryFailedEmails);

// ============================================
// Public Routes (No Authentication)
// ============================================

// Unsubscribe from emails
router.post('/unsubscribe/:token', unsubscribe);

module.exports = router;
