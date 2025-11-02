const express = require('express');
const router = express.Router();
// FIX: Destructure authenticateToken from the auth middleware
const { authenticateToken } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const pool = require('../config/database');
const { emitToMarketplace } = require('../socket');
const { web3, fractionToken, fractionTokenAddress, FractionTokenABI } = require('../config/blockchain'); // Assumed imports for Web3 logic

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
        
        // Convert JS date to Unix timestamp (seconds) for Solidity
        const maturityTimestamp = Math.floor(new Date(maturityDate).getTime() / 1000);

        // Ensure contract instance is ready
        if (!fractionToken) {
            return res.status(500).json({ msg: 'Blockchain service not initialized' });
        }
        
        // The backend admin/owner account calls the contract
        const adminWallet = process.env.ADMIN_WALLET_ADDRESS;
        if (!adminWallet) {
            return res.status(500).json({ msg: 'Admin wallet not configured for tokenization' });
        }

        console.log(`Tokenizing invoice ${invoice.id} (Hash: ${invoice.invoice_hash})`);
        
        const gas = await fractionToken.methods.tokenizeInvoice(
            invoice.invoice_hash, // Using invoice_hash as bytes32 ID
            totalSupply,
            faceValue,
            maturityTimestamp, // Pass timestamp
            issuerAddress
        ).estimateGas({ from: adminWallet });

        const tx = await fractionToken.methods.tokenizeInvoice(
            invoice.invoice_hash,
            totalSupply,
            faceValue,
            maturityTimestamp,
            issuerAddress
        ).send({ from: adminWallet, gas });

        // Get the new tokenId from the event
        const tokenId = tx.events.Tokenized.returnValues.tokenId;
        
        console.log(`Tokenization successful. Token ID: ${tokenId}, Tx: ${tx.transactionHash}`);

        // 4. Update database with tokenization details
        const financingStatus = 'listed'; // 'listed' means it's on the marketplace
        const updatedInvoice = await Invoice.updateTokenizationStatus(
            invoiceId, 
            tokenId, // Use `tokenId` from the tx receipt
            financingStatus
        );

        // 5. Emit to marketplace via Socket.IO
        const io = req.app.get('io');
        emitToMarketplace(io, 'new-listing', updatedInvoice);

        res.json(updatedInvoice);

    } catch (err) {
        console.error(err.message);
         if (err.message.includes("reverted")) {
             return res.status(400).json({ msg: 'Transaction failed. Check contract conditions (e.g., unique hash).' });
        }
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
        
        // Fetch on-chain data for remaining supply
        let remaining_supply = 0;
        if (fractionToken && invoice.token_id) {
            // We need to know the seller's (issuer's) balance of their own token
            const sellerBalance = await fractionToken.methods.balanceOf(invoice.seller_address, invoice.token_id).call();
            remaining_supply = sellerBalance.toString();
        }

        res.json({
            ...invoice,
            remaining_supply: remaining_supply 
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;