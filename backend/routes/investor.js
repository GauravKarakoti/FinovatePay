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
    // Get walletAddress and user ID from the authenticated user
    const investorWallet = req.user.wallet_address; 
    const investorId = req.user.id; // Added: Get numeric ID for foreign key
    
    // --- FIX: Get the signer's address (the server's wallet) ---
    let platformWallet;
    try {
        platformWallet = await signer.getAddress(); // Ethers.js
    } catch (e) {
        platformWallet = signer.address; // Web3.js / Truffle
    }

    try {
        const invoice = await Invoice.findById(invoiceId);
        if (!invoice || invoice.financing_status !== 'listed') {
            return res.status(404).json({ msg: 'Invoice not available for investment' });
        }

        const tokenId = invoice.token_id;
        
        // --- FIX: Convert decimal string to a whole number (BigInt) string ---
        // The error "invalid BigNumberish string" means the contract
        // cannot accept "0.001" as a token amount. It expects a whole number.
        // We assume 1 token = $1 and tokens are indivisible (no decimals).
        
        let tokenAmount; // This will be our final, clean, integer string
        try {
            const floatAmount = parseFloat(amountToInvest);
            if (isNaN(floatAmount)) {
                throw new Error('Not a valid number.');
            }

            // We round to the nearest whole token. You could also use Math.floor()
            const intAmount = Math.round(floatAmount);

            if (intAmount <= 0) {
                return res.status(400).json({ msg: `Investment amount (${amountToInvest}) is too small. Must invest at least 1 token.` });
            }

            // Convert the valid integer back to a string for the contract library
            tokenAmount = intAmount.toString();

        } catch (e) {
            return res.status(400).json({ msg: 'Invalid investment amount format. Must be a whole number.' });
        }
        // --- END FIX ---

        // 1. --- WEB3 INTERACTION ---
        console.log(`Transferring ${tokenAmount} of token ${tokenId} from ${platformWallet} to ${investorWallet}`);
        
        const tx = await fractionToken.safeTransferFrom(
            platformWallet,  // from (the platform)
            investorWallet,  // to (the investor)
            tokenId,         // id (the token ID)
            tokenAmount,     // amount (NOW A WHOLE NUMBER STRING)
            "0x"             // data (empty)
        );
        
        console.log(`On-chain transfer successful. Tx: ${tx.hash || tx.transactionHash}`);

        // 2. Update database - Create a record in the 'investments' table.
        console.log(`Recording investment: Investor ${investorId} buying ${tokenAmount} tokens for invoice ${invoiceId} (Token ID: ${tokenId})`);
        
        const investmentQuery = `
            INSERT INTO investments (user_id, invoice_id, token_id, amount_invested, tokens_bought, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'completed', NOW())
            RETURNING *;
        `;
        
        // --- FIX: Use the rounded tokenAmount for BOTH amount_invested and tokens_bought ---
        // This keeps the 1 token = $1 logic clean in the database.
        const values = [investorId, invoiceId, tokenId, tokenAmount, tokenAmount];
        
        const { rows } = await pool.query(investmentQuery, values);
        const newInvestment = rows[0];

        // 3. Potentially update the invoice's remaining supply (if tracked off-chain)
        // (No change here)
        
        // 4. Emit socket event for marketplace update (supply changed)
        const io = req.app.get('io');
        io.to('marketplace').emit('investment-made', { 
            invoiceId, 
            tokensBought: tokenAmount,
            investorWallet
        });

        res.json({ msg: 'Investment successful', investment: newInvestment });

    } catch (err) {
        console.error(err.message);
        // Handle potential blockchain errors
        if (err.message.includes("transfer to non ERC1155Receiver implementer")) {
             return res.status(400).json({ msg: 'Blockchain Error: Investor wallet cannot receive tokens.' });
        }
        if (err.message.includes("insufficient balance for transfer")) {
            return res.status(500).json({ msg: 'Platform Error: Not enough tokens in treasury to sell.' });
        }
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
        const balances = await fractionToken.balanceOfBatch(wallets, tokenIds);

        const portfolio = [];
        for (let i = 0; i < tokenIds.length; i++) {
            // Note: Balances from ethers.js are BigNumbers, web3.js returns strings.
            // .toString() works for both.
            const balance = balances[i].toString(); 
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
        // Ensure contract instance is ready
        if (!fractionToken) {
            return res.status(500).json({ msg: 'Blockchain service not initialized' });
        }

        console.log(`Attempting redeem: Investor ${investorWallet} redeeming ${amount} tokens of Token ID ${tokenId}`);

        const gas = await fractionToken.redeem(tokenId, amount)
            .estimateGas({ from: investorWallet });

        const tx = await fractionToken.redeem(tokenId, amount)
            .send({ from: investorWallet, gas });
        
        const redemptionValue = tx.events.Redeemed.returnValues.amount;
        
        // 2. Update database (e.g., update the 'investments' table)
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