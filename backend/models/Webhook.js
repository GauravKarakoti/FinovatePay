const { pool } = require('../config/database');
const crypto = require('crypto');

class Webhook {
  /*//////////////////////////////////////////////////////////////
                          CREATE
  //////////////////////////////////////////////////////////////*/
  static async create(webhookData) {
    const {
      userId,
      name,
      url,
      events,
      secret,
      maxRetries = 5,
      retryDelaySeconds = 60
    } = webhookData;

    // Generate a secret if not provided
    const webhookSecret = secret || this.generateSecret();

    const query = `
      INSERT INTO webhooks (
        user_id, name, url, secret, events, max_retries, retry_delay_seconds
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, url, events, active, created_at
    `;

    const values = [
      userId,
      name,
      url,
      webhookSecret,
      JSON.stringify(events),
      maxRetries,
      retryDelaySeconds
    ];

    const result = await pool.query(query, values);
    return {
      ...result.rows[0],
      secret: webhookSecret  // Return secret only on creation
    };
  }

  /*//////////////////////////////////////////////////////////////
                          READ QUERIES
  //////////////////////////////////////////////////////////////*/
  static async findById(webhookId) {
    const query = `
      SELECT id, user_id, name, url, events, active, max_retries, 
             retry_delay_seconds, created_at, updated_at
      FROM webhooks
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [webhookId]);
    return rows[0];
  }

  static async findByUserId(userId) {
    const query = `
      SELECT id, name, url, events, active, max_retries, 
             retry_delay_seconds, created_at, updated_at
      FROM webhooks
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  static async findActiveByEventType(eventType) {
    const query = `
      SELECT id, user_id, name, url, secret, events, max_retries, retry_delay_seconds
      FROM webhooks
      WHERE active = true
      AND events ? $1
    `;
    const { rows } = await pool.query(query, [eventType]);
    return rows;
  }

  static async findAll(limit = 100, offset = 0) {
    const query = `
      SELECT w.id, w.name, w.url, w.events, w.active, w.created_at,
             u.email as user_email
      FROM webhooks w
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
      LIMIT $1 OFFSET $2
    `;
    const { rows } = await pool.query(query, [limit, offset]);
    return rows;
  }

  /*//////////////////////////////////////////////////////////////
                          UPDATE
  //////////////////////////////////////////////////////////////*/
  static async update(webhookId, updateData) {
    const allowedFields = ['name', 'url', 'events', 'active', 'max_retries', 'retry_delay_seconds'];
    const updates = [];
    const values = [webhookId];
    let paramCount = 2;

    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        if (key === 'events') {
          updates.push(`${key} = $${paramCount}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = $${paramCount}`);
          values.push(value);
        }
        paramCount++;
      }
    }

    if (updates.length === 0) {
      return this.findById(webhookId);
    }

    const query = `
      UPDATE webhooks
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, url, events, active, max_retries, retry_delay_seconds, updated_at
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async regenerateSecret(webhookId) {
    const newSecret = this.generateSecret();

    const query = `
      UPDATE webhooks
      SET secret = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, name, url
    `;

    const result = await pool.query(query, [newSecret, webhookId]);
    return {
      ...result.rows[0],
      secret: newSecret
    };
  }

  /*//////////////////////////////////////////////////////////////
                          DELETE
  //////////////////////////////////////////////////////////////*/
  static async delete(webhookId) {
    const query = 'DELETE FROM webhooks WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [webhookId]);
    return result.rows[0];
  }

  static async deleteByUserId(userId) {
    const query = 'DELETE FROM webhooks WHERE user_id = $1 RETURNING id';
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  /*//////////////////////////////////////////////////////////////
                          HELPERS
  //////////////////////////////////////////////////////////////*/
  static generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  static isValidEventType(eventType) {
    const validEvents = [
      'invoice.created',
      'invoice.paid',
      'invoice.cancelled',
      'escrow.funded',
      'escrow.released',
      'dispute.raised',
      'dispute.resolved',
      'shipment.created',
      'shipment.delivered',
      'kyc.approved',
      'kyc.rejected',
      'quotation.created',
      'quotation.approved',
      'payment.stream_created',
      'payment.stream_completed'
    ];
    return validEvents.includes(eventType);
  }

  static getValidEvents() {
    return [
      'invoice.created',
      'invoice.paid',
      'invoice.cancelled',
      'escrow.funded',
      'escrow.released',
      'dispute.raised',
      'dispute.resolved',
      'shipment.created',
      'shipment.delivered',
      'kyc.approved',
      'kyc.rejected',
      'quotation.created',
      'quotation.approved',
      'payment.stream_created',
      'payment.stream_completed'
    ];
  }
}

module.exports = Webhook;
