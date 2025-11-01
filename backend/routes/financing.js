const express = require('express');
const router = express.Router();
// FIX: Destructure authenticateToken from the auth middleware
const { authenticateToken } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const pool = require('../config/database');
const { emitToMarketplace } = require('../socket');

// @route   POST /api/financing/tokenize
// @desc    Seller requests to tokenize a verified invoice
// @access  Private (Seller)
// FIX: Use the 'authenticateToken' function as middleware, not the 'auth' object
router.post('/tokenize', authenticateToken, async (req, res) => {
    try {
        const { invoiceId, faceValue, maturityDate } = req.body;
        const sellerId = req.user.id;

        // 1. Verify invoice exists and belongs to the seller
        const invoice = await Invoice.findById(invoiceId);
        const seller = await User.findById(sellerId);

        if (!invoice) {
            return res.status(404).json({ msg: 'Invoice not found' });
        }
        
        // Check if the authenticated user is the seller of this invoice
        if (invoice.seller_address !== seller.wallet_address) {
            return res.status(401).json({ msg: 'User not authorized to tokenize this invoice' });
        }

        // 2. Check for KYC and invoice status (e.g., must be 'approved' or 'funded_in_escrow')
        if (seller.kyc_status !== 'verified') {
             return res.status(400).json({ msg: 'Seller must be KYC verified to tokenize' });
        }
        if (invoice.escrow_status !== 'funded') {
             return res.status(400).json({ msg: 'Invoice must be funded in escrow to be tokenized' });
        }
        if (invoice.is_tokenized) {
            return res.status(400).json({ msg: 'Invoice already tokenized' });
        }

        // 3. --- WEB3 INTERACTION ---
        // Call the FractionToken.sol contract's tokenizeInvoice function
        // This requires: _invoiceId (as bytes32), _totalSupply, _faceValue, _maturityDate, _issuer
        
        // For simplicity, we assume totalSupply is the faceValue (e.g., 1000 tokens for $1000)
        const totalSupply = faceValue; 
        const issuerAddress = seller.wallet_address;
        
        /*
        const web3 = require('../config/blockchain'); // Assume web3 is configured
        const fractionToken = new web3.eth.Contract(FractionTokenABI, fractionTokenAddress);
        
        // The backend admin/owner account calls the contract
        const gas = await fractionToken.methods.tokenizeInvoice(
            invoice.invoice_hash, // Using invoice_hash as bytes32 ID
            totalSupply,
            faceValue,
            maturityDate,
            issuerAddress
        ).estimateGas({ from: process.env.ADMIN_WALLET_ADDRESS });

        const tx = await fractionToken.methods.tokenizeInvoice(
            invoice.invoice_hash,
            totalSupply,
            faceValue,
            maturityDate,
            issuerAddress
        ).send({ from: process.env.ADMIN_WALLET_ADDRESS, gas });

        const tokenId = tx.events.Tokenized.returnValues.tokenId;
        */
        
        // --- MOCKUP for testing without live contract ---
        console.log(`Simulating tokenization for invoice ${invoiceId}`);
        const MOCK_TOKEN_ID = Math.floor(Math.random() * 1000) + 1;
        // --- End Mockup ---

        // 4. Update database with tokenization details
        const financingStatus = 'listed'; // 'listed' means it's on the marketplace
        const updatedInvoice = await Invoice.updateTokenizationStatus(
            invoiceId, 
            MOCK_TOKEN_ID, // Use `tokenId` from the tx receipt in production
            financingStatus
        );

        // 5. Emit to marketplace via Socket.IO
        const io = req.app.get('io');
        emitToMarketplace(io, 'new-listing', updatedInvoice);

        res.json(updatedInvoice);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/financing/marketplace
// @desc    Get all tokenized invoices listed for financing
// @access  Private (Authenticated users, esp. Investors)
// FIX: Use the 'authenticateToken' function as middleware
router.get('/marketplace', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM invoices WHERE financing_status = 'listed' ORDER BY created_at DESC"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/financing/:invoiceId
// @desc    Get details for a single tokenized invoice
// @access  Private
// FIX: Use the 'authenticateToken' function as middleware
router.get('/:invoiceId', authenticateToken, async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.invoiceId);
        if (!invoice || !invoice.is_tokenized) {
            return res.status(404).json({ msg: 'Tokenized invoice not found' });
        }
        
        // TODO: In a real app, you would also fetch on-chain data
        // e.g., remainingSupply from FractionToken.sol
        // const remainingSupply = await fractionToken.methods.tokenDetails(invoice.token_id).call();

        res.json({
            ...invoice,
            // mock remaining supply
            remaining_supply: Math.floor(Math.random() * invoice.amount) 
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;