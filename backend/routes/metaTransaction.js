const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const relayerService = require('../services/relayerService');
const pool = require('../config/database');

/**
 * POST /api/meta-tx/submit
 * Submit a signed meta-transaction
 */
router.post('/submit', authenticateToken, async (req, res) => {
  try {
    const { request, signature } = req.body;

    // Validate request structure
    if (!request || !signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing request or signature'
      });
    }

    // Validate request fields
    const requiredFields = ['from', 'to', 'value', 'gas', 'nonce', 'data'];
    for (const field of requiredFields) {
      if (request[field] === undefined) {
        return res.status(400).json({
          success: false,
          error: `Missing required field: ${field}`
        });
      }
    }

    // Submit meta-transaction
    const result = await relayerService.submitMetaTransaction(
      request,
      signature,
      req.user.id
    );

    if (result.success) {
      return res.json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error('Meta-transaction submission error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/meta-tx/nonce/:address
 * Get current nonce for an address
 */
router.get('/nonce/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid address format'
      });
    }

    const nonce = await relayerService.getNonce(address);
    
    return res.json({
      success: true,
      nonce
    });
  } catch (error) {
    console.error('Error fetching nonce:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch nonce'
    });
  }
});

/**
 * GET /api/meta-tx/gas-costs
 * Get gas cost statistics for authenticated user
 */
router.get('/gas-costs', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const userId = req.user.id;

    let query = `
      SELECT 
        tx_hash,
        from_address,
        to_address,
        gas_used,
        gas_price,
        gas_cost_matic,
        gas_cost_usd,
        status,
        created_at,
        confirmed_at
      FROM meta_transactions
      WHERE user_id = $1
    `;
    const params = [userId];

    if (startDate) {
      params.push(startDate);
      query += ` AND created_at >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND created_at <= $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    // Calculate totals
    const totals = await pool.query(
      `SELECT 
        SUM(gas_used) as total_gas_used,
        SUM(gas_cost_matic) as total_cost_matic,
        SUM(gas_cost_usd) as total_cost_usd,
        COUNT(*) as transaction_count
      FROM meta_transactions
      WHERE user_id = $1 AND status = 'confirmed'
      ${startDate ? 'AND created_at >= $2' : ''}
      ${endDate ? `AND created_at <= $${startDate ? 3 : 2}` : ''}`,
      startDate && endDate ? [userId, startDate, endDate] :
      startDate ? [userId, startDate] :
      endDate ? [userId, endDate] :
      [userId]
    );

    return res.json({
      success: true,
      transactions: result.rows,
      summary: {
        totalGasUsed: totals.rows[0].total_gas_used || '0',
        totalCostMatic: parseFloat(totals.rows[0].total_cost_matic || 0).toFixed(6),
        totalCostUsd: parseFloat(totals.rows[0].total_cost_usd || 0).toFixed(2),
        transactionCount: parseInt(totals.rows[0].transaction_count || 0)
      }
    });
  } catch (error) {
    console.error('Error fetching gas costs:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch gas costs'
    });
  }
});

module.exports = router;
