const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const {
  createStream,
  approveStream,
  releasePayment,
  pauseStream,
  resumeStream,
  cancelStream,
  getStream,
  getSellerStreams,
  getBuyerStreams,
  getMyStreams
} = require('../controllers/streamingController');

// All streaming routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

/**
 * @swagger
 * /api/streaming:
 *   post:
 *     summary: Create a new subscription stream
 *     tags: [Streaming]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - buyerAddress
 *               - totalAmount
 *               - interval
 *               - numPayments
 *               - tokenAddress
 *             properties:
 *               buyerAddress:
 *                 type: string
 *               totalAmount:
 *                 type: number
 *               interval:
 *                 type: string
 *                 enum: [daily, weekly, monthly]
 *               numPayments:
 *                 type: integer
 *               tokenAddress:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Stream created
 */
router.post('/', createStream);

/**
 * @swagger
 * /api/streaming:
 *   get:
 *     summary: Get all streams for current user
 *     tags: [Streaming]
 *     responses:
 *       200:
 *         description: List of streams
 */
router.get('/', getMyStreams);

/**
 * @swagger
 * /api/streaming/seller:
 *   get:
 *     summary: Get streams where user is seller
 *     tags: [Streaming]
 *     responses:
 *       200:
 *         description: List of seller streams
 */
router.get('/seller', getSellerStreams);

/**
 * @swagger
 * /api/streaming/buyer:
 *   get:
 *     summary: Get streams where user is buyer
 *     tags: [Streaming]
 *     responses:
 *       200:
 *         description: List of buyer streams
 */
router.get('/buyer', getBuyerStreams);

/**
 * @swagger
 * /api/streaming/{streamId}:
 *   get:
 *     summary: Get stream details
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream details
 */
router.get('/:streamId', getStream);

/**
 * @swagger
 * /api/streaming/{streamId}/approve:
 *   post:
 *     summary: Approve and fund a stream (buyer)
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *             properties:
 *               amount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Stream approved
 */
router.post('/:streamId/approve', approveStream);

/**
 * @swagger
 * /api/streaming/{streamId}/release:
 *   post:
 *     summary: Release payment for completed interval
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Payment released
 */
router.post('/:streamId/release', releasePayment);

/**
 * @swagger
 * /api/streaming/{streamId}/pause:
 *   post:
 *     summary: Pause a stream (buyer)
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream paused
 */
router.post('/:streamId/pause', pauseStream);

/**
 * @swagger
 * /api/streaming/{streamId}/resume:
 *   post:
 *     summary: Resume a paused stream (buyer)
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream resumed
 */
router.post('/:streamId/resume', resumeStream);

/**
 * @swagger
 * /api/streaming/{streamId}/cancel:
 *   post:
 *     summary: Cancel a stream (seller or buyer)
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: streamId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stream cancelled
 */
router.post('/:streamId/cancel', cancelStream);

module.exports = router;
