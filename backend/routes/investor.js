const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const Invoice = require('../models/Invoice');
const pool = require('../config/database');

// Middleware to check for 'investor' role
const isInvestor = (req, res, next) => {
    if (req.user.role !== 'investor' && req.user.role !== 'admin') {
        return res.status(403).json({ msg: 'Access denied. Investor role required.' });
    }
    next();
};

// @route   POST /api/investor/buy-tokens
// @desc    Investor buys fractions of a tokenized invoice
// @access  Private (Investor)
router.post('/buy-tokens', authenticateToken, isInvestor, async (req, res) => {
    const { invoiceId, amountToInvest } = req.body;
    const investorWallet = req.user.walletAddress;

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
    try {
        // --- WEB3 INTERACTION ---
        // This is crucial. You'd need to query the FractionToken contract
        // to see which token IDs this investor (req.user.walletAddress) owns
        // and in what quantity.

        /*
        const web3 = require('../config/blockchain');
        const fractionToken = new web3.eth.Contract(FractionTokenABI, fractionTokenAddress);
        
        // You'd need a list of all possible token IDs (from the 'invoices' table)
        const tokenIdsResult = await pool.query("SELECT token_id FROM invoices WHERE is_tokenized = TRUE");
        const tokenIds = tokenIdsResult.rows.map(r => r.token_id);
        const investorWallet = req.user.walletAddress;

        // Create an array of wallet addresses, one for each token ID
        const wallets = Array(tokenIds.length).fill(investorWallet);

        // Check balances for all tokens at once
        const balances = await fractionToken.methods.balanceOfBatch(wallets, tokenIds).call();

        const portfolio = [];
        for (let i = 0; i < tokenIds.length; i++) {
            if (balances[i] > 0) {
                const invoice = await Invoice.findOne({ where: { token_id: tokenIds[i] } });
                portfolio.push({
                    invoice: invoice,
                    tokensOwned: balances[i],
                    tokenId: tokenIds[i]
                });
            }
        }
        res.json(portfolio);
        */

        // --- MOCKUP for testing ---
        const mockPortfolio = [
            { invoice_id: 'mock-inv-123', token_id: 1, amount: 1000, face_value: 1000, maturity_date: '2025-12-01', tokens_owned: 250, status: 'listed' },
            { invoice_id: 'mock-inv-456', token_id: 2, amount: 5000, face_value: 5000, maturity_date: '2026-01-15', tokens_owned: 1000, status: 'listed' }
        ];
        res.json(mockPortfolio);
        // --- End Mockup ---

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
    const investorWallet = req.user.walletAddress;

    try {
        // 1. --- WEB3 INTERACTION ---
        // Call the 'redeem' function on FractionToken.sol
        
        /*
        const web3 = require('../config/blockchain');
        const fractionToken = new web3.eth.Contract(FractionTokenABI, fractionTokenAddress);

        const gas = await fractionToken.methods.redeem(tokenId, amount)
            .estimateGas({ from: investorWallet });

        const tx = await fractionToken.methods.redeem(tokenId, amount)
            .send({ from: investorWallet, gas });
        
        const redemptionValue = tx.events.Redeemed.returnValues.amount;
        */

        // --- MOCKUP for testing ---
        console.log(`Simulating redeem: Investor ${investorWallet} redeeming ${amount} tokens of Token ID ${tokenId}`);
        const MOCK_REDEMPTION_VALUE = amount; // In a real scenario, this is (amount * faceValue) / totalSupply
        // --- End Mockup ---

        // 2. Update database (e.g., update the 'investments' table)
        // ...

        res.json({ 
            msg: 'Tokens redeemed successfully (simulation)', 
            redeemed_value: MOCK_REDEMPTION_VALUE 
        });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;