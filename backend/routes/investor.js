const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const pool = require('../config/database'); // Added for portfolio query
const { getSigner, getFractionTokenContract } = require('../config/blockchain');

const signer = getSigner();
const fractionToken = getFractionTokenContract(signer);

// Middleware to check for 'investor' role
const isInvestor = (req, res, next) => {
    console.log("Request user:", req.user);
    console.log(`Checking investor role for user: ${req.user.wallet_address} with role: ${req.user.role}`);
    if (req.user.role !== 'investor' && req.user.role !== 'admin') {
        console.log('Access denied. User is not an investor.');
        return res.status(403).json({ msg: 'Access denied. Investor role required.' });
    }
    next();
};

// @route   POST /api/investor/buy-tokens
// @desc    Investor buys fractions of a tokenized invoice
// @access  Private (Investor)
router.post('/buy-tokens', authenticateToken, isInvestor, async (req, res) => {
    const { invoiceId, amountToInvest } = req.body;
    // FIX: Get walletAddress from req.user (based on auth.js and isInvestor middleware)
    const investorWallet = req.user.wallet_address; 

    try {
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice || invoice.financing_status !== 'listed') {
            return res.status(404).json({ msg: 'Invoice not available for investment' });
        }

        const tokenId = invoice.token_id;
        // amountToInvest is the $ amount. We assume 1 token = $1 for simplicity.
        const tokenAmount = amountToInvest; 

        // 1. --- WEB3 INTERACTION ---
        // The backend would facilitate this.
        // a. Investor approves stablecoin spending by our contract.
        // b. Investor calls our 'buyTokens' function (which needs to be built).
        // c. 'buyTokens' transfers stablecoin from investor to seller.
        // d. 'buyTokens' transfers/mints ERC-1155 tokens from seller to investor.
        
        /*
        // This is a complex flow. A simpler one:
        // 1. Investor sends stablecoin (e.g., USDC) to the contract.
        // 2. Contract transfers FractionTokens from seller to investor.
        // 3. Contract transfers stablecoin to seller.
        
        // This logic would be triggered by the frontend,
        // but the backend needs to validate and record the transaction.
        */

        console.log(`Simulating purchase: Investor ${investorWallet} buying ${tokenAmount} tokens for invoice ${invoiceId} (Token ID: ${tokenId})`);

        // 2. Update database (e.g., create a record in an 'investments' table)
        // For now, we'll just log it. A new table `investments` would be better.
        // e.g., INSERT INTO investments (user_id, token_id, amount) ...

        // 3. Potentially update the invoice's remaining supply (if tracked off-chain)
        // Or, this could be purely an on-chain read.
        
        // 4. Emit socket event for marketplace update (supply changed)
        const io = req.app.get('io');
        io.to('marketplace').emit('investment-made', { invoiceId, newSupply: "mock_new_supply" });


        res.json({ msg: 'Investment successful (simulation)', invoiceId, tokenAmount });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   GET /api/investor/portfolio
// @desc    Get the investing portfolio for the logged-in investor
// @access  Private (Investor)
router.get('/portfolio', authenticateToken, isInvestor, async (req, res) => {
    console.log(`Fetching portfolio for investor: ${req.user.wallet_address}`);
    try {
        // --- WEB3 INTERACTION ---
        // This is crucial. You'd need to query the FractionToken contract
        // to see which token IDs this investor (req.user.walletAddress) owns
        // and in what quantity.

        // You'd need a list of all possible token IDs (from the 'invoices' table)
        const tokenIdsResult = await pool.query("SELECT token_id, id FROM invoices WHERE is_tokenized = TRUE AND token_id IS NOT NULL");
        
        if (tokenIdsResult.rows.length === 0) {
            return res.json([]); // No tokenized invoices exist yet
        }

        const tokenIds = tokenIdsResult.rows.map(r => r.token_id);
        const invoiceIdMap = tokenIdsResult.rows.reduce((map, obj) => {
            map[obj.token_id] = obj.id;
            return map;
        }, {});

        const investorWallet = req.user.wallet_address;

        // Create an array of wallet addresses, one for each token ID
        const wallets = Array(tokenIds.length).fill(investorWallet);

        // Check balances for all tokens at once
        const balances = await fractionToken.balanceOfBatch(wallets, tokenIds).call();

        const portfolio = [];
        for (let i = 0; i < tokenIds.length; i++) {
            const balance = balances[i].toString(); // Balances are often returned as strings or BigNumbers
            if (balance > 0) {
                // Find the original invoice details from the database
                const invoice = await Invoice.findById(invoiceIdMap[tokenIds[i]]);
                if (invoice) {
                    portfolio.push({
                        invoice: invoice, // Contains all invoice details (amount, maturity_date, etc.)
                        tokens_owned: balance,
                        token_id: tokenIds[i]
                    });
                }
            }
        }
        res.json(portfolio);
        
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   POST /api/investor/redeem-tokens
// @desc    Investor redeems tokens for a matured invoice
// @access  Private (Investor)
router.post('/redeem-tokens', authenticateToken, isInvestor, async (req, res) => {
    const { tokenId, amount } = req.body;
    const investorWallet = req.user.wallet_address; // Corrected from walletAddress

    try {
        // 1. --- WEB3 INTERACTION ---
        // Call the 'redeem' function on FractionToken.sol
        
        // Ensure contract instance is ready
        if (!fractionToken) {
            return res.status(500).json({ msg: 'Blockchain service not initialized' });
        }

        console.log(`Attempting redeem: Investor ${investorWallet} redeeming ${amount} tokens of Token ID ${tokenId}`);

        const gas = await fractionToken.redeem(tokenId, amount)
            .estimateGas({ from: investorWallet });

        const tx = await fractionToken.redeem(tokenId, amount)
            .send({ from: investorWallet, gas });
        
        // Get redemption value from the event emitted by the contract
        const redemptionValue = tx.events.Redeemed.returnValues.amount;
        
        // 2. Update database (e.g., update the 'investments' table)
        // This step is crucial for tracking.
        // e.g., UPDATE investments SET amount = amount - ${amount} WHERE user_id = ${req.user.id} AND token_id = ${tokenId}
        // e.g., INSERT INTO redemptions (user_id, token_id, redeemed_amount, paid_amount) ...
        console.log(`Redemption successful. Tx: ${tx.transactionHash}. Value: ${redemptionValue}`);


        res.json({ 
            msg: 'Tokens redeemed successfully', 
            redeemed_value: redemptionValue,
            txHash: tx.transactionHash
        });

    } catch (err) {
        console.error(err.message);
        // Handle common contract errors
        if (err.message.includes("Invoice not matured")) {
            return res.status(400).json({ msg: 'Redemption failed: Invoice has not matured yet.' });
        }
        if (err.message.includes("Not enough tokens")) {
            return res.status(400).json({ msg: 'Redemption failed: Insufficient token balance.' });
        }
        if (err.message.includes("reverted")) {
             return res.status(400).json({ msg: 'Transaction failed. Check contract conditions (e.g., maturity, funds).' });
        }
        res.status(500).send('Server Error');
    }
});

module.exports = router;