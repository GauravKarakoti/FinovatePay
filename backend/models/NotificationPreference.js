const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class NotificationPreference {
  /**
   * Create notification preference for user
   * @param {integer} userId - User ID
   * @returns {object} - Created preference object
   */
  static async create(userId) {
    try {
      const query = `
        INSERT INTO user_notification_preferences (
          id, user_id, unsubscribe_token
        )
        VALUES ($1, $2, $3)
        RETURNING *
      `;

      const result = await pool.query(query, [uuidv4(), userId, uuidv4()]);
      console.log(`✅ Created notification preferences for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error creating notification preference:', error.message);
      throw error;
    }
  }

  /**
   * Find preferences by user ID
   * @param {integer} userId - User ID
   * @returns {object} - Preference object or null
   */
  static async findByUserId(userId) {
    try {
      const query = `
        SELECT *
        FROM user_notification_preferences
        WHERE user_id = $1
      `;

      const result = await pool.query(query, [userId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Error finding notification preference:', error.message);
      return null;
    }
  }

  /**
   * Update notification preferences
   * @param {integer} userId - User ID
   * @param {object} preferences - Preferences object
   * @returns {object} - Updated preference object
   */
  static async updatePreferences(userId, preferences) {
    try {
      const {
        invoiceNotifications,
        paymentNotifications,
        disputeNotifications,
        shipmentNotifications,
        kycNotifications,
        emailFrequency
      } = preferences;

      const query = `
        UPDATE user_notification_preferences
        SET invoice_notifications = COALESCE($2, invoice_notifications),
            payment_notifications = COALESCE($3, payment_notifications),
            dispute_notifications = COALESCE($4, dispute_notifications),
            shipment_notifications = COALESCE($5, shipment_notifications),
            kyc_notifications = COALESCE($6, kyc_notifications),
            email_frequency = COALESCE($7, email_frequency),
            updated_at = NOW()
        WHERE user_id = $1
        RETURNING *
      `;

      const result = await pool.query(query, [
        userId,
        invoiceNotifications,
        paymentNotifications,
        disputeNotifications,
        shipmentNotifications,
        kycNotifications,
        emailFrequency
      ]);

      console.log(`✅ Updated notification preferences for user ${userId}`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error updating notification preference:', error.message);
      throw error;
    }
  }

  /**
   * Unsubscribe using token
   * @param {string} unsubscribeToken - Unsubscribe token
   * @returns {object} - Updated preference object
   */
  static async unsubscribe(unsubscribeToken) {
    try {
      const query = `
        UPDATE user_notification_preferences
        SET is_subscribed = false,
            updated_at = NOW()
        WHERE unsubscribe_token = $1
        RETURNING *
      `;

      const result = await pool.query(query, [unsubscribeToken]);
      console.log(`✅ User unsubscribed successfully`);
      return result.rows[0];
    } catch (error) {
      console.error('❌ Error unsubscribing:', error.message);
      throw error;
    }
  }
}

module.exports = NotificationPreference;
