const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const creditScoreService = require('../services/creditScoreService');

/**
 * @swagger
 * /api/credit-scores/me:
 *   get:
 *     summary: Get current user's credit score
 *     tags: [Credit Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User credit score
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await creditScoreService.getScoreByUserId(userId);
    const grade = creditScoreService.getScoreGrade(result.score);
    
    res.json({
      success: true,
      data: {
        ...result,
        grade: grade
      }
    });
  } catch (error) {
    console.error('[CreditScore] Error getting user score:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get credit score'
    });
  }
});

/**
 * @swagger
 * /api/credit-scores/calculate:
 *   post:
 *     summary: Recalculate current user's credit score
 *     tags: [Credit Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recalculated credit score
 *       401:
 *         description: Unauthorized
 */
router.post('/calculate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await creditScoreService.calculateScore(userId);
    const grade = creditScoreService.getScoreGrade(result.score);
    
    res.json({
      success: true,
      data: {
        ...result,
        grade: grade
      }
    });
  } catch (error) {
    console.error('[CreditScore] Error calculating score:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to calculate credit score'
    });
  }
});

/**
 * @swagger
 * /api/credit-scores/{userId}:
 *   get:
 *     summary: Get credit score for a specific user (admin or authorized)
 *     tags: [Credit Scores]
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
 *         description: User credit score
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    // Check if user is authorized to view this score
    const currentUserId = req.user.id;
    const requestedUserId = req.params.userId;
    
    // Users can only view their own score, or admins can view any
    if (currentUserId !== requestedUserId && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Not authorized to view this credit score'
      });
    }
    
    const result = await creditScoreService.getScoreByUserId(requestedUserId);
    const grade = creditScoreService.getScoreGrade(result.score);
    
    res.json({
      success: true,
      data: {
        ...result,
        grade: grade
      }
    });
  } catch (error) {
    console.error('[CreditScore] Error getting user score:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get credit score'
    });
  }
});

/**
 * @swagger
 * /api/credit-scores/history:
 *   get:
 *     summary: Get credit score history for current user
 *     tags: [Credit Scores]
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
 *         description: Score history
 *       401:
 *         description: Unauthorized
 */
router.get('/history/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 10;
    
    const history = await creditScoreService.getScoreHistory(userId, limit);
    
    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('[CreditScore] Error getting score history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get score history'
    });
  }
});

/**
 * @swagger
 * /api/credit-scores/recalculate-all:
 *   post:
 *     summary: Recalculate all user scores (admin only)
 *     tags: [Credit Scores]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recalculation results
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (admin only)
 */
router.post('/recalculate-all', authenticateToken, async (req, res) => {
  // Only admins can trigger recalculation for all users
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Only admins can recalculate all scores'
    });
  }
  
  try {
    const results = await creditScoreService.recalculateAllScores();
    
    res.json({
      success: true,
      data: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      }
    });
  } catch (error) {
    console.error('[CreditScore] Error recalculating all scores:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to recalculate scores'
    });
  }
});

module.exports = router;
