const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const quotationController = require('../controllers/quotationController');

// All quotation routes require the user to be authenticated
router.use(authenticateToken);

// Create a new quotation (works for both buyer and seller)
router.post('/', quotationController.createQuotation);

// Get all quotations for the current user (used by Seller Dashboard)
router.get('/', quotationController.getQuotations);

// --- NEW ROUTE FOR BUYER DASHBOARD ---
// Get only quotations waiting for the current buyer's approval
router.get('/pending-for-buyer', quotationController.getPendingBuyerApprovals);

// Seller's action to approve a buyer's request
router.post('/:id/seller-approve', quotationController.sellerApproveQuotation);

// Buyer's action to approve a seller's offer
router.post('/:id/buyer-approve', quotationController.buyerApproveQuotation);

// Either party rejects a quotation
router.post('/:id/reject', quotationController.rejectQuotation);


module.exports = router;