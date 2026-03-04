const express = require('express');
const router = express.Router();
const creditLineService = require('../services/creditLineService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');

/**
 * GET /api/credit-line/config
 * Get credit line configuration
 */
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const config = await creditLineService.getCreditLineConfig(req.user.id);
        res.json(config);
    } catch (error) {
        console.error('Get config failed:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

/**
 * GET /api/credit-line/eligibility
 * Check user's credit line eligibility based on credit score
 */
router.get('/eligibility', authenticateToken, requireKYC, async (req, res) => {
    try {
        const eligibility = await creditLineService.getMaxCreditLimit(req.user.id);
        
        res.json({
            eligible: eligibility.qualified,
            creditLimit: eligibility.creditLimit,
            creditScore: eligibility.creditScore,
            grade: eligibility.grade
        });
    } catch (error) {
        console.error('Check eligibility failed:', error);
        res.status(500).json({ error: 'Failed to check eligibility' });
    }
});

/**
 * GET /api/credit-line
 * Get user's credit line
 */
router.get('/', authenticateToken, requireKYC, async (req, res) => {
    try {
        const creditLine = await creditLineService.getUserCreditLine(req.user.id);
        
        if (!creditLine) {
            return res.json({
                hasCreditLine: false,
                creditLine: null
            });
        }

        res.json({
            hasCreditLine: true,
            creditLine
        });
    } catch (error) {
        console.error('Get credit line failed:', error);
        res.status(500).json({ error: 'Failed to get credit line' });
    }
});

/**
 * POST /api/credit-line
 * Create a new credit line
 */
router.post('/', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLimit, interestRate, collateralTokenId, collateralAmount } = req.body;

        if (!creditLimit || !collateralTokenId || !collateralAmount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await creditLineService.createCreditLine(
            req.user.id,
            req.user.wallet_address,
            {
                creditLimit,
                interestRate: interestRate || 500,
                collateralTokenId,
                collateralAmount
            }
        );

        res.status(201).json({
            success: true,
            message: 'Credit line created successfully',
            creditLineId: result.creditLineId,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Create credit line failed:', error);
        res.status(500).json({ error: error.message || 'Failed to create credit line' });
    }
});

/**
 * POST /api/credit-line/drawdown
 * Draw funds from credit line
 */
router.post('/drawdown', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLineId, amount } = req.body;

        if (!creditLineId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await creditLineService.drawdown(
            req.user.id,
            req.user.wallet_address,
            creditLineId,
            amount
        );

        res.json({
            success: true,
            message: 'Drawdown successful',
            amount: result.amount,
            newDrawnAmount: result.newDrawnAmount,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Drawdown failed:', error);
        res.status(500).json({ error: error.message || 'Failed to draw funds' });
    }
});

/**
 * POST /api/credit-line/repay
 * Repay credit line
 */
router.post('/repay', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLineId, amount } = req.body;

        if (!creditLineId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await creditLineService.repay(
            req.user.id,
            req.user.wallet_address,
            creditLineId,
            amount
        );

        res.json({
            success: true,
            message: 'Repayment successful',
            amount: result.amount,
            interestPaid: result.interestPaid,
            newDrawnAmount: result.newDrawnAmount,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Repayment failed:', error);
        res.status(500).json({ error: error.message || 'Failed to repay' });
    }
});

/**
 * POST /api/credit-line/collateral/deposit
 * Deposit additional collateral
 */
router.post('/collateral/deposit', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLineId, tokenId, amount } = req.body;

        if (!creditLineId || !tokenId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await creditLineService.depositCollateral(
            req.user.id,
            req.user.wallet_address,
            creditLineId,
            tokenId,
            amount
        );

        res.json({
            success: true,
            message: 'Collateral deposited successfully',
            amount: result.amount,
            newCollateralAmount: result.newCollateralAmount,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Deposit collateral failed:', error);
        res.status(500).json({ error: error.message || 'Failed to deposit collateral' });
    }
});

/**
 * POST /api/credit-line/collateral/withdraw
 * Withdraw excess collateral
 */
router.post('/collateral/withdraw', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLineId, amount } = req.body;

        if (!creditLineId || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await creditLineService.withdrawCollateral(
            req.user.id,
            req.user.wallet_address,
            creditLineId,
            amount
        );

        res.json({
            success: true,
            message: 'Collateral withdrawn successfully',
            amount: result.amount,
            newCollateralAmount: result.newCollateralAmount,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Withdraw collateral failed:', error);
        res.status(500).json({ error: error.message || 'Failed to withdraw collateral' });
    }
});

/**
 * POST /api/credit-line/close
 * Close credit line
 */
router.post('/close', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { creditLineId } = req.body;

        if (!creditLineId) {
            return res.status(400).json({ error: 'Missing credit line ID' });
        }

        const result = await creditLineService.closeCreditLine(
            req.user.id,
            req.user.wallet_address,
            creditLineId
        );

        res.json({
            success: true,
            message: 'Credit line closed successfully',
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Close credit line failed:', error);
        res.status(500).json({ error: error.message || 'Failed to close credit line' });
    }
});

/**
 * GET /api/credit-line/transactions/:creditLineId
 * Get credit line transaction history
 */
router.get('/transactions/:creditLineId', authenticateToken, async (req, res) => {
    try {
        const { creditLineId } = req.params;
        const { limit } = req.query;

        // Verify ownership
        const creditLine = await creditLineService.getCreditLineDetails(creditLineId);
        
        if (!creditLine) {
            return res.status(404).json({ error: 'Credit line not found' });
        }

        if (creditLine.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const transactions = await creditLineService.getTransactionHistory(creditLineId, parseInt(limit) || 50);

        res.json({
            creditLineId,
            transactions
        });
    } catch (error) {
        console.error('Get transactions failed:', error);
        res.status(500).json({ error: 'Failed to get transactions' });
    }
});

/**
 * GET /api/credit-line/:creditLineId
 * Get credit line details by ID (for admin)
 */
router.get('/:creditLineId', authenticateToken, requireRole(['admin']), async (req, res) => {
    try {
        const { creditLineId } = req.params;
        
        const creditLine = await creditLineService.getCreditLineDetails(creditLineId);
        
        if (!creditLine) {
            return res.status(404).json({ error: 'Credit line not found' });
        }

        res.json(creditLine);
    } catch (error) {
        console.error('Get credit line by ID failed:', error);
        res.status(500).json({ error: 'Failed to get credit line details' });
    }
});

module.exports = router;
