const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { body, param, query, validationResult } = require('express-validator');
const Webhook = require('../models/Webhook');
const WebhookDelivery = require('../models/WebhookDelivery');
const WebhookService = require('../services/webhookService');
const errorResponse = require('../utils/errorResponse');

/*//////////////////////////////////////////////////////////////
                    VALIDATION MIDDLEWARE
//////////////////////////////////////////////////////////////*/
const validateWebhookCreation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
  body('url')
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Must be a valid HTTP or HTTPS URL'),
  body('events')
    .isArray({ min: 1 })
    .withMessage('At least one event must be selected'),
  body('events.*')
    .custom((value) => Webhook.isValidEventType(value))
    .withMessage('Invalid event type'),
  body('maxRetries')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Max retries must be between 0 and 10'),
  body('retryDelaySeconds')
    .optional()
    .isInt({ min: 10, max: 3600 })
    .withMessage('Retry delay must be between 10 and 3600 seconds')
];

const validateWebhookUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
  body('url')
    .optional()
    .trim()
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage('Must be a valid HTTP or HTTPS URL'),
  body('events')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one event must be selected'),
  body('events.*')
    .optional()
    .custom((value) => Webhook.isValidEventType(value))
    .withMessage('Invalid event type'),
  body('active')
    .optional()
    .isBoolean()
    .withMessage('Active must be a boolean')
];

const validateWebhookId = [
  param('webhookId')
    .isUUID(4)
    .withMessage('Invalid webhook ID')
];

/*//////////////////////////////////////////////////////////////
                    WEBHOOK CRUD ENDPOINTS
//////////////////////////////////////////////////////////////*/

/**
 * @route   POST /api/webhooks
 * @desc    Create a new webhook
 * @access  Private (requires authentication)
 */
router.post('/', authenticateToken, validateWebhookCreation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { name, url, events, maxRetries, retryDelaySeconds } = req.body;

    const webhook = await Webhook.create({
      userId: req.user.id,
      name,
      url,
      events,
      maxRetries,
      retryDelaySeconds
    });

    res.status(201).json({
      success: true,
      message: 'Webhook created successfully',
      webhook
    });
  } catch (error) {
    console.error('[Webhooks] Error creating webhook:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/webhooks
 * @desc    Get all webhooks for the current user
 * @access  Private
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const webhooks = await Webhook.findByUserId(req.user.id);

    res.json({
      success: true,
      count: webhooks.length,
      webhooks
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching webhooks:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/webhooks/events
 * @desc    Get all valid event types
 * @access  Private
 */
router.get('/events', authenticateToken, (req, res) => {
  res.json({
    success: true,
    events: Webhook.getValidEvents()
  });
});

/**
 * @route   GET /api/webhooks/:webhookId
 * @desc    Get a specific webhook
 * @access  Private
 */
router.get('/:webhookId', authenticateToken, validateWebhookId, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this webhook' 
      });
    }

    res.json({
      success: true,
      webhook
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching webhook:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   PUT /api/webhooks/:webhookId
 * @desc    Update a webhook
 * @access  Private
 */
router.put('/:webhookId', authenticateToken, validateWebhookId, validateWebhookUpdate, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this webhook' 
      });
    }

    const updatedWebhook = await Webhook.update(req.params.webhookId, req.body);

    res.json({
      success: true,
      message: 'Webhook updated successfully',
      webhook: updatedWebhook
    });
  } catch (error) {
    console.error('[Webhooks] Error updating webhook:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   DELETE /api/webhooks/:webhookId
 * @desc    Delete a webhook
 * @access  Private
 */
router.delete('/:webhookId', authenticateToken, validateWebhookId, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to delete this webhook' 
      });
    }

    await WebhookDelivery.deleteByWebhookId(req.params.webhookId);
    await Webhook.delete(req.params.webhookId);

    res.json({
      success: true,
      message: 'Webhook deleted successfully'
    });
  } catch (error) {
    console.error('[Webhooks] Error deleting webhook:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   POST /api/webhooks/:webhookId/regenerate-secret
 * @desc    Regenerate webhook secret
 * @access  Private
 */
router.post('/:webhookId/regenerate-secret', authenticateToken, validateWebhookId, async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to regenerate secret' 
      });
    }

    const result = await Webhook.regenerateSecret(req.params.webhookId);

    res.json({
      success: true,
      message: 'Webhook secret regenerated. Update your endpoint immediately.',
      webhook: result
    });
  } catch (error) {
    console.error('[Webhooks] Error regenerating secret:', error);
    return errorResponse(res, error, 500);
  }
});

/*//////////////////////////////////////////////////////////////
                    DELIVERY ENDPOINTS
//////////////////////////////////////////////////////////////*/

/**
 * @route   GET /api/webhooks/:webhookId/deliveries
 * @desc    Get delivery history for a webhook
 * @access  Private
 */
router.get('/:webhookId/deliveries', authenticateToken, validateWebhookId, [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt()
], async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to access this webhook' 
      });
    }

    const { limit = 50, offset = 0 } = req.query;
    const deliveries = await WebhookDelivery.findByWebhookId(
      req.params.webhookId, 
      limit, 
      offset
    );

    const stats = await WebhookDelivery.getStatsByWebhookId(req.params.webhookId);

    res.json({
      success: true,
      count: deliveries.length,
      stats,
      deliveries
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching deliveries:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/webhooks/:webhookId/deliveries/:deliveryId
 * @desc    Get a specific delivery
 * @access  Private
 */
router.get('/:webhookId/deliveries/:deliveryId', authenticateToken, validateWebhookId, [
  param('deliveryId').isUUID(4).withMessage('Invalid delivery ID')
], async (req, res) => {
  try {
    const webhook = await Webhook.findById(req.params.webhookId);

    if (!webhook) {
      return res.status(404).json({ 
        success: false, 
        message: 'Webhook not found' 
      });
    }

    // Check ownership
    if (webhook.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized' 
      });
    }

    const delivery = await WebhookDelivery.findById(req.params.deliveryId);

    if (!delivery || delivery.webhook_id !== req.params.webhookId) {
      return res.status(404).json({ 
        success: false, 
        message: 'Delivery not found' 
      });
    }

    res.json({
      success: true,
      delivery
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching delivery:', error);
    return errorResponse(res, error, 500);
  }
});

/*//////////////////////////////////////////////////////////////
                    ADMIN ENDPOINTS
//////////////////////////////////////////////////////////////*/

/**
 * @route   GET /api/webhooks/admin/all
 * @desc    Get all webhooks (admin only)
 * @access  Private (admin only)
 */
router.get('/admin/all', authenticateToken, requireRole(['admin']), [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt()
], async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const webhooks = await Webhook.findAll(limit, offset);

    res.json({
      success: true,
      count: webhooks.length,
      webhooks
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching all webhooks:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   GET /api/webhooks/admin/deliveries
 * @desc    Get recent deliveries (admin only)
 * @access  Private (admin only)
 */
router.get('/admin/deliveries', authenticateToken, requireRole(['admin']), [
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt()
], async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const deliveries = await WebhookDelivery.getRecentDeliveries(limit);

    res.json({
      success: true,
      count: deliveries.length,
      deliveries
    });
  } catch (error) {
    console.error('[Webhooks] Error fetching deliveries:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   POST /api/webhooks/admin/process-retries
 * @desc    Manually trigger retry processing (admin only)
 * @access  Private (admin only)
 */
router.post('/admin/process-retries', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const result = await WebhookService.processRetries();

    res.json({
      success: true,
      message: 'Retry processing completed',
      result
    });
  } catch (error) {
    console.error('[Webhooks] Error processing retries:', error);
    return errorResponse(res, error, 500);
  }
});

/**
 * @route   POST /api/webhooks/admin/cleanup
 * @desc    Clean up old delivery records (admin only)
 * @access  Private (admin only)
 */
router.post('/admin/cleanup', authenticateToken, requireRole(['admin']), [
  body('days').optional().isInt({ min: 1, max: 365 }).toInt()
], async (req, res) => {
  try {
    const { days = 30 } = req.body;
    const result = await WebhookService.cleanupOldDeliveries(days);

    res.json({
      success: true,
      message: `Cleaned up delivery records older than ${days} days`,
      result
    });
  } catch (error) {
    console.error('[Webhooks] Error cleaning up:', error);
    return errorResponse(res, error, 500);
  }
});

module.exports = router;
