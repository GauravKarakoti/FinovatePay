const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const creditRiskService = require('../services/creditRiskService');

/**
 * @swagger
 * /api/credit-risk/me:
 *   get:
 *     summary: Get current user's AI-powered credit risk profile
 *     tags: [Credit Risk]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User risk profile
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = await creditRiskService.getRiskProfileByUserId(userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting user risk profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get risk profile'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/calculate:
 *   post:
 *     summary: Calculate/refresh current user's AI risk profile
 *     tags: [Credit Risk]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Calculated risk profile
 *       401:
 *         description: Unauthorized
 */
router.post('/calculate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const profile = await creditRiskService.calculateRiskProfile(userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('[CreditRisk] Error calculating risk profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate risk profile'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/{userId}:
 *   get:
 *     summary: Get credit risk profile for a specific user
 *     tags: [Credit Risk]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User risk profile
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const requestedUserId = req.params.userId;
    
    // Users can only view their own profile, or admins can view any
    if (currentUserId !== requestedUserId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this risk profile'
      });
    }
    
    const profile = await creditRiskService.getRiskProfileByUserId(requestedUserId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting user risk profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get risk profile'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/dynamic-rate:
 *   get:
 *     summary: Get dynamic interest rate for current user
 *     tags: [Credit Risk]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dynamic interest rate
 *       401:
 *         description: Unauthorized
 */
router.get('/dynamic-rate/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const rate = await creditRiskService.getDynamicInterestRate(userId);
    
    res.json({
      success: true,
      data: rate
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting dynamic rate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get dynamic rate'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/history:
 *   get:
 *     summary: Get credit risk history for current user
 *     tags: [Credit Risk]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Risk history
 *       401:
 *         description: Unauthorized
 */
router.get('/history/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const history = await creditRiskService.getRiskHistory(userId, limit);
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting risk history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get risk history'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/all:
 *   get:
 *     summary: Get all risk profiles (admin only)
 *     tags: [Credit Risk]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All risk profiles
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin only)
 */
router.get('/admin/all', authenticateToken, async (req, res) => {
  // Only admins can view all profiles
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Only admins can view all risk profiles'
    });
  }
  
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const profiles = await creditRiskService.getAllRiskProfiles(limit, offset);
    
    res.json({
      success: true,
      data: profiles,
      pagination: {
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting all profiles:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get risk profiles'
    });
  }
});

/**
 * @swagger
 * /api/credit-risk/category/{category}:
 *   get:
 *     summary: Get risk profiles by category (admin only)
 *     tags: [Credit Risk]
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [excellent, good, moderate, high, very_high]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Risk profiles by category
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin only)
 */
router.get('/admin/category/:category', authenticateToken, async (req, res) => {
  // Only admins can view by category
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Only admins can view risk profiles by category'
    });
  }
  
  try {
    const { category } = req.params;
    const profiles = await creditRiskService.getRiskProfilesByCategory(category);
    
    res.json({
      success: true,
      data: profiles,
      meta: {
        category,
        count: profiles.length
      }
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting profiles by category:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get risk profiles by category'
    });
  }
});

module.exports = router;

