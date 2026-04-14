const express = require('express');
const router = express.Router();
const bridgeService = require('../services/bridgeService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { getFractionTokenContract, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const { ethers } = require('ethers');

// Corrected the imported validator names
const { 
  validateFinancingRequest, 
  validateFinancingRepay, 
  validateTokenizeInvoice 
} = require('../middleware/validators');
const { idempotencyMiddleware, logAudit } = require('../middleware/auditLogger');

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
router.post('/request', authenticateToken, requireRole(['seller', 'admin']), requireKYC, validateFinancingRequest, idempotencyMiddleware('FINANCING_REQUEST'), async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { invoiceId, amount, asset, collateralTokenId } = req.body;
        const userId = req.user.id;

        if (!invoiceId || !amount || !asset || !collateralTokenId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        await client.query('BEGIN');

        const invoiceQuery = await client.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_address = $2 FOR UPDATE',
            [invoiceId, req.user.wallet_address]
        );

        if (invoiceQuery.rows.length === 0) {
            throw new Error('Invoice not found or unauthorized');
        }

        const invoice = invoiceQuery.rows[0];

        if (invoice.financing_status === 'financed' || invoice.financing_status === 'listed') {
            throw new Error('Invoice is already financed or listed');
        }

        // Log financial transaction as PENDING
        const financialTx = await logFinancialTransaction({
            transactionType: 'FINANCING_DISBURSEMENT',
            invoiceId,
            fromAddress: 'KATANA_LIQUIDITY_POOL',
            toAddress: req.user.wallet_address,
            amount,
            currency: asset,
            status: 'PENDING',
            initiatedBy: userId,
            metadata: { collateralTokenId }
        });

        // 2. Bridge collateral to Katana if needed
        const bridgeResult = await bridgeService.bridgeToKatana(collateralTokenId, amount, userId);

        // 3. Borrow from Katana liquidity
        const borrowResult = await bridgeService.borrowFromKatana(asset, amount, collateralTokenId);

        // 4. Record financing in DB
        await client.query(
            `UPDATE invoices 
             SET financing_status = 'financed', 
                 updated_at = NOW() 
             WHERE invoice_id = $1`,
            [invoiceId]
        );

        await client.query('COMMIT');

        // Update financial transaction to CONFIRMED
        if (financialTx) {
            await pool.query(
                'UPDATE financial_transactions SET status = $1, confirmed_at = NOW() WHERE transaction_id = $2',
                ['CONFIRMED', financialTx.transaction_id]
            );
        }

        // Log audit entry
        await logAudit({
            operationType: 'FINANCING_REQUEST',
            entityType: 'INVOICE',
            entityId: invoiceId,
            actorId: userId,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'REQUEST_FINANCING',
            status: 'SUCCESS',
            oldValues: { financing_status: invoice.financing_status },
            newValues: { financing_status: 'financed' },
            metadata: { amount, asset, collateralTokenId, bridgeResult, borrowResult },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Financing request submitted successfully',
            bridgeResult,
            borrowResult
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Financing request failed:', error);

        await logAudit({
            operationType: 'FINANCING_REQUEST',
            entityType: 'INVOICE',
            entityId: req.body.invoiceId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'REQUEST_FINANCING',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: req.body,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.status(500).json({ error: 'Financing request failed. Please try again.' });
    } finally {
        client.release();
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

        const invoiceQuery = await pool.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_address = $2',
            [targetInvoiceId, req.user.wallet_address]
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

// Tokenize invoice (Updated validator name here)
router.post('/tokenize', authenticateToken, requireRole(['seller', 'admin']), requireKYC, validateTokenizeInvoice, async (req, res) => {
    try {
        const { invoiceId, faceValue, maturityDate, yieldBps } = req.body;

        if (!invoiceId || !faceValue || !maturityDate || yieldBps === undefined) {
             return res.status(400).json({ error: 'Missing required tokenization parameters' });
        }

        const invoiceQuery = await pool.query(
            // 👉 FIX: Use seller_address instead of seller_id
            'SELECT * FROM invoices WHERE invoice_id = $1 AND seller_address = $2',
            [invoiceId, req.user.wallet_address] // Pass the wallet address, not the user ID
        );

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).json({ error: 'Invoice not found or not owned by user' });
        }

        const invoice = invoiceQuery.rows[0];

        if (invoice.is_tokenized) {
            return res.status(400).json({ error: 'Invoice already tokenized' });
        }

        let contract = await getFractionTokenContract();
        const signer = await getSigner();
        
        // 👉 FIX: Connect the contract to the signer so it can send transactions
        contract = contract.connect(signer);

        // Convert maturity date to timestamp
        const maturityTimestamp = Math.floor(new Date(maturityDate).getTime() / 1000);

        // Convert invoiceId to bytes32 (Use stored hash)
        // If we want consistency, we should use invoice.invoice_hash (from escrow ID)
        let bytes32InvoiceId;
        if (invoice.invoice_hash && invoice.invoice_hash.startsWith('0x')) {
             bytes32InvoiceId = invoice.invoice_hash;
        } else {
             // Fallback if not available, though for tokenization we generally expect the invoice to be on-chain 
             // (and thus have an invoice_hash).
             bytes32InvoiceId = ethers.zeroPadValue(ethers.toUtf8Bytes(invoiceId), 32);
        }

        const totalSupply = ethers.parseUnits(faceValue.toString(), 18);
        const pricePerFraction = 1; // 1 base unit of payment token per fraction

        // Call tokenizeInvoice matching exactly the FractionToken.sol ABI:
        // (bytes32 _invoiceId, address _seller, uint256 _totalFractions, uint256 _pricePerFraction, uint256 _maturityDate, uint256 _totalValue, uint256 _yieldBps)
        const tx = await contract.tokenizeInvoice(
            bytes32InvoiceId,
            req.user.wallet_address, // _seller
            totalSupply,             // _totalFractions
            pricePerFraction,        // _pricePerFraction
            maturityTimestamp,       // _maturityDate
            totalSupply,             // _totalValue
            yieldBps                 // _yieldBps
        );

        const receipt = await tx.wait();
        
        // 👉 FIX: Look for 'InvoiceFractionalized' instead of 'Tokenized'
        const event = receipt.logs?.find(
            e => e.fragment && e.fragment.name === 'InvoiceFractionalized'
        ) || receipt.events?.find(e => e.event === 'InvoiceFractionalized');

        if (!event) throw new Error("InvoiceFractionalized event not emitted by the contract");

        // The second argument in InvoiceFractionalized is the tokenId
        const tokenId = event.args ? (event.args.tokenId || event.args[1]) : null;

        if (!tokenId) {
            throw new Error("Could not parse Token ID from event logs");
        }

        await pool.query(
            `UPDATE invoices 
             SET token_id = $1, 
                 financing_status = $2, 
                 is_tokenized = true, 
                 updated_at = NOW() 
             WHERE invoice_id = $3`,
            [tokenId.toString(), 'listed', invoiceId]
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