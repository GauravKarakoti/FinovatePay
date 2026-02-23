const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const Invoice = require('../models/Invoice');
const { pool } = require("../config/database");
const { syncInvoiceStatus } = require('../services/escrowSyncService');
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

// Create a new invoice - Only sellers can create invoices
router.post('/', requireKYC, requireRole(['seller', 'admin']), validateCreateInvoice, async (req, res) => {
  console.log("Creating invoice with data:", req.body);
  await createInvoice(req, res, next);
});

// Get seller's invoices - Only accessible by sellers and admins
router.get('/seller', requireRole(['seller', 'admin']), async (req, res) => {
  try {
    const invoices = await Invoice.findBySeller(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    next(error);
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
    next(error);
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
    next(error);
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
        console.error(`Error updating status for invoice ${req.params.invoice_id}:`, error);
        next(error);
    }
});

module.exports = router;