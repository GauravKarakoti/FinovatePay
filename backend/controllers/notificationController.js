const notificationService = require('../services/notificationService');
const { pool } = require('../config/database');

const getEmailStats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Assuming you have this method in your notificationService
    // Alternatively, you could use a direct pool.query here like in getHistory
    const stats = await notificationService.getEmailStats(userId);

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('[NotificationController] Get email stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get email statistics'
    });
  }
};

/**
 * Retry failed email notifications
 * POST /api/notifications/retry-emails
 */
const retryFailedEmails = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Call the service to retry failed emails for this user
    const result = await notificationService.retryFailedEmails(userId);

    res.json({
      success: true,
      message: 'Successfully triggered retry for failed emails',
      retriedCount: result.count || 0
    });
  } catch (error) {
    console.error('[NotificationController] Retry failed emails error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retry failed emails'
    });
  }
};

/**
 * Subscribe to push notifications
 * POST /api/notifications/subscribe
 */
const subscribe = async (req, res) => {
  try {
    const { subscription } = req.body;
    const userAgent = req.get('user-agent');
    
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        success: false,
        message: 'Invalid subscription object'
      });
    }

    const userId = req.user.id;
    const result = await notificationService.subscribeUser(userId, subscription, userAgent);

    res.json({
      success: true,
      message: 'Successfully subscribed to push notifications',
      subscriptionId: result.subscriptionId
    });
  } catch (error) {
    console.error('[NotificationController] Subscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to push notifications'
    });
  }
};

/**
 * Unsubscribe from push notifications
 * DELETE /api/notifications/subscribe
 */
const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: 'Endpoint is required'
      });
    }

    const userId = req.user.id;
    await notificationService.unsubscribeUser(userId, endpoint);

    res.json({
      success: true,
      message: 'Successfully unsubscribed from push notifications'
    });
  } catch (error) {
    console.error('[NotificationController] Unsubscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe from push notifications'
    });
  }
};

/**
 * Get user's push notification subscriptions
 * GET /api/notifications/subscriptions
 */
const getSubscriptions = async (req, res) => {
  try {
    const userId = req.user.id;
    const subscriptions = await notificationService.getUserSubscriptions(userId);

    // Return sanitized subscription data
    const sanitized = subscriptions.map(sub => ({
      id: sub.id,
      endpoint: sub.endpoint,
      browser: sub.browser,
      isActive: sub.is_active,
      createdAt: sub.created_at
    }));

    res.json({
      success: true,
      subscriptions: sanitized
    });
  } catch (error) {
    console.error('[NotificationController] Get subscriptions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscriptions'
    });
  }
};

/**
 * Get push notification VAPID public key
 * GET /api/notifications/vapid-key
 */
const getVapidKey = async (req, res) => {
  try {
    const publicKey = notificationService.getVapidPublicKey();
    
    res.json({
      success: true,
      publicKey
    });
  } catch (error) {
    console.error('[NotificationController] Get VAPID key error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get VAPID key'
    });
  }
};

/**
 * Get notification preferences
 * GET /api/notifications/preferences
 */
const getPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = await notificationService.getUserPreferences(userId);

    res.json({
      success: true,
      preferences
    });
  } catch (error) {
    console.error('[NotificationController] Get preferences error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification preferences'
    });
  }
};

/**
 * Update notification preferences
 * PUT /api/notifications/preferences
 */
const updatePreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;
    
    const updated = await notificationService.updateUserPreferences(userId, preferences);

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: updated
    });
  } catch (error) {
    console.error('[NotificationController] Update preferences error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update notification preferences'
    });
  }
};

/**
 * Get notification history
 * GET /api/notifications/history
 */
const getHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0, type, status } = req.query;

    let query = `
      SELECT * FROM push_notification_history 
      WHERE user_id = $1
    `;
    const params = [userId];
    let paramCount = 1;

    if (type) {
      paramCount++;
      query += ` AND notification_type = $${paramCount}`;
      params.push(type);
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY sent_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      history: result.rows
    });
  } catch (error) {
    console.error('[NotificationController] Get history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get notification history'
    });
  }
};

/**
 * Unsubscribe all devices
 * POST /api/notifications/unsubscribe-all
 */
const unsubscribeAll = async (req, res) => {
  try {
    const userId = req.user.id;
    await notificationService.unsubscribeAllUser(userId);

    res.json({
      success: true,
      message: 'Successfully unsubscribed from all push notifications'
    });
  } catch (error) {
    console.error('[NotificationController] Unsubscribe all error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe from all push notifications'
    });
  }
};

/**
 * Send test notification
 * POST /api/notifications/test
 */
const sendTestNotification = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await notificationService.sendNotification(userId, 'test', {
      title: 'Test Notification',
      body: 'This is a test notification from FinovatePay!'
    });

    if (result.success) {
      res.json({
        success: true,
        message: 'Test notification sent successfully'
      });
    } else if (result.reason === 'no_subscriptions') {
      res.status(400).json({
        success: false,
        message: 'No active push subscriptions found. Please subscribe first.'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send test notification'
      });
    }
  } catch (error) {
    console.error('[NotificationController] Send test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notification'
    });
  }
};

module.exports = {
  subscribe,
  unsubscribe,
  getSubscriptions,
  getVapidKey,
  getPreferences,
  updatePreferences,
  getHistory,
  unsubscribeAll,
  sendTestNotification,
  getEmailStats,
  retryFailedEmails
};
