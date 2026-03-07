const { pool } = require('../config/database');

class WebhookDelivery {
  /*//////////////////////////////////////////////////////////////
                          CREATE
  //////////////////////////////////////////////////////////////*/
  static async create(deliveryData) {
    const {
      webhookId,
      eventType,
      payload
    } = deliveryData;

    const query = `
      INSERT INTO webhook_deliveries (
        webhook_id, event_type, payload
      )
      VALUES ($1, $2, $3)
      RETURNING id, webhook_id, event_type, status, created_at
    `;

    const values = [
      webhookId,
      eventType,
      JSON.stringify(payload)
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                          READ QUERIES
  //////////////////////////////////////////////////////////////*/
  static async findById(deliveryId) {
    const query = `
      SELECT id, webhook_id, event_type, payload, status, attempt_count,
             last_attempt_at, next_retry_at, http_status, response_body,
             error_message, created_at, delivered_at
      FROM webhook_deliveries
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [deliveryId]);
    return rows[0];
  }

  static async findByWebhookId(webhookId, limit = 50, offset = 0) {
    const query = `
      SELECT id, event_type, status, attempt_count, http_status,
             created_at, delivered_at
      FROM webhook_deliveries
      WHERE webhook_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(query, [webhookId, limit, offset]);
    return rows;
  }

  static async findPendingRetries() {
    const query = `
      SELECT wd.id, wd.webhook_id, wd.event_type, wd.payload, wd.attempt_count,
             w.url, w.secret, w.max_retries, w.retry_delay_seconds
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
      WHERE wd.status IN ('pending', 'retrying')
      AND wd.next_retry_at <= NOW()
      AND wd.attempt_count < w.max_retries
      AND w.active = true
      ORDER BY wd.created_at ASC
      LIMIT 100
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  static async getStatsByWebhookId(webhookId) {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'retrying') as retrying
      FROM webhook_deliveries
      WHERE webhook_id = $1
    `;
    const { rows } = await pool.query(query, [webhookId]);
    return rows[0];
  }

  static async getRecentDeliveries(limit = 100) {
    const query = `
      SELECT wd.id, wd.event_type, wd.status, wd.http_status, wd.created_at,
             w.name as webhook_name, w.url as webhook_url
      FROM webhook_deliveries wd
      JOIN webhooks w ON wd.webhook_id = w.id
      ORDER BY wd.created_at DESC
      LIMIT $1
    `;
    const { rows } = await pool.query(query, [limit]);
    return rows;
  }

  /*//////////////////////////////////////////////////////////////
                          UPDATE
  //////////////////////////////////////////////////////////////*/
  static async updateStatus(deliveryId, status, responseData = {}) {
    const {
      httpStatus,
      responseBody,
      errorMessage,
      nextRetryAt
    } = responseData;

    let query = `
      UPDATE webhook_deliveries
      SET status = $1,
          last_attempt_at = NOW(),
          attempt_count = attempt_count + 1
    `;
    const values = [status, deliveryId];
    let paramCount = 3;

    if (httpStatus !== undefined) {
      query += `, http_status = $${paramCount}`;
      values.push(httpStatus);
      paramCount++;
    }

    if (responseBody !== undefined) {
      query += `, response_body = $${paramCount}`;
      values.push(responseBody);
      paramCount++;
    }

    if (errorMessage !== undefined) {
      query += `, error_message = $${paramCount}`;
      values.push(errorMessage);
      paramCount++;
    }

    if (nextRetryAt !== undefined) {
      query += `, next_retry_at = $${paramCount}`;
      values.push(nextRetryAt);
      paramCount++;
    }

    if (status === 'delivered') {
      query += `, delivered_at = NOW()`;
    }

    query += ` WHERE id = $2 RETURNING id, status, attempt_count`;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async markDelivered(deliveryId, httpStatus, responseBody) {
    return this.updateStatus(deliveryId, 'delivered', {
      httpStatus,
      responseBody
    });
  }

  static async markFailed(deliveryId, errorMessage, retryAt = null) {
    return this.updateStatus(deliveryId, 'failed', {
      errorMessage,
      nextRetryAt: retryAt
    });
  }

  static async markRetrying(deliveryId, nextRetryAt) {
    return this.updateStatus(deliveryId, 'retrying', {
      nextRetryAt
    });
  }

  /*//////////////////////////////////////////////////////////////
                          DELETE
  //////////////////////////////////////////////////////////////*/
  static async deleteOlderThan(days = 30) {
    const query = `
      DELETE FROM webhook_deliveries
      WHERE created_at < NOW() - INTERVAL '${parseInt(days)} days'
      RETURNING COUNT(*) as deleted_count
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }

  static async deleteByWebhookId(webhookId) {
    const query = 'DELETE FROM webhook_deliveries WHERE webhook_id = $1';
    await pool.query(query, [webhookId]);
  }
}

module.exports = WebhookDelivery;
