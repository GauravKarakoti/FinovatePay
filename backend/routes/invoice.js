const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const Invoice = require('../models/Invoice');
const { pool } = require("../config/database");
const { syncInvoiceStatus } = require('../services/escrowSyncService');

// --- UPDATED IMPORT ---
// Import the new functions you added to the controller
const { 
  createInvoice, 
  getEarlyPaymentOffer, 
  settleInvoiceEarly 
} = require('../controllers/invoiceController');

// All invoice routes require authentication
router.use(authenticateToken);

// Create a new invoice
router.post('/', requireKYC, async (req, res) => {
  console.log("Creating invoice with data:", req.body);
  await createInvoice(req, res);
});

// Get seller's invoices
router.get('/seller', async (req, res) => {
  try {
    const invoices = await Invoice.findBySeller(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync invoice status from blockchain
router.post('/:id/sync', async (req, res) => {
  try {
    await syncInvoiceStatus(req.params.id);
    const invoice = await Invoice.findById(req.params.id);
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get buyer's invoices
router.get('/buyer', async (req, res) => {
  try {
    console.log("Buyer:", req.user.wallet_address);
    const invoices = await Invoice.findByBuyer(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- NEW DYNAMIC DISCOUNTING ROUTES ---

// 1. Get Early Payment Offer (Check discount details)
// Note: using :invoiceId to match controller param
router.get('/:invoiceId/offer', getEarlyPaymentOffer);

// 2. Accept Early Settlement (Process payment)
// We add requireKYC here because it involves a financial transaction
router.post('/:invoiceId/settle-early', requireKYC, settleInvoiceEarly);

// --------------------------------------

// Get specific invoice
router.get('/:id', async (req, res) => {
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

// Update Invoice Status (Escrow/Shipping/Dispute)
router.post('/:invoice_id/status', requireKYC, async (req, res) => {
    try {
        const { invoice_id } = req.params;
        const { status, tx_hash, dispute_reason } = req.body;
        console.log(`Updating status for invoice ${invoice_id} to ${status} with tx_hash ${tx_hash}`);

        const allowedStatus = ['deposited', 'released', 'disputed', 'shipped'];
        if (!allowedStatus.includes(status)) {
            return res.status(400).json({ error: 'Invalid status provided.' });
        }

        let query, values;

        if (status === 'released') {
            query = `UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        } else if (status === 'shipped') {
            query = `UPDATE invoices SET escrow_status = $1, shipment_proof_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        } else if (status === 'disputed') {
            query = `UPDATE invoices SET escrow_status = $1, dispute_reason = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, dispute_reason, invoice_id];
        } else { // 'deposited'
            query = `UPDATE invoices SET escrow_status = $1, escrow_tx_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        }
        
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
            console.log(`Emitted invoice-update for invoice ${invoice_id}`);
        }

        res.json({ success: true, invoice: updatedInvoice });
    } catch (error) {
        console.error(`Error updating status for invoice ${req.params.invoice_id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;