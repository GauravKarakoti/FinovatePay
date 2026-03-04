const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const {
  runReconciliation,
  getReconciliationStatus,
  getDiscrepancies,
  getReconciliationHistory
} = require('../services/reconciliationService');
const errorResponse = require('../utils/errorResponse');

// All reconciliation routes require authentication
router.use(authenticateToken);
router.use(requireKYC);

/**
 * GET /api/reconciliation/status
 * Get reconciliation status (latest run)
 */
router.get('/status', requireRole(['admin', 'auditor']), async (req, res) => {
  try {
    const status = await getReconciliationStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('[Reconciliation] Error getting status:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/reconciliation/run
 * Manually trigger a reconciliation run
 */
router.post('/run', requireRole(['admin']), async (req, res) => {
  try {
    const { batchSize } = req.body;
    const reconciliationType = 'manual';
    
    // Validate batch size if provided
    const validBatchSize = batchSize && typeof batchSize === 'number' 
      ? Math.min(Math.max(batchSize, 1), 200) // Min 1, max 200
      : 50; // Default

    console.log(`[Reconciliation] Manual reconciliation triggered by user: ${req.user.id}`);

    // Run reconciliation in background to not block response
    // But return immediately with run ID
    const result = await runReconciliation(reconciliationType, validBatchSize);

    res.json({
      success: true,
      message: 'Reconciliation started',
      data: {
        runId: result.runId,
        status: result.status,
        summary: result.summary
      }
    });
  } catch (error) {
    console.error('[Reconciliation] Error running reconciliation:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/reconciliation/discrepancies
 * Get discrepancies with optional filters
 */
router.get('/discrepancies', requireRole(['admin', 'auditor']), async (req, res) => {
  try {
    const { limit, offset, type } = req.query;
    
    // Parse and validate query params
    const validLimit = limit ? Math.min(parseInt(limit, 10), 100) : 100;
    const validOffset = offset ? parseInt(offset, 10) : 0;
    
    // Validate type if provided
    const validTypes = ['none', 'amount_mismatch', 'status_mismatch', 'missing_chain', 'missing_db', 'error'];
    const validType = type && validTypes.includes(type) ? type : null;

    const result = await getDiscrepancies(validLimit, validOffset, validType);

    res.json({
      success: true,
      data: {
        discrepancies: result.discrepancies,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.discrepancies.length < result.total
        }
      }
    });
  } catch (error) {
    console.error('[Reconciliation] Error getting discrepancies:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/reconciliation/history
 * Get reconciliation run history
 */
router.get('/history', requireRole(['admin', 'auditor']), async (req, res) => {
  try {
    const { limit, offset } = req.query;
    
    // Parse and validate query params
    const validLimit = limit ? Math.min(parseInt(limit, 10), 50) : 10;
    const validOffset = offset ? parseInt(offset, 10) : 0;

    const result = await getReconciliationHistory(validLimit, validOffset);

    res.json({
      success: true,
      data: {
        runs: result.runs,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.runs.length < result.total
        }
      }
    });
  } catch (error) {
    console.error('[Reconciliation] Error getting history:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/reconciliation/invoice/:invoiceId
 * Get reconciliation details for a specific invoice
 */
router.get('/invoice/:invoiceId', requireRole(['admin', 'auditor', 'buyer', 'seller']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { pool } = require('../config/database');

    // Get all reconciliation logs for this invoice
    const query = `
      SELECT 
        invoice_id,
        chain_status,
        db_status,
        chain_amount,
        db_amount,
        discrepancy_amount,
        discrepancy_type,
        chain_buyer,
        db_buyer,
        chain_seller,
        db_seller,
        reconciliation_type,
        run_id,
        notes,
        created_at
      FROM reconciliation_logs
      WHERE invoice_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const result = await pool.query(query, [invoiceId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          invoiceId,
          hasReconciliationData: false,
          message: 'No reconciliation data found for this invoice'
        }
      });
    }

    res.json({
      success: true,
      data: {
        invoiceId,
        hasReconciliationData: true,
        records: result.rows
      }
    });
  } catch (error) {
    console.error('[Reconciliation] Error getting invoice details:', error);
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;
