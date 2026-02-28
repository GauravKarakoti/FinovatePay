const EmailService = require('../services/emailService');
const NotificationPreference = require('../models/NotificationPreference');
const EmailLog = require('../models/EmailLog');
const errorResponse = require('../utils/errorResponse');

/**
 * Send test email
 * POST /api/notifications/send-test
 */
exports.sendTestEmail = async (req, res) => {
  try {
    const { recipientEmail, templateName } = req.body;

    if (!recipientEmail || !templateName) {
      return errorResponse(res, 'recipientEmail and templateName are required', 400);
    }

    const result = await EmailService.sendFromTemplate(
      recipientEmail,
      templateName,
      {
        userName: req.user?.email || 'User',
        companyName: 'FinovatePay',
        invoiceId: 'INV-001',
        amount: '1000',
        currency: 'USD',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
      },
      req.user?.id || null
    );

    res.json({
      success: true,
      message: 'Test email sent successfully',
      data: result
    });
  } catch (error) {
    console.error('❌ Error sending test email:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Get notification preferences
 * GET /api/notifications/preferences
 */
exports.getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id;

    let preferences = await NotificationPreference.findByUserId(userId);

    // Create default preferences if not exists
    if (!preferences) {
      preferences = await NotificationPreference.create(userId);
    }

    res.json({
      success: true,
      data: preferences
    });
  } catch (error) {
    console.error('❌ Error fetching preferences:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Update notification preferences
 * PUT /api/notifications/preferences
 */
exports.updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;

    const updated = await NotificationPreference.updatePreferences(
      userId,
      preferences
    );

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      data: updated
    });
  } catch (error) {
    console.error('❌ Error updating preferences:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Get email history
 * GET /api/notifications/history
 */
exports.getEmailHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const history = await EmailService.getEmailHistory(
      userId,
      parseInt(limit),
      parseInt(offset)
    );

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('❌ Error fetching email history:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Get email statistics
 * GET /api/notifications/stats
 */
exports.getEmailStats = async (req, res) => {
  try {
    const stats = await EmailLog.getStats();
    const totalCount = await EmailLog.getTotalCount();

    res.json({
      success: true,
      data: {
        total: totalCount,
        byStatus: stats
      }
    });
  } catch (error) {
    console.error('❌ Error fetching email stats:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Unsubscribe from emails
 * POST /api/notifications/unsubscribe/:token
 */
exports.unsubscribe = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return errorResponse(res, 'Unsubscribe token is required', 400);
    }

    await NotificationPreference.unsubscribe(token);

    res.json({
      success: true,
      message: 'Unsubscribed successfully'
    });
  } catch (error) {
    console.error('❌ Error unsubscribing:', error.message);
    return errorResponse(res, error, 500);
  }
};

/**
 * Retry failed emails (Admin only)
 * POST /api/notifications/retry-failed
 */
exports.retryFailedEmails = async (req, res) => {
  try {
    const result = await EmailService.retryFailedEmails();

    res.json({
      success: true,
      message: 'Retry process completed',
      data: result
    });
  } catch (error) {
    console.error('❌ Error retrying emails:', error.message);
    return errorResponse(res, error, 500);
  }
};
