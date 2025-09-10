const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const Invoice = require('../models/Invoice');
const { createInvoice } = require('../controllers/invoiceController');
const pool = require("../config/database");

// All invoice routes require authentication
router.use(authenticateToken);

// Create a new invoice
router.post('/', requireKYC, async (req, res) => {
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

// Get buyer's invoices
router.get('/buyer', async (req, res) => {
  try {
    console.log("Buyer:",req.user.wallet_address)
    const invoices = await Invoice.findByBuyer(req.user.wallet_address);
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

router.post('/:invoice_id/status', requireKYC, async (req, res) => {
    try {
        const { invoice_id } = req.params;
        // For 'shipped' status, tx_hash will contain the proof hash (e.g., IPFS CID)
        const { status, tx_hash } = req.body;

        // 1. Add 'shipped' to the list of allowed statuses
        const allowedStatus = ['deposited', 'released', 'disputed', 'shipped'];
        if (!allowedStatus.includes(status)) {
            return res.status(400).json({ error: 'Invalid status provided.' });
        }

        let query, values;

        // 2. Handle different DB updates based on the status
        if (status === 'released') {
            query = `UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        } else if (status === 'shipped') {
            // Store the proof hash in the new 'shipment_proof_hash' column
            query = `UPDATE invoices SET escrow_status = $1, shipment_proof_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        } else { // 'deposited' or 'disputed'
            query = `UPDATE invoices SET escrow_status = $1, escrow_tx_hash = $2 WHERE invoice_id = $3 RETURNING *`;
            values = [status, tx_hash, invoice_id];
        }
        
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found.' });
        }
        
        const io = req.app.get('io');
        const updatedInvoice = result.rows[0];
        
        // Notify both parties about the update
        io.to(`user-${updatedInvoice.seller_id}`).emit('invoice-update', updatedInvoice);
        io.to(`user-${updatedInvoice.buyer_id}`).emit('invoice-update', updatedInvoice);

        res.json({ success: true, invoice: updatedInvoice });
    } catch (error) {
        console.error(`Error updating status for invoice ${req.params.invoice_id}:`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;