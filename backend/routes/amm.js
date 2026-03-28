const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { errorResponse } = require('../utils/errorResponse');
const ammService = require('../services/ammService');

const parsePagination = (query) => {
    const limit = Number.parseInt(query.limit, 10);
    const offset = Number.parseInt(query.offset, 10);

    return {
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20,
        offset: Number.isFinite(offset) && offset >= 0 ? offset : 0
    };
};

/**
 * GET /api/v1/amm/pairs
 */
router.get('/pairs', async (req, res) => {
    try {
        const { tokenId } = req.query;
        const { limit, offset } = parsePagination(req.query);

        const pairs = await ammService.getPairs({ tokenId, limit, offset });
        return res.json({ success: true, count: pairs.length, pairs });
    } catch (error) {
        console.error('Error fetching AMM pairs:', error);
        return errorResponse(res, error, 500);
    }
});

/**
 * GET /api/v1/amm/pairs/token/:tokenId
 */
router.get('/pairs/token/:tokenId', async (req, res) => {
    try {
        const pair = await ammService.getPairByTokenId(req.params.tokenId);
        if (!pair) {
            return errorResponse(res, 'AMM pair not found', 404);
        }
        return res.json({ success: true, pair });
    } catch (error) {
        console.error('Error fetching AMM pair by token:', error);
        return errorResponse(res, error, 500);
    }
});

/**
 * GET /api/v1/amm/pairs/:pairId
 */
router.get('/pairs/:pairId', async (req, res) => {
    try {
        const pair = await ammService.getPairById(req.params.pairId);
        if (!pair) {
            return errorResponse(res, 'AMM pair not found', 404);
        }
        return res.json({ success: true, pair });
    } catch (error) {
        console.error('Error fetching AMM pair:', error);
        return errorResponse(res, error, 500);
    }
});

/**
 * POST /api/v1/amm/liquidity/add
 */
router.post('/liquidity/add', authenticateToken, requireKYC, async (req, res) => {
    try {
        const {
            tokenId,
            fractionTokenAddress,
            stablecoinAddress,
            fractionAmount,
            stableAmount
        } = req.body;

        if (!tokenId || !fractionTokenAddress || !stablecoinAddress || !fractionAmount || !stableAmount) {
            return errorResponse(res, 'tokenId, token addresses, and liquidity amounts are required', 400);
        }

        const result = await ammService.addLiquidity({
            tokenId,
            fractionTokenAddress,
            stablecoinAddress,
            providerAddress: req.user.wallet_address,
            fractionAmount,
            stableAmount
        });

        return res.status(201).json({
            success: true,
            message: 'Liquidity added',
            ...result
        });
    } catch (error) {
        console.error('Error adding AMM liquidity:', error);
        return errorResponse(res, error.message, 400);
    }
});

/**
 * POST /api/v1/amm/liquidity/remove
 */
router.post('/liquidity/remove', authenticateToken, requireKYC, async (req, res) => {
    try {
        const { pairId, shares } = req.body;

        if (!pairId || !shares) {
            return errorResponse(res, 'pairId and shares are required', 400);
        }

        const result = await ammService.removeLiquidity({
            pairId,
            providerAddress: req.user.wallet_address,
            shares
        });

        return res.json({
            success: true,
            message: 'Liquidity removed',
            ...result
        });
    } catch (error) {
        console.error('Error removing AMM liquidity:', error);
        return errorResponse(res, error.message, 400);
    }
});

/**
 * POST /api/v1/amm/swap
 */
router.post('/swap', authenticateToken, requireKYC, async (req, res) => {
    try {
        const { pairId, side, amountIn, minAmountOut, txHash, blockNumber } = req.body;

        if (!pairId || !side || !amountIn) {
            return errorResponse(res, 'pairId, side, and amountIn are required', 400);
        }

        const result = await ammService.swap({
            pairId,
            side,
            amountIn,
            minAmountOut: minAmountOut || '0',
            txHash: txHash || null,
            blockNumber: blockNumber || null,
            traderAddress: req.user.wallet_address
        });

        return res.json({
            success: true,
            message: 'Swap executed',
            ...result
        });
    } catch (error) {
        console.error('Error executing AMM swap:', error);
        return errorResponse(res, error.message, 400);
    }
});

/**
 * GET /api/v1/amm/positions/me
 */
router.get('/positions/me', authenticateToken, async (req, res) => {
    try {
        const positions = await ammService.getPositionsByProvider(req.user.wallet_address);
        return res.json({ success: true, count: positions.length, positions });
    } catch (error) {
        console.error('Error fetching AMM positions:', error);
        return errorResponse(res, error, 500);
    }
});

/**
 * GET /api/v1/amm/trades
 */
router.get('/trades', async (req, res) => {
    try {
        const { pairId } = req.query;
        const { limit, offset } = parsePagination(req.query);
        const trades = await ammService.getTrades({ pairId, limit, offset });

        return res.json({ success: true, count: trades.length, trades });
    } catch (error) {
        console.error('Error fetching AMM trades:', error);
        return errorResponse(res, error, 500);
    }
});

module.exports = router;
