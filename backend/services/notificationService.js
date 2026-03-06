const webpush = require('web-push');
const { pool } = require('../config/database');

// VAPID keys - should be generated once and stored in environment variables
// Generate using: webpush.generateVAPIDKeys()
const vapidKeys = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'UUxI4O8-FbRouAf7-7OTt9GH4o-5VnPVLXtZdCKJws',
  subject: process.env.VAPID_SUBJECT || 'mailto:admin@finovatepay.com'
};

// Configure web-push
webpush.setVapidDetails(
  vapidKeys.subject,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Notification types
const NOTIFICATION_TYPES = {
  ESCROW_CREATED: 'escrow_created',
  ESCROW_FUNDED: 'escrow_funded',
  ESCROW_RELEASED: 'escrow_released',
  DISPUTE_RAISED: 'dispute_raised',
  DISPUTE_RESOLVED: 'dispute_resolved',
  AUCTION_OUTBID: 'auction_outbid',
  AUCTION_ENDING: 'auction_ending',
  PAYMENT_RECEIVED: 'payment_received',
  KYC_STATUS: 'kyc_status'
};

// Notification messages
const NOTIFICATION_MESSAGES = {
  [NOTIFICATION_TYPES.ESCROW_CREATED]: {
    title: 'Escrow Created',
    body: 'A new escrow has been created for your invoice.'
  },
  [NOTIFICATION_TYPES.ESCROW_FUNDED]: {
    title: 'Funds Deposited',
    body: 'Funds have been deposited into escrow.'
  },
  [NOTIFICATION_TYPES.ESCROW_RELEASED]: {
    title: 'Escrow Released',
    body: 'Funds have been released from escrow.'
  },
  [NOTIFICATION_TYPES.DISPUTE_RAISED]: {
    title: 'Dispute Raised',
    body: 'A dispute has been raised on an invoice.'
  },
  [NOTIFICATION_TYPES.DISPUTE_RESOLVED]: {
    title: 'Dispute Resolved',
    body: 'A dispute has been resolved.'
  },
  [NOTIFICATION_TYPES.AUCTION_OUTBID]: {
    title: 'Outbid!',
    body: 'You have been outbid on an auction.'
  },
  [NOTIFICATION_TYPES.AUCTION_ENDING]: {
    title: 'Auction Ending Soon',
    body: 'An auction you bid on is ending soon.'
  },
  [NOTIFICATION_TYPES.PAYMENT_RECEIVED]: {
    title: 'Payment Received',
    body: 'A payment has been received.'
  },
  [NOTIFICATION_TYPES.KYC_STATUS]: {
    title: 'KYC Status Update',
    body: 'Your KYC verification status has been updated.'
  }
};

/**
 * Get VAPID public key for client
 */
const getVapidPublicKey = () => {
  return vapidKeys.publicKey;
};

/**
 * Subscribe a user to push notifications
 */
const subscribeUser = async (userId, subscription, userAgent = '') => {
  const client = await pool.connect();
  
  try {
    const { endpoint, keys } = subscription;
    const { p256dh, auth } = keys;

    // Detect browser from user agent
    const browser = detectBrowser(userAgent);

    // Check if subscription already exists
    const existingSub = await client.query(
      'SELECT id FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [userId, endpoint]
    );

    let subscriptionId;
    
    if (existingSub.rows.length > 0) {
      // Update existing subscription
      await client.query(
        `UPDATE push_subscriptions 
         SET subscription_object = $1, p256dh = $2, auth = $3, user_agent = $4, browser = $5, is_active = TRUE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $6 AND endpoint = $7`,
        [JSON.stringify(subscription), p256dh, auth, userAgent, browser, userId, endpoint]
      );
      subscriptionId = existingSub.rows[0].id;
    } else {
      // Insert new subscription
      const result = await client.query(
        `INSERT INTO push_subscriptions (user_id, subscription_object, endpoint, p256dh, auth, user_agent, browser)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [userId, JSON.stringify(subscription), endpoint, p256dh, auth, userAgent, browser]
      );
      subscriptionId = result.rows[0].id;
    }

    // Create default notification preferences if not exist
    await client.query(
      `INSERT INTO push_notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    return { success: true, subscriptionId };
  } catch (error) {
    console.error('[NotificationService] Error subscribing user:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unsubscribe a user from push notifications
 */
const unsubscribeUser = async (userId, endpoint) => {
  const client = await pool.connect();
  
  try {
    await client.query(
      'UPDATE push_subscriptions SET is_active = FALSE WHERE user_id = $1 AND endpoint = $2',
      [userId, endpoint]
    );

    return { success: true };
  } catch (error) {
    console.error('[NotificationService] Error unsubscribing user:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unsubscribe all subscriptions for a user
 */
const unsubscribeAllUser = async (userId) => {
  const client = await pool.connect();
  
  try {
    await client.query(
      'UPDATE push_subscriptions SET is_active = FALSE WHERE user_id = $1',
      [userId]
    );

    return { success: true };
  } catch (error) {
    console.error('[NotificationService] Error unsubscribing all user subscriptions:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get all active subscriptions for a user
 */
const getUserSubscriptions = async (userId) => {
  const result = await pool.query(
    'SELECT * FROM push_subscriptions WHERE user_id = $1 AND is_active = TRUE',
    [userId]
  );
  return result.rows;
};

/**
 * Get user notification preferences
 */
const getUserPreferences = async (userId) => {
  const result = await pool.query(
    'SELECT * FROM push_notification_preferences WHERE user_id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    // Create default preferences
    const defaultPrefs = {
      user_id: userId,
      escrow_created: true,
      escrow_funded: true,
      escrow_released: true,
      dispute_raised: true,
      dispute_resolved: true,
      auction_outbid: true,
      auction_ending: true,
      payment_received: true,
      kyc_status: true,
      enabled: true
    };
    
    await pool.query(
      'INSERT INTO push_notification_preferences (user_id) VALUES ($1)',
      [userId]
    );
    
    return defaultPrefs;
  }
  
  return result.rows[0];
};

/**
 * Update user notification preferences
 */
const updateUserPreferences = async (userId, preferences) => {
  const allowedFields = [
    'escrow_created', 'escrow_funded', 'escrow_released',
    'dispute_raised', 'dispute_resolved', 'auction_outbid',
    'auction_ending', 'payment_received', 'kyc_status', 'enabled'
  ];
  
  const updates = [];
  const values = [];
  let paramCount = 1;
  
  for (const [key, value] of Object.entries(preferences)) {
    if (allowedFields.includes(key)) {
      updates.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  }
  
  if (updates.length === 0) {
    throw new Error('No valid fields to update');
  }
  
  values.push(userId);
  
  const result = await pool.query(
    `UPDATE push_notification_preferences 
     SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $${paramCount}
     RETURNING *`,
    values
  );
  
  return result.rows[0];
};

/**
 * Check if user should receive notification type
 */
const shouldSendNotification = async (userId, notificationType) => {
  const prefs = await getUserPreferences(userId);
  
  if (!prefs.enabled) {
    return false;
  }
  
  // Map notification type to preference field
  const typeToPref = {
    [NOTIFICATION_TYPES.ESCROW_CREATED]: 'escrow_created',
    [NOTIFICATION_TYPES.ESCROW_FUNDED]: 'escrow_funded',
    [NOTIFICATION_TYPES.ESCROW_RELEASED]: 'escrow_released',
    [NOTIFICATION_TYPES.DISPUTE_RAISED]: 'dispute_raised',
    [NOTIFICATION_TYPES.DISPUTE_RESOLVED]: 'dispute_resolved',
    [NOTIFICATION_TYPES.AUCTION_OUTBID]: 'auction_outbid',
    [NOTIFICATION_TYPES.AUCTION_ENDING]: 'auction_ending',
    [NOTIFICATION_TYPES.PAYMENT_RECEIVED]: 'payment_received',
    [NOTIFICATION_TYPES.KYC_STATUS]: 'kyc_status'
  };
  
  const prefField = typeToPref[notificationType];
  return prefField ? prefs[prefField] : true;
};

/**
 * Send push notification to a user
 */
const sendNotification = async (userId, notificationType, data = {}) => {
  // Check user preferences
  const shouldSend = await shouldSendNotification(userId, notificationType);
  if (!shouldSend) {
    console.log(`[NotificationService] Notification ${notificationType} disabled for user ${userId}`);
    return { success: false, reason: 'disabled' };
  }

  const subscriptions = await getUserSubscriptions(userId);
  
  if (subscriptions.length === 0) {
    console.log(`[NotificationService] No active subscriptions for user ${userId}`);
    return { success: false, reason: 'no_subscriptions' };
  }

  const message = NOTIFICATION_MESSAGES[notificationType];
  if (!message) {
    console.error(`[NotificationService] Unknown notification type: ${notificationType}`);
    return { success: false, reason: 'unknown_type' };
  }

  // Customize message with data
  const payload = JSON.stringify({
    title: data.title || message.title,
    body: data.body || message.body,
    icon: '/icon.png',
    badge: '/badge.png',
    tag: notificationType,
    data: {
      type: notificationType,
      ...data
    },
    actions: getActionsForType(notificationType)
  });

  let successCount = 0;
  let failCount = 0;

  for (const subscription of subscriptions) {
    try {
      const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth
        }
      };

      await webpush.sendNotification(pushSubscription, payload);
      
      // Log successful send
      await logNotification(userId, subscription.id, notificationType, message.title, message.body, data, 'sent');
      successCount++;
    } catch (error) {
      console.error(`[NotificationService] Error sending notification:`, error.message);
      
      // If subscription is no longer valid, deactivate it
      if (error.statusCode === 410 || error.statusCode === 404) {
        await deactivateSubscription(subscription.id);
      }
      
      // Log failed send
      await logNotification(userId, subscription.id, notificationType, message.title, message.body, data, 'failed', error.message);
      failCount++;
    }
  }

  return {
    success: successCount > 0,
    successCount,
    failCount
  };
};

/**
 * Send notification to multiple users
 */
const sendNotificationToMultiple = async (userIds, notificationType, data = {}) => {
  const results = [];
  
  for (const userId of userIds) {
    const result = await sendNotification(userId, notificationType, data);
    results.push({ userId, ...result });
  }
  
  return results;
};

/**
 * Log notification to history
 */
const logNotification = async (userId, subscriptionId, type, title, message, data, status, errorMessage = null) => {
  try {
    await pool.query(
      `INSERT INTO push_notification_history 
       (user_id, subscription_id, notification_type, title, message, data, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, subscriptionId, type, title, message, JSON.stringify(data), status, errorMessage]
    );
  } catch (error) {
    console.error('[NotificationService] Error logging notification:', error);
  }
};

/**
 * Deactivate a subscription
 */
const deactivateSubscription = async (subscriptionId) => {
  await pool.query(
    'UPDATE push_subscriptions SET is_active = FALSE WHERE id = $1',
    [subscriptionId]
  );
};

/**
 * Detect browser from user agent
 */
const detectBrowser = (userAgent) => {
  if (!userAgent) return 'unknown';
  
  if (userAgent.includes('Chrome')) return 'chrome';
  if (userAgent.includes('Firefox')) return 'firefox';
  if (userAgent.includes('Safari')) return 'safari';
  if (userAgent.includes('Edge')) return 'edge';
  if (userAgent.includes('Opera')) return 'opera';
  
  return 'unknown';
};

/**
 * Get action buttons for notification type
 */
const getActionsForType = (type) => {
  switch (type) {
    case NOTIFICATION_TYPES.ESCROW_CREATED:
    case NOTIFICATION_TYPES.ESCROW_FUNDED:
    case NOTIFICATION_TYPES.ESCROW_RELEASED:
      return [
        { action: 'view', title: 'View Details' }
      ];
    case NOTIFICATION_TYPES.DISPUTE_RAISED:
    case NOTIFICATION_TYPES.DISPUTE_RESOLVED:
      return [
        { action: 'view', title: 'View Dispute' }
      ];
    case NOTIFICATION_TYPES.AUCTION_OUTBID:
    case NOTIFICATION_TYPES.AUCTION_ENDING:
      return [
        { action: 'view', title: 'View Auction' },
        { action: 'bid', title: 'Place Bid' }
      ];
    default:
      return [];
  }
};

/**
 * Notify escrow created
 */
const notifyEscrowCreated = async (userId, invoiceId, amount) => {
  return sendNotification(userId, NOTIFICATION_TYPES.ESCROW_CREATED, {
    body: `Escrow created for invoice ${invoiceId.substring(0, 8)}... - Amount: ${amount}`
  });
};

/**
 * Notify escrow funded
 */
const notifyEscrowFunded = async (userId, invoiceId, amount) => {
  return sendNotification(userId, NOTIFICATION_TYPES.ESCROW_FUNDED, {
    body: `Funds of ${amount} deposited into escrow for invoice ${invoiceId.substring(0, 8)}...`
  });
};

/**
 * Notify dispute raised
 */
const notifyDisputeRaised = async (userId, invoiceId, reason) => {
  return sendNotification(userId, NOTIFICATION_TYPES.DISPUTE_RAISED, {
    body: `Dispute raised on invoice ${invoiceId.substring(0, 8)}... - Reason: ${reason}`
  });
};

/**
 * Notify dispute resolved
 */
const notifyDisputeResolved = async (userId, invoiceId, resolution) => {
  return sendNotification(userId, NOTIFICATION_TYPES.DISPUTE_RESOLVED, {
    body: `Dispute resolved for invoice ${invoiceId.substring(0, 8)}... - Resolution: ${resolution}`
  });
};

/**
 * Notify auction outbid
 */
const notifyAuctionOutbid = async (userId, auctionId, newBidAmount, yourBidAmount) => {
  return sendNotification(userId, NOTIFICATION_TYPES.AUCTION_OUTBID, {
    body: `You've been outbid! New bid: ${newBidAmount}, Your bid: ${yourBidAmount}`
  });
};

/**
 * Notify payment received
 */
const notifyPaymentReceived = async (userId, invoiceId, amount) => {
  return sendNotification(userId, NOTIFICATION_TYPES.PAYMENT_RECEIVED, {
    body: `Payment of ${amount} received for invoice ${invoiceId.substring(0, 8)}...`
  });
};

/**
 * Notify KYC status update
 */
const notifyKycStatus = async (userId, status, message) => {
  return sendNotification(userId, NOTIFICATION_TYPES.KYC_STATUS, {
    body: `KYC status: ${status} - ${message}`
  });
};

module.exports = {
  getVapidPublicKey,
  subscribeUser,
  unsubscribeUser,
  unsubscribeAllUser,
  getUserSubscriptions,
  getUserPreferences,
  updateUserPreferences,
  sendNotification,
  sendNotificationToMultiple,
  notifyEscrowCreated,
  notifyEscrowFunded,
  notifyDisputeRaised,
  notifyDisputeResolved,
  notifyAuctionOutbid,
  notifyPaymentReceived,
  notifyKycStatus,
  NOTIFICATION_TYPES
};
