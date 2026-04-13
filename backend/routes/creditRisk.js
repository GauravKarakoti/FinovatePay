const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const creditRiskService = require('../services/creditRiskService');

/**
 * All routes in this file are mounted at /api/v1/credit-risk
 */

// Global middleware to ensure all risk routes require a valid token
router.use(authenticateToken);

/**
 * @swagger
 * /api/v1/credit-risk/me:
 * get:
 * summary: Get current user's (Seller/Buyer) own AI-powered health profile
 */
router.get('/me', async (req, res) => {
  try {
    const userId = req.user.id;
    // getRiskProfileByUserId fetches existing or calculates new if missing
    const profile = await creditRiskService.getRiskProfileByUserId(userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting personal profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get personal risk profile'
    });
  }
});

/**
 * @swagger
 * /api/v1/credit-risk/calculate:
 * post:
 * summary: Refresh current user's AI risk profile
 */
router.post('/calculate', async (req, res) => {
  try {
    const userId = req.user.id;
    // Forced recalculation of behavioral and financial features
    const profile = await creditRiskService.calculateRiskProfile(userId);
    
    res.json({
      success: true,
      data: profile
    });
  } catch (error) {
    console.error('[CreditRisk] Error recalculating profile:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to refresh risk profile'
    });
  }
});

/**
 * @swagger
 * /api/v1/credit-risk/dynamic-rate:
 * get:
 * summary: Get dynamic interest rate for current user
 */
router.get('/dynamic-rate', async (req, res) => {
  try {
    const userId = req.user.id;
    const rateData = await creditRiskService.getDynamicInterestRate(userId);
    
    res.json({
      success: true,
      data: rateData
    });
  } catch (error) {
    console.error('[CreditRisk] Error getting dynamic rate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dynamic interest rate'
    });
  }
});

/**
 * @swagger
 * /api/v1/credit-risk/analyze:
 * post:
 * summary: Deep analysis via ML microservice (Internal/Admin tool)
 */
router.post('/analyze', async (req, res) => {
  try {
    const requesterId = req.user.id;
    const { userId, walletAddress, force } = req.body || {};

    // Security check: Regular users can only trigger ML analysis on themselves
    if (userId && userId !== requesterId && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        error: 'Not authorized to analyze other users' 
      });
    }

    const targetUserId = userId || requesterId;
    const targetWallet = walletAddress || req.user.wallet_address;

    // Triggers external ML microservice and on-chain feature fetching
    const result = await creditRiskService.analyzeCreditRisk({ 
      userId: targetUserId, 
      walletAddress: targetWallet, 
      force 
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[CreditRisk] ML Service Error:', error);
    res.status(500).json({ success: false, error: 'Machine Learning analysis failed' });
  }
});

/**
 * ADMIN ENDPOINTS
 */

// Get all profiles with pagination
router.get('/admin/all', requireRole(['admin']), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const profiles = await creditRiskService.getAllRiskProfiles(limit, offset);
    
    res.json({ success: true, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch all profiles' });
  }
});

// Get profiles filtered by risk category (e.g., 'high', 'excellent')
router.get('/admin/category/:category', requireRole(['admin']), async (req, res) => {
  try {
    const { category } = req.params;
    const profiles = await creditRiskService.getRiskProfilesByCategory(category);
    res.json({ success: true, data: profiles });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to filter by category' });
  }
});

// View a specific user by ID (Used by Admins for due diligence)
router.get('/:userId', async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const requestedUserId = req.params.userId;
    
    if (currentUserId !== requestedUserId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    const profile = await creditRiskService.getRiskProfileByUserId(requestedUserId);
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get profile' });
  }
});

module.exports = router;