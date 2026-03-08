const express = require('express');
const router = express.Router();
const lendingService = require('../services/lendingService');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');

/**
 * GET /api/lending/config
 * Get lending pool configuration
 */
router.get('/config', authenticateToken, async (req, res) => {
    try {
        const config = await lendingService.getPoolConfig();
        res.json(config);
    } catch (error) {
        console.error('Get lending config failed:', error);
        res.status(500).json({ error: 'Failed to get configuration' });
    }
});

/**
 * GET /api/lending/eligibility
 * Check user's loan eligibility based on credit score and risk profile
 */
router.get('/eligibility', authenticateToken, requireKYC, async (req, res) => {
    try {
        const eligibility = await lendingService.getLoanEligibility(req.user.id);
        
        res.json(eligibility);
    } catch (error) {
        console.error('Check eligibility failed:', error);
        res.status(500).json({ error: 'Failed to check eligibility' });
    }
});

/**
 * GET /api/lending/loans
 * Get user's loans
 */
router.get('/loans', authenticateToken, requireKYC, async (req, res) => {
    try {
        const loans = await lendingService.getUserLoans(req.user.id);
        
        res.json({
            loans,
            count: loans.length
        });
    } catch (error) {
        console.error('Get loans failed:', error);
        res.status(500).json({ error: 'Failed to get loans' });
    }
});

/**
 * GET /api/lending/loans/:loanId
 * Get specific loan details
 */
router.get('/loans/:loanId', authenticateToken, requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;
        
        const loan = await lendingService.getLoanDetails(loanId);
        
        if (!loan) {
            return res.status(404).json({ error: 'Loan not found' });
        }

        // Check ownership or admin
        if (loan.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        res.json(loan);
    } catch (error) {
        console.error('Get loan details failed:', error);
        res.status(500).json({ error: 'Failed to get loan details' });
    }
});

/**
 * POST /api/lending/loans
 * Create a new loan with collateral
 */
router.post('/loans', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { 
            principal, 
            interestRate, 
            collateralTokenId, 
            collateralAmount,
            collateralValue,
            collateralContract,
            loanDuration 
        } = req.body;

        if (!principal || !collateralValue) {
            return res.status(400).json({ error: 'Missing required fields: principal, collateralValue' });
        }

        const result = await lendingService.createLoan(
            req.user.id,
            req.user.wallet_address,
            {
                principal,
                interestRate,
                collateralTokenId,
                collateralAmount,
                collateralValue,
                collateralContract,
                loanDuration
            }
        );

        res.status(201).json({
            success: true,
            message: 'Loan created successfully',
            loanId: result.loanId,
            ltv: result.ltv,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Create loan failed:', error);
        res.status(500).json({ error: error.message || 'Failed to create loan' });
    }
});

/**
 * POST /api/lending/loans/:loanId/collateral
 * Deposit additional collateral
 */
router.post('/loans/:loanId/collateral', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;
        const { 
            collateralType,
            tokenContract,
            tokenId,
            amount,
            value 
        } = req.body;

        if (!collateralType || !amount || !value) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await lendingService.depositCollateral(
            req.user.id,
            req.user.wallet_address,
            loanId,
            {
                collateralType,
                tokenContract,
                tokenId,
                amount,
                value
            }
        );

        res.json({
            success: true,
            message: 'Collateral deposited successfully',
            positionId: result.positionId,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Deposit collateral failed:', error);
        res.status(500).json({ error: error.message || 'Failed to deposit collateral' });
    }
});

/**
 * DELETE /api/lending/loans/:loanId/collateral
 * Withdraw collateral
 */
router.delete('/loans/:loanId/collateral', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;
        const { amount, value } = req.body;

        if (!amount || !value) {
            return res.status(400).json({ error: 'Missing required fields: amount, value' });
        }

        const result = await lendingService.withdrawCollateral(
            req.user.id,
            req.user.wallet_address,
            loanId,
            amount,
            value
        );

        res.json({
            success: true,
            message: 'Collateral withdrawn successfully',
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Withdraw collateral failed:', error);
        res.status(500).json({ error: error.message || 'Failed to withdraw collateral' });
    }
});

/**
 * POST /api/lending/loans/:loanId/borrow
 * Borrow additional funds
 */
router.post('/loans/:loanId/borrow', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const result = await lendingService.borrow(
            req.user.id,
            req.user.wallet_address,
            loanId,
            amount
        );

        res.json({
            success: true,
            message: 'Borrow successful',
            amount: result.amount,
            newTotalDebt: result.newTotalDebt,
            newLTV: result.newLTV,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Borrow failed:', error);
        res.status(500).json({ error: error.message || 'Failed to borrow' });
    }
});

/**
 * POST /api/lending/loans/:loanId/repay
 * Repay a loan
 */
router.post('/loans/:loanId/repay', authenticateToken, requireRole(['seller', 'admin']), requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const result = await lendingService.repay(
            req.user.id,
            req.user.wallet_address,
            loanId,
            amount
        );

        res.json({
            success: true,
            message: 'Repayment successful',
            amount: result.amount,
            interestPaid: result.interestPaid,
            remainingDebt: result.remainingDebt,
            status: result.status,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Repay failed:', error);
        res.status(500).json({ error: error.message || 'Failed to repay' });
    }
});

/**
 * POST /api/lending/loans/:loanId/liquidate
 * Liquidate an undercollateralized loan (for liquidators)
 */
router.post('/loans/:loanId/liquidate', authenticateToken, requireRole(['investor', 'admin']), requireKYC, async (req, res) => {
    try {
        const { loanId } = req.params;

        const result = await lendingService.liquidate(
            req.user.id,
            req.user.wallet_address,
            loanId
        );

        res.json({
            success: true,
            message: 'Liquidation successful',
            collateralSeized: result.collateralSeized,
            debtCovered: result.debtCovered,
            bonus: result.bonus,
            transactionHash: result.transactionHash
        });
    } catch (error) {
        console.error('Liquidation failed:', error);
        res.status(500).json({ error: error.message || 'Failed to liquidate' });
    }
});

/**
 * GET /api/lending/liquidations
 * Get liquidation candidates (for liquidators)
 */
router.get('/liquidations', authenticateToken, requireRole(['investor', 'admin']), async (req, res) => {
    try {
        const { limit } = req.query;
        const candidates = await lendingService.getLiquidationCandidates(parseInt(limit) || 10);
        
        res.json({
            candidates,
            count: candidates.length
        });
    } catch (error) {
        console.error('Get liquidation candidates failed:', error);
        res.status(500).json({ error: 'Failed to get liquidation candidates' });
    }
});

/**
 * GET /api/lending/stats
 * Get pool statistics
 */
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await lendingService.getPoolStats();
        res.json(stats);
    } catch (error) {
        console.error('Get pool stats failed:', error);
        res.status(500).json({ error: 'Failed to get pool statistics' });
    }
});

/**
 * GET /api/lending/ltv/:userId
 * Calculate LTV for a user (for frontend display)
 */
router.get('/ltv/:userId', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { collateralValue, requestedAmount } = req.query;

        if (!collateralValue || !requestedAmount) {
            return res.status(400).json({ error: 'Missing collateralValue or requestedAmount' });
        }

        const user = await pool.query('SELECT wallet_address FROM users WHERE id = $1', [userId]);
        
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const result = await lendingService.calculateDynamicLTV(
            userId,
            user.rows[0].wallet_address,
            BigInt(collateralValue),
            BigInt(requestedAmount)
        );

        res.json(result);
    } catch (error) {
        console.error('Calculate LTV failed:', error);
        res.status(500).json({ error: 'Failed to calculate LTV' });
    }
});

// Helper pool import for LTV route
const { pool } = require('../config/database');

module.exports = router;
