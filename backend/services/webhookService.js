const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const Webhook = require('../models/Webhook');
const WebhookDelivery = require('../models/WebhookDelivery');

class WebhookService {
  /**
   * Dispatch an event to all subscribed webhooks
   * @param {string} eventType - The event type (e.g., 'invoice.created')
   * @param {object} payload - The event payload
   * @returns {Promise<void>}
   */
  static async dispatchEvent(eventType, payload) {
    try {
      // Find all active webhooks subscribed to this event
      const webhooks = await Webhook.findActiveByEventType(eventType);

      if (webhooks.length === 0) {
        console.log(`[Webhook] No active webhooks subscribed to ${eventType}`);
        return;
      }

      console.log(`[Webhook] Dispatching ${eventType} to ${webhooks.length} webhook(s)`);

      // Create delivery records and send to each webhook
      const dispatchPromises = webhooks.map(async (webhook) => {
        try {
          // Create delivery record
          const delivery = await WebhookDelivery.create({
            webhookId: webhook.id,
            eventType,
            payload
          });

          // Send webhook
          await this.sendWebhook(webhook, delivery.id, eventType, payload);
        } catch (error) {
          console.error(`[Webhook] Failed to dispatch to ${webhook.url}:`, error.message);
        }
      });

      await Promise.allSettled(dispatchPromises);
    } catch (error) {
      console.error(`[Webhook] Error dispatching event ${eventType}:`, error.message);
    }
  }

  /**
   * Send a webhook request
   * @param {object} webhook - Webhook configuration
   * @param {string} deliveryId - Delivery ID for tracking
   * @param {string} eventType - Event type
   * @param {object} payload - Event payload
   * @returns {Promise<void>}
   */
  static async sendWebhook(webhook, deliveryId, eventType, payload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      id: deliveryId,
      type: eventType,
      timestamp,
      data: payload
    });

    // Generate signature
    const signature = this.generateSignature(webhook.secret, body);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-Webhook-Event': eventType,
      'User-Agent': 'FinovatePay-Webhook/1.0'
    };

    try {
      const response = await this.makeRequest(webhook.url, {
        method: 'POST',
        headers,
        body
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await WebhookDelivery.markDelivered(deliveryId, response.statusCode, response.body);
        console.log(`[Webhook] ✅ Delivered ${eventType} to ${webhook.url}`);
      } else {
        await this.handleFailedDelivery(webhook, deliveryId, 
          `HTTP ${response.statusCode}: ${response.body}`);
      }
    } catch (error) {
      await this.handleFailedDelivery(webhook, deliveryId, error.message);
    }
  }

  /**
   * Handle failed webhook delivery with retry logic
   * @param {object} webhook - Webhook configuration
   * @param {string} deliveryId - Delivery ID
   * @param {string} errorMessage - Error message
   */
  static async handleFailedDelivery(webhook, deliveryId, errorMessage) {
    const delivery = await WebhookDelivery.findById(deliveryId);

    if (!delivery) {
      console.error(`[Webhook] Delivery not found: ${deliveryId}`);
      return;
    }

    const attemptCount = delivery.attempt_count + 1;
    const maxRetries = webhook.max_retries || 5;

    if (attemptCount < maxRetries) {
      // Schedule retry with exponential backoff
      const delaySeconds = (webhook.retry_delay_seconds || 60) * Math.pow(2, attemptCount - 1);
      const nextRetryAt = new Date(Date.now() + delaySeconds * 1000);

      await WebhookDelivery.markRetrying(deliveryId, nextRetryAt);
      console.log(`[Webhook] ⚠️ Retrying delivery ${deliveryId} (attempt ${attemptCount}/${maxRetries}) at ${nextRetryAt}`);
    } else {
      await WebhookDelivery.markFailed(deliveryId, errorMessage);
      console.error(`[Webhook] ❌ Delivery ${deliveryId} failed permanently: ${errorMessage}`);
    }
  }

  /**
   * Process pending webhook retries
   * Should be called periodically by a cron job or scheduler
   * @returns {Promise<object>} - Retry results
   */
  static async processRetries() {
    const pendingDeliveries = await WebhookDelivery.findPendingRetries();

    if (pendingDeliveries.length === 0) {
      return { processed: 0, successful: 0, failed: 0 };
    }

    console.log(`[Webhook] Processing ${pendingDeliveries.length} pending retries`);

    let successful = 0;
    let failed = 0;

    for (const delivery of pendingDeliveries) {
      try {
        const webhook = {
          id: delivery.webhook_id,
          url: delivery.url,
          secret: delivery.secret,
          max_retries: delivery.max_retries,
          retry_delay_seconds: delivery.retry_delay_seconds
        };

        await this.sendWebhook(webhook, delivery.id, delivery.event_type, delivery.payload);

        // Check if delivery was successful
        const updatedDelivery = await WebhookDelivery.findById(delivery.id);
        if (updatedDelivery.status === 'delivered') {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(`[Webhook] Retry failed for delivery ${delivery.id}:`, error.message);
        failed++;
      }
    }

    return {
      processed: pendingDeliveries.length,
      successful,
      failed
    };
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   * @param {string} secret - Webhook secret
   * @param {string} body - Request body
   * @returns {string} - Signature in hex format
   */
  static generateSignature(secret, body) {
    return crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
  }

  /**
   * Verify webhook signature (for testing purposes)
   * @param {string} secret - Webhook secret
   * @param {string} body - Request body
   * @param {string} signature - Signature to verify
   * @returns {boolean} - Whether signature is valid
   */
  static verifySignature(secret, body, signature) {
    const expectedSignature = this.generateSignature(secret, body);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  /**
   * Make HTTP request
   * @param {string} urlString - URL to request
   * @param {object} options - Request options
   * @returns {Promise<object>} - Response object
   */
  static makeRequest(urlString, options) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'POST',
        headers: options.headers,
        timeout: 30000 // 30 second timeout
      };

      const req = httpModule.request(requestOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    });
  }

  /**
   * Clean up old delivery records
   * @param {number} days - Delete records older than this many days
   * @returns {Promise<object>} - Cleanup result
   */
  static async cleanupOldDeliveries(days = 30) {
    try {
      const result = await WebhookDelivery.deleteOlderThan(days);
      console.log(`[Webhook] Cleaned up ${result.deleted_count} old delivery records`);
      return result;
    } catch (error) {
      console.error('[Webhook] Error cleaning up old deliveries:', error.message);
      return { deleted_count: 0 };
    }
  }
}

module.exports = WebhookService;
