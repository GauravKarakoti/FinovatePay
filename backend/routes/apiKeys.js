const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const apiKeyController = require('../controllers/apiKeyController');

// All routes require authentication
router.use(authenticateToken);

/**
 * @route   GET /api/api-keys
 * @desc    List all API keys for the authenticated user
 * @access  Private
 */
router.get('/', apiKeyController.listApiKeys);

/**
 * @route   GET /api/api-keys/stats
 * @desc    Get API key statistics
 * @access  Private
 */
router.get('/stats', apiKeyController.getApiKeyStats);

/**
 * @route   GET /api/api-keys/scopes
 * @desc    Get available API key scopes
 * @access  Private
 */
router.get('/scopes', apiKeyController.getScopes);

/**
 * @route   POST /api/api-keys
 * @desc    Create a new API key
 * @access  Private
 */
router.post('/', apiKeyController.createApiKey);

/**
 * @route   GET /api/api-keys/:id
 * @desc    Get a specific API key
 * @access  Private
 */
router.get('/:id', apiKeyController.getApiKey);

/**
 * @route   PUT /api/api-keys/:id
 * @desc    Update an API key
 * @access  Private
 */
router.put('/:id', apiKeyController.updateApiKey);

/**
 * @route   POST /api/api-keys/:id/revoke
 * @desc    Revoke an API key
 * @access  Private
 */
router.post('/:id/revoke', apiKeyController.revokeApiKey);

/**
 * @route   DELETE /api/api-keys/:id
 * @desc    Delete an API key
 * @access  Private
 */
router.delete('/:id', apiKeyController.deleteApiKey);

module.exports = router;
