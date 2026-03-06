const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

/**
 * Analytics Routes
 * Provides real-time financial analytics for businesses including:
 * - Cash flow visualization
 * - Payment history charts
 * - Financing metrics
 * - Risk assessment scores for investors
 */

// All analytics routes require authentication
router.use(authenticateToken);

/**
 * GET /api/analytics/overview
 * Get dashboard summary including invoice, escrow, and financing stats
 */
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    
    const overview = await analyticsService.getDashboardOverview(userId, role);
    
    res.json({
      success: true,
      data: overview
    });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics overview'
    });
  }
});

/**
 * GET /api/analytics/payments
 * Get payment history with optional pagination
 * Query params: page, limit
 */
router.get('/payments', async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const analytics = await analyticsService.getPaymentAnalytics(userId);
    
    // Apply pagination to recent payments
    const paginatedPayments = analytics.recentPayments.slice(offset, offset + limit);
    
    res.json({
      success: true,
      data: {
        summary: analytics.summary,
        monthlyVolume: analytics.monthlyVolume,
        statusDistribution: analytics.statusDistribution,
        payments: paginatedPayments,
        pagination: {
          page,
          limit,
          total: analytics.recentPayments.length,
          pages: Math.ceil(analytics.recentPayments.length / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching payment analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment analytics'
    });
  }
});

/**
 * GET /api/analytics/financing
 * Get financing performance analytics
 */
router.get('/financing', requireRole(['seller', 'investor', 'admin']), async (req, res) => {
  try {
    const userId = req.user.id;
    
    const analytics = await analyticsService.getFinancingAnalytics(userId);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching financing analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch financing analytics'
    });
  }
});

/**
 * GET /api/analytics/risk/:invoiceId
 * Get risk assessment for a specific invoice
 */
router.get('/risk/:invoiceId', requireRole(['seller', 'investor', 'admin']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    if (!invoiceId) {
      return res.status(400).json({
        success: false,
        error: 'Invoice ID is required'
      });
    }
    
    const riskAssessment = await analyticsService.getRiskScore(invoiceId);
    
    res.json({
      success: true,
      data: riskAssessment
    });
  } catch (error) {
    console.error('Error fetching risk assessment:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch risk assessment'
    });
  }
});

module.exports = router;
