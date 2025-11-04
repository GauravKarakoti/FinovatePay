const express = require('express');
const router = express.Router();
// FIX: Destructure authenticateToken from the auth middleware
const { authenticateToken } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const pool = require('../config/database');
const { emitToMarketplace } = require('../socket');
const { getSigner, getFractionTokenContract } = require('../config/blockchain');

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

        // 2. Check for KYC and invoice status (e.g., must be 'approved' or 'deposited_in_escrow')
        if (seller.kyc_status !== 'verified') {
             return res.status(400).json({ msg: 'Seller must be KYC verified to tokenize' });
        }
        if (invoice.escrow_status !== 'deposited') {
             return res.status(400).json({ msg: 'Invoice must be deposited in escrow to be tokenized' });
        }
        if (invoice.is_tokenized) {
            return res.status(400).json({ msg: 'Invoice already tokenized' });
        }

        const totalSupply = faceValue; 
        const issuerAddress = seller.wallet_address;
        const maturityTimestamp = Math.floor(new Date(maturityDate).getTime() / 1000);

        // 2. Get the signer and contract instance
        // The signer uses the DEPLOYER_PRIVATE_KEY from .env, acting as the admin
        const signer = getSigner();
        const fractionToken = getFractionTokenContract(signer);

        console.log(`Tokenizing invoice ${invoice.id} (Hash: ${invoice.invoice_hash})`);
        
        console.log(`Parameters: totalSupply=${totalSupply}, faceValue=${faceValue}, maturity=${maturityTimestamp}, issuer=${issuerAddress}`);
        const tx = await fractionToken.tokenizeInvoice(
            invoice.invoice_hash, // Using invoice_hash as bytes32 ID
            totalSupply,
            faceValue,
            maturityTimestamp,
            issuerAddress
        );

        // 4. Wait for the transaction to be mined
        const receipt = await tx.wait();

        // 5. Get the tokenId from the transaction receipt logs
        // Find the 'Tokenized' event in the receipt
        const tokenizedEvent = receipt.logs
            .map(log => {
                try {
                    return fractionToken.interface.parseLog(log);
                } catch (e) {
                    return null;
                }
            })
            .find(event => event?.name === 'Tokenized');

        if (!tokenizedEvent) {
            throw new Error("Tokenized event not found in transaction receipt.");
        }

        const tokenId = tokenizedEvent.args.tokenId;
        
        console.log(`Tokenization successful. Token ID: ${tokenId}, Tx: ${tx.hash}`);

        // 6. Update database
        const financingStatus = 'listed';
        const updatedInvoice = await Invoice.updateTokenizationStatus(
            invoiceId, 
            tokenId.toString(), // Convert BigNumber to string
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
        // --- THIS IS THE KEY ---
        // Ensure your query selects 'remaining_supply'
        const query = `
            SELECT * FROM invoices 
            WHERE financing_status = 'listed' 
            AND remaining_supply > 0
            ORDER BY created_at DESC
        `;
        const result = await pool.query(query);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Failed to fetch marketplace listings:', error);
        res.status(500).json({ msg: 'Server error' });
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
        
        let remaining_supply = 0;
        
        // 7. Update contract call in GET route
        // Get a read-only instance of the contract
        const fractionToken = getFractionTokenContract(); 
        
        if (invoice.token_id) {
             // Use ethers.js syntax (no .methods or .call())
            const sellerBalance = await fractionToken.balanceOf(invoice.seller_address, invoice.token_id);
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