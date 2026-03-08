'use strict';

const express = require('express');
const router  = express.Router();
const { body, query, param, validationResult } = require('express-validator');

const smartRoutingService = require('../services/smartRoutingService');
const { authenticateToken } = require('../middleware/auth');

// ─── Validation helper ────────────────────────────────────────────────────────

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return false;
  }
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/smart-routing/protocols
 *
 * Returns the list of supported protocols, chains, and bridge route metadata.
 * No authentication required — used during page load.
 */
router.get('/protocols', authenticateToken, (_req, res) => {
  const data = smartRoutingService.getSupportedProtocols();
  res.json({ success: true, ...data });
});

/**
 * GET /api/v1/smart-routing/routes
 *
 * Analyse all available payment paths for a given transfer and return them
 * ranked by a composite score (rate + fees + speed).
 *
 * Query params:
 *   fromToken*      Source token/currency symbol  (e.g. USDC)
 *   toToken*        Destination token/currency    (e.g. EURC)
 *   amount*         Transfer amount (numeric, > 0)
 *   fromChain       Source chain slug              (default: polygon-pos)
 *   toChain         Destination chain slug         (default: fromChain)
 *   prioritizeRate  "true" — bias scoring toward best output
 *   prioritizeFee   "true" — bias scoring toward lowest fees
 *   prioritizeSpeed "true" — bias scoring toward fastest settlement
 */
router.get(
  '/routes',
  authenticateToken,
  [
    query('fromToken').trim().notEmpty().withMessage('fromToken is required'),
    query('toToken').trim().notEmpty().withMessage('toToken is required'),
    query('amount')
      .toFloat()
      .isFloat({ gt: 0 })
      .withMessage('amount must be a positive number'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;

    const {
      fromToken, toToken, fromChain, toChain, amount,
      prioritizeRate, prioritizeFee, prioritizeSpeed,
    } = req.query;

    try {
      const result = await smartRoutingService.analyzePaymentRoutes({
        fromToken,
        toToken,
        fromChain,
        toChain,
        amount: parseFloat(amount),
        preferences: {
          prioritizeRate:  prioritizeRate  === 'true',
          prioritizeFee:   prioritizeFee   === 'true',
          prioritizeSpeed: prioritizeSpeed === 'true',
        },
      });

      res.json({ success: true, ...result });
    } catch (err) {
      if (err.code === 'NO_ROUTES')      return res.status(404).json({ error: err.message });
      if (err.code === 'INVALID_PARAMS'
       || err.code === 'INVALID_AMOUNT') return res.status(400).json({ error: err.message });

      console.error('[SmartRouting] Route analysis error:', err);
      res.status(500).json({ error: 'Failed to analyse payment routes' });
    }
  },
);

/**
 * GET /api/v1/smart-routing/route/:routeId
 *
 * Retrieve a single previously-analysed route by its ID.
 * Routes expire after ~60 s; expired or unknown IDs return 404.
 */
router.get(
  '/route/:routeId',
  authenticateToken,
  [
    param('routeId').isUUID().withMessage('routeId must be a valid UUID'),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    const route = smartRoutingService.getRouteById(req.params.routeId);
    if (!route) return res.status(404).json({ error: 'Route not found or expired' });

    res.json({ success: true, route });
  },
);

/**
 * POST /api/v1/smart-routing/execute
 *
 * Execute a selected payment route identified by routeId.
 * Returns an executionId immediately; use /status/:executionId to track progress.
 *
 * Body:
 *   routeId*           UUID returned by GET /routes
 *   slippageTolerance  Max slippage in bps  (default 50)
 */
router.post(
  '/execute',
  authenticateToken,
  [
    body('routeId').isUUID().withMessage('routeId must be a valid UUID'),
    body('slippageTolerance')
      .optional()
      .isInt({ min: 0, max: 2000 })
      .withMessage('slippageTolerance must be an integer between 0 and 2000 bps'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;

    const { routeId, slippageTolerance } = req.body;
    const userAddress = req.user.wallet_address;

    if (!userAddress) {
      return res
        .status(400)
        .json({ error: 'No wallet address is associated with your account. Please add one in profile settings.' });
    }

    try {
      const result = await smartRoutingService.executeRoute({
        routeId,
        userAddress,
        slippageTolerance: slippageTolerance ?? 50,
      });

      res.status(202).json({ success: true, ...result });
    } catch (err) {
      if (err.code === 'ROUTE_NOT_FOUND') return res.status(404).json({ error: err.message });
      if (err.code === 'INVALID_PARAMS')  return res.status(400).json({ error: err.message });

      console.error('[SmartRouting] Route execution error:', err);
      res.status(500).json({ error: 'Failed to execute route' });
    }
  },
);

/**
 * GET /api/v1/smart-routing/status/:executionId
 *
 * Poll the status of a route execution.
 *
 * Response includes: status, steps[], txHashes[], completedAt / failedAt.
 */
router.get(
  '/status/:executionId',
  authenticateToken,
  [
    param('executionId').isUUID().withMessage('executionId must be a valid UUID'),
  ],
  (req, res) => {
    if (!validate(req, res)) return;

    try {
      const execution = smartRoutingService.getExecutionStatus(req.params.executionId);
      res.json({ success: true, execution });
    } catch (err) {
      if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Execution not found' });
      res.status(500).json({ error: 'Failed to retrieve execution status' });
    }
  },
);

module.exports = router;
