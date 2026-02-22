const express = require('express');
const router = express.Router();
const bridgeService = require('../services/bridgeService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { getFractionTokenContract } = require('../config/blockchain');
const { pool } = require('../config/database');
const { ethers } = require('ethers');
const { 
  validateFinancingRequest, 
  validateFinancingRepay, 
  validateFinancingTokenize 
} = require('../middleware/validators');

// Get marketplace listings
router.get('/marketplace', authenticateToken, async (req, res) => {
    try {
        // Fetch all invoices that have been tokenized and are listed on the marketplace
        const query = `
            SELECT 
                i.*, 
                i.amount as remaining_supply -- Aliased for the frontend to use as the max available supply
            FROM invoices i
            WHERE i.is_tokenized = true 
            AND i.financing_status = 'listed'
            ORDER BY i.created_at DESC
        `;
        
        const result = await pool.query(query);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Failed to load marketplace listings:', error);
        res.status(500).json({ error: 'Failed to load marketplace listings' });
    }
});

// Request financing using Katana liquidity
router.post('/request', authenticateToken, requireRole(['seller', 'admin']), requireKYC, validateFinancingRequest, async (req, res) => {
    try {
        const { invoiceId, amount, asset, collateralTokenId } = req.body;
        const userId = req.user.id;

        if (!invoiceId || !amount || !asset || !collateralTokenId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // 1. Validate invoice exists, belongs to user, and is eligible
        const invoiceQuery = await pool.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_id = $2',
            [invoiceId, userId]
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found or unauthorized' });
        }

        const invoice = invoiceQuery.rows[0];

        if (invoice.financing_status === 'financed' || invoice.financing_status === 'listed') {
            return res.status(400).json({ error: 'Invoice is already financed or listed' });
        }

        // 2. Bridge collateral to Katana if needed
        const bridgeResult = await bridgeService.bridgeToKatana(collateralTokenId, amount, userId);

        // 3. Borrow from Katana liquidity
        const borrowResult = await bridgeService.borrowFromKatana(asset, amount, collateralTokenId);

        // 4. Record financing in DB
        await pool.query(
            `UPDATE invoices 
             SET financing_status = 'financed', 
                 updated_at = NOW() 
             WHERE invoice_id = $1`,
            [invoiceId]
        );

        res.json({
            success: true,
            message: 'Financing request submitted successfully',
            bridgeResult,
            borrowResult
        });
    } catch (error) {
        console.error('Financing request failed:', error);
        res.status(500).json({ error: 'Financing request failed. Please try again.' });
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
router.post('/repay', authenticateToken, requireRole(['seller', 'admin']), requireKYC, validateFinancingRepay, async (req, res) => {
    try {
        const { financingId, invoiceId, amount, asset } = req.body;
        const userId = req.user.id;

        if (!amount || !asset || (!financingId && !invoiceId)) {
            return res.status(400).json({ error: 'Missing required repayment fields' });
        }

        const targetInvoiceId = invoiceId || financingId;

        // 1. Validate repayment target belongs to user and is currently financed
        const invoiceQuery = await pool.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_id = $2',
            [targetInvoiceId, userId]
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice/Financing record not found or unauthorized' });
        }

        const invoice = invoiceQuery.rows[0];

        if (invoice.financing_status !== 'financed') {
            return res.status(400).json({ error: 'This invoice is not currently actively financed' });
        }

        // 2. Repay to Katana
        const repayResult = await bridgeService.repayToKatana(asset, amount);

        // 3. Update DB to reflect repayment
        await pool.query(
            `UPDATE invoices 
             SET financing_status = 'repaid', 
                 updated_at = NOW() 
             WHERE invoice_id = $1`,
            [targetInvoiceId]
        );

        res.json({
            success: true,
            message: 'Repayment successful',
            repayResult
        });
    } catch (error) {
        console.error('Repayment failed:', error);
        res.status(500).json({ error: 'Repayment failed. Please ensure sufficient funds.' });
    }
});

// Tokenize invoice
router.post('/tokenize', authenticateToken, requireRole(['seller', 'admin']), requireKYC, validateFinancingTokenize, async (req, res) => {
    try {
        const { invoiceId, faceValue, maturityDate, yieldBps } = req.body;
        const userId = req.user.id;

        if (!invoiceId || !faceValue || !maturityDate || yieldBps === undefined) {
             return res.status(400).json({ error: 'Missing required tokenization parameters' });
        }

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
        const event = receipt.logs?.find(
            e => e.fragment && e.fragment.name === 'Tokenized'
        ) || receipt.events?.find(e => e.event === 'Tokenized');

        if (!event) throw new Error("Tokenized event not emitted by the contract");

        // Accommodate both ethers v5 (event.args.tokenId) and v6 (event.args[0] or similar)
        const tokenId = event.args ? (event.args.tokenId || event.args[0]) : null;

        if (!tokenId) {
            throw new Error("Could not parse Token ID from event logs");
        }

        // Update database
        await pool.query(
            `UPDATE invoices 
             SET token_id = $1, 
                 financing_status = $2, 
                 is_tokenized = true, 
                 yield_bps = $3,
                 updated_at = NOW() 
             WHERE invoice_id = $4`,
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
        
        // Return clear contract revert reasons if available
        if (error.reason) {
            return res.status(400).json({ error: `Contract rejected: ${error.reason}` });
        }
        res.status(500).json({ error: 'Tokenization failed due to an internal error' });
    }
});

module.exports = router;