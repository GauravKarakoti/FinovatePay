const express = require('express');
const router = express.Router();
const bridgeService = require('../services/bridgeService');
const { authenticateToken } = require('../middleware/auth');
const kycValidation = require('../middleware/kycValidation');
const { getFractionTokenContract } = require('../utils/web3');
const pool = require('../config/database');
const { ethers } = require('ethers');

// Request financing using Katana liquidity
router.post('/request', authenticateToken, kycValidation, async (req, res) => {
    try {
        const { invoiceId, amount, asset, collateralTokenId } = req.body;
        const userId = req.user.id;

        // Validate invoice and user
        // ... (existing validation logic)

        // Bridge collateral to Katana if needed
        const bridgeResult = await bridgeService.bridgeToKatana(collateralTokenId, amount, userId);

        // Borrow from Katana liquidity
        const borrowResult = await bridgeService.borrowFromKatana(asset, amount, collateralTokenId);

        // Record financing in DB
        // ... (existing DB logic)

        res.json({
            success: true,
            message: 'Financing request submitted',
            borrowResult
        });
    } catch (error) {
        console.error('Financing request failed:', error);
        res.status(500).json({ error: 'Financing request failed' });
    }
});

// Get liquidity rates
router.get('/rates/:asset', authenticateToken, async (req, res) => {
    try {
        const { asset } = req.params;
        const rates = await bridgeService.getLiquidityRates(asset);
        res.json(rates);
    } catch (error) {
        console.error('Get rates failed:', error);
        res.status(500).json({ error: 'Failed to get rates' });
    }
});

// Repay financing
router.post('/repay', authenticateToken, kycValidation, async (req, res) => {
    try {
        const { financingId, amount, asset } = req.body;

        // Validate repayment
        // ... (existing validation)

        // Repay to Katana
        const repayResult = await bridgeService.repayToKatana(asset, amount);

        // Update DB
        // ... (existing DB logic)

        res.json({
            success: true,
            message: 'Repayment successful',
            repayResult
        });
    } catch (error) {
        console.error('Repayment failed:', error);
        res.status(500).json({ error: 'Repayment failed' });
    }
});

// Tokenize invoice
router.post('/tokenize', authenticateToken, kycValidation, async (req, res) => {
    try {
        const { invoiceId, faceValue, maturityDate, yieldBps } = req.body;
        const userId = req.user.id;

        // Validate invoice exists and belongs to user
        const invoiceQuery = await pool.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_id = $2',
            [invoiceId, userId]
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found or not owned by user' });
        }

        const invoice = invoiceQuery.rows[0];

        if (invoice.is_tokenized) {
            return res.status(400).json({ error: 'Invoice already tokenized' });
        }

        // Get FractionToken contract
        const contract = await getFractionTokenContract();

        // Convert maturity date to timestamp
        const maturityTimestamp = Math.floor(new Date(maturityDate).getTime() / 1000);

        // Convert invoiceId to bytes32
        const bytes32InvoiceId = ethers.zeroPadValue(ethers.toUtf8Bytes(invoiceId), 32);

        // Calculate total supply (faceValue in wei)
        const totalSupply = ethers.parseUnits(faceValue.toString(), 18);

        // Call tokenizeInvoice
        const tx = await contract.tokenizeInvoice(
            bytes32InvoiceId,
            totalSupply,
            totalSupply, // faceValue
            maturityTimestamp,
            req.user.wallet_address, // issuer
            yieldBps // yield in bps
        );

        const receipt = await tx.wait();
        const event = receipt.events?.find(e => e.event === 'Tokenized');

        if (!event) throw new Error("Tokenized event not found");

        const tokenId = event.args.tokenId;

        // Update database
        await pool.query(
            'UPDATE invoices SET token_id = $1, financing_status = $2, is_tokenized = true, yield_bps = $3 WHERE invoice_id = $4',
            [tokenId.toString(), 'listed', yieldBps, invoiceId]
        );

        res.json({
            success: true,
            message: 'Invoice tokenized successfully',
            tokenId: tokenId.toString(),
            yieldBps
        });
    } catch (error) {
        console.error('Tokenization failed:', error);
        res.status(500).json({ error: 'Tokenization failed' });
    }
});

module.exports = router;
