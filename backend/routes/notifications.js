const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { emailTestLimiter } = require('../middleware/rateLimiter');
const {
  sendTestNotification,
  getPreferences,
  updatePreferences,
  getHistory,
  getEmailStats,
  unsubscribe,
  retryFailedEmails,
  subscribe,
  getSubscriptions,
  getVapidKey,
  unsubscribeAll
} = require('../controllers/notificationController');

// ============================================
// Push Notification Routes (Require Authentication)
// ============================================

// Get VAPID public key (needed for push subscription)
router.get('/vapid-key', getVapidKey);

// Subscribe to push notifications
router.post('/subscribe', authenticateToken, subscribe);

// Unsubscribe from push notifications
router.delete('/subscribe', authenticateToken, unsubscribe);

// Unsubscribe from all push notifications
router.post('/unsubscribe-all', authenticateToken, unsubscribeAll);

// Get user's push subscriptions
router.get('/subscriptions', authenticateToken, getSubscriptions);

// Get push notification preferences
router.get('/push-preferences', authenticateToken, getPreferences);

// Update push notification preferences
router.put('/push-preferences', authenticateToken, updatePreferences);

// Get push notification history
router.get('/push-history', authenticateToken, getHistory);

// Send test push notification
router.post('/push-test', authenticateToken, sendTestNotification);

// ============================================
// Email Notification Routes (Require Authentication)
// ============================================

// Send test email - WITH RATE LIMITING to prevent email bombing
router.post('/send-test', authenticateToken, emailTestLimiter, sendTestNotification);

// Get user's notification preferences
router.get('/preferences', authenticateToken, getPreferences);

// Update notification preferences
router.put('/preferences', authenticateToken, updatePreferences);

// Get email sending history
router.get('/history', authenticateToken, getHistory);

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
