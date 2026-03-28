/**
 * Whitelabel Routes
 * 
 * API endpoints for white-label configuration management
 * Enables multi-tenant deployments with custom branding and themes
 */

const express = require('express');
const router = express.Router();
const whitelabelController = require('../controllers/whitelabelController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// ========================================
// Public Routes
// ========================================

/**
 * @route   GET /api/whitelabel/config/domain/:domain
 * @desc    Get whitelabel configuration by domain (for frontend initialization)
 * @access  Public
 */
router.get('/config/domain/:domain', whitelabelController.getConfigurationByDomain);

// ========================================
// Protected Routes (Require Authentication)
// ========================================

/**
 * @route   GET /api/whitelabel/config
 * @desc    Get current organization's whitelabel configuration
 * @access  Private
 */
router.get('/config', authenticateToken, whitelabelController.getConfiguration);

/**
 * @route   PUT /api/whitelabel/config
 * @desc    Update whitelabel configuration
 * @access  Private (Admin or Organization Admin)
 */
router.put('/config', authenticateToken, whitelabelController.updateConfiguration);

/**
 * @route   GET /api/whitelabel/limits
 * @desc    Check organization limits
 * @access  Private
 */
router.get('/limits', authenticateToken, whitelabelController.checkLimits);

// ========================================
// Domain Management Routes
// ========================================

/**
 * @route   GET /api/whitelabel/domains
 * @desc    List all domains for organization
 * @access  Private
 */
router.get('/domains', authenticateToken, whitelabelController.listDomains);

/**
 * @route   POST /api/whitelabel/domains
 * @desc    Add a custom domain for verification
 * @access  Private (Admin or Organization Admin)
 */
router.post('/domains', authenticateToken, whitelabelController.addCustomDomain);

/**
 * @route   POST /api/whitelabel/domains/:domain/verify
 * @desc    Verify a custom domain
 * @access  Private (Admin or Organization Admin)
 */
router.post('/domains/:domain/verify', authenticateToken, whitelabelController.verifyDomain);

/**
 * @route   DELETE /api/whitelabel/domains/:domain
 * @desc    Remove a custom domain
 * @access  Private (Admin or Organization Admin)
 */
router.delete('/domains/:domain', authenticateToken, whitelabelController.removeCustomDomain);

// ========================================
// Organization Management Routes (Admin Only)
// ========================================

/**
 * @route   POST /api/whitelabel/organizations
 * @desc    Create a new organization
 * @access  Private (Admin)
 */
router.post(
  '/organizations',
  authenticateToken,
  requireRole('admin'),
  whitelabelController.createOrganization
);

/**
 * @route   GET /api/whitelabel/organizations
 * @desc    List all organizations
 * @access  Private (Admin)
 */
router.get(
  '/organizations',
  authenticateToken,
  requireRole('admin'),
  whitelabelController.listOrganizations
);

/**
 * @route   GET /api/whitelabel/organizations/:id
 * @desc    Get organization by ID
 * @access  Private
 */
router.get('/organizations/:id', authenticateToken, whitelabelController.getOrganization);

/**
 * @route   PUT /api/whitelabel/organizations/:id
 * @desc    Update organization
 * @access  Private (Admin or Organization Admin)
 */
router.put('/organizations/:id', authenticateToken, whitelabelController.updateOrganization);

/**
 * @route   DELETE /api/whitelabel/organizations/:id
 * @desc    Delete organization
 * @access  Private (Admin)
 */
router.delete(
  '/organizations/:id',
  authenticateToken,
  requireRole('admin'),
  whitelabelController.deleteOrganization
);

module.exports = router;
