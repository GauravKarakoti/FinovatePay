const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const Invoice = require('../models/Invoice');
const { pool } = require("../config/database");
const { syncInvoiceStatus } = require('../services/escrowSyncService');
const fraudDetectionService = require('../services/fraudDetectionService');
const { 
  validateCreateInvoice, 
  validateInvoiceId, 
  validateInvoiceStatus 
} = require('../middleware/validators');

// --- UPDATED IMPORT ---
// Import the new functions you added to the controller
const { 
  createInvoice, 
  getEarlyPaymentOffer, 
  settleInvoiceEarly 
} = require('../controllers/invoiceController');

// All invoice routes require authentication
router.use(authenticateToken);

const runFraudGate = async ({ req, transactionType, amount, currency, invoiceId, context }) => {
  try {
    const result = await fraudDetectionService.evaluateTransactionRisk({
      userId: req.user?.id,
      walletAddress: req.user?.wallet_address,
      invoiceId,
      transactionType,
      amount,
      currency,
      context: {
        ...(context || {}),
        endpoint: req.originalUrl,
        method: req.method,
        actorRole: req.user?.role,
        kycStatus: req.user?.kyc_status || 'unknown'
      }
    });

    fraudDetectionService.ensureTransactionAllowed(result);
    return result;
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      throw error;
    }

    // Fail-open for service errors so invoice operations are not fully blocked by telemetry failures.
    console.error('[InvoiceRoutes] Fraud gate degraded:', error.message);
    return null;
  }
};

// Create a new invoice - Only sellers can create invoices
router.post('/', requireKYC, requireRole(['seller', 'admin']), validateCreateInvoice, async (req, res) => {
  try {
    const quotationId = req.body?.quotation_id;
    let amount = 0;
    let currency = 'USD';

    if (quotationId) {
      const quoteResult = await pool.query(
        'SELECT total_amount, currency FROM quotations WHERE id = $1',
        [quotationId]
      );
      if (quoteResult.rows[0]) {
        amount = quoteResult.rows[0].total_amount;
        currency = quoteResult.rows[0].currency || currency;
      }
    }

    const risk = await runFraudGate({
      req,
      transactionType: 'invoice_create',
      amount,
      currency,
      invoiceId: req.body?.invoice_id,
      context: {
        quotationId,
        contractAddress: req.body?.contract_address
      }
    });

    if (risk?.shouldReview) {
      console.warn('[InvoiceRoutes] Invoice flagged for review', {
        invoiceId: req.body?.invoice_id,
        riskScore: risk.riskScore,
        reasons: risk.reasons
      });
    }

    console.log("Creating invoice with data:", req.body);
    await createInvoice(req, res);
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      return res.status(error.statusCode || 403).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      });
    }

    console.error('[InvoiceRoutes] Error creating invoice with fraud gate:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to run invoice fraud detection checks'
    });
  }
});

// Get seller's invoices - Only accessible by sellers and admins
router.get('/seller', requireRole(['seller', 'admin']), async (req, res) => {
  try {
    const invoices = await Invoice.findBySeller(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync invoice status from blockchain
router.post('/:id/sync', validateInvoiceId, async (req, res) => {
  try {
    await syncInvoiceStatus(req.params.id);
    const invoice = await Invoice.findById(req.params.id);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get buyer's invoices - Only accessible by buyers and admins
router.get('/buyer', requireRole(['buyer', 'admin']), async (req, res) => {
  try {
    const invoices = await Invoice.findByBuyer(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- NEW DYNAMIC DISCOUNTING ROUTES ---

// 1. Get Early Payment Offer (Check discount details)
// Note: using :invoiceId to match controller param
router.get('/:invoiceId/offer', validateInvoiceId, requireRole(['buyer', 'seller', 'admin']), getEarlyPaymentOffer);

// 2. Accept Early Settlement (Process payment)
// We add requireKYC here because it involves a financial transaction
// Only buyers settle invoices
router.post('/:invoiceId/settle-early', validateInvoiceId, requireKYC, requireRole(['buyer', 'admin']), settleInvoiceEarly);

// --------------------------------------

// Get specific invoice
router.get('/:id', validateInvoiceId, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    
    // Check if user is authorized to view this invoice
    if (invoice.seller_address !== req.user.wallet_address && 
        invoice.buyer_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized to view this invoice' });
    }
    
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:invoiceId/status', validateInvoiceId, validateInvoiceStatus, requireKYC, async (req, res) => {
    try {
        const { invoiceId } = req.params; // Changed to match the route param
        const { status, tx_hash, dispute_reason } = req.body;
        console.log(`Updating status for invoice ${invoiceId} to ${status} with tx_hash ${tx_hash} and dispute_reason ${dispute_reason}`);

        // Status configuration: field to update and required parameter
        const statusConfig = {
            'released': { field: 'release_tx_hash', requiredParam: tx_hash, paramName: 'tx_hash' },
            'shipped': { field: 'shipment_proof_hash', requiredParam: tx_hash, paramName: 'tx_hash' },
            'disputed': { field: 'dispute_reason', requiredParam: dispute_reason, paramName: 'dispute_reason' },
            'deposited': { field: 'escrow_tx_hash', requiredParam: tx_hash, paramName: 'tx_hash' }
        };

        if (!statusConfig[status]) {
            return res.status(400).json({ error: 'Invalid status provided.' });
        }

        const config = statusConfig[status];

        // Validation: Ensure the required parameter for the status is present
        if (!config.requiredParam) {
            return res.status(400).json({ error: `Missing required parameter: ${config.paramName} for status ${status}.` });
        }

        const query = `UPDATE invoices SET escrow_status = $1, ${config.field} = $2 WHERE invoice_id = $3 RETURNING *`;
        const values = [status, config.requiredParam, invoiceId];
        
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found.' });
        }
        
        const updatedInvoice = result.rows[0];
        
        // Socket.io Notification
        const io = req.app.get('io');
        if (io) {
            io.to(`user-${updatedInvoice.seller_address}`).emit('invoice-update', updatedInvoice);
            io.to(`user-${updatedInvoice.buyer_address}`).emit('invoice-update', updatedInvoice);
            console.log(`Emitted invoice-update for invoice ${invoiceId}`);
        }

        res.json({ success: true, invoice: updatedInvoice });
    } catch (error) {
        console.error(`Error updating status for invoice ${req.params.invoiceId}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;