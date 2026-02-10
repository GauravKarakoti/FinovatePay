const express = require('express');
const router = express.Router();
const bridgeService = require('../services/bridgeService');
const { authenticateToken } = require('../middleware/auth');
const kycValidation = require('../middleware/kycValidation');

// Request financing using Katana liquidity
router.post('/request', authenticateToken, kycValidation, async (req, res) => {
    try {
        const { invoiceId, amount, asset, collateralTokenId } = req.body;
        const userId = req.user.id;

        // Validate invoice and user
        // ... (existing validation logic)

        // Bridge collateral to Katana if needed
        // const bridgeResult = await bridgeService.bridgeToKatana(collateralTokenId, amount, userId);

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

module.exports = router;
