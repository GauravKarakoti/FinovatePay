const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const auctionService = require('../services/auctionService');

/**
 * @swagger
 * /api/auctions:
 *   post:
 *     summary: Create a new invoice auction
 *     tags: [Auctions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - invoiceId
 *               - invoiceContractAddress
 *               - faceValue
 *               - paymentToken
 *               - minYieldBps
 *               - duration
 *             properties:
 *               invoiceId:
 *                 type: string
 *               invoiceContractAddress:
 *                 type: string
 *               faceValue:
 *                 type: number
 *               paymentToken:
 *                 type: string
 *               minYieldBps:
 *                 type: integer
 *               duration:
 *                 type: integer
 *               minBidIncrement:
 *                 type: number
 *     responses:
 *       201:
 *         description: Auction created
 */
router.post('/', authenticateToken, requireKYC, async (req, res) => {
  try {
    const { 
      invoiceId, 
      invoiceContractAddress, 
      faceValue, 
      paymentToken, 
      minYieldBps, 
      duration,
      minBidIncrement 
    } = req.body;

    const sellerAddress = req.user.wallet_address;

    // Generate auction ID
    const auctionId = auctionService.generateAuctionId(invoiceId, sellerAddress);

    // Create auction on chain
    const chainResult = await auctionService.createAuctionOnChain(
      auctionId,
      invoiceContractAddress,
      invoiceId,
      faceValue,
      paymentToken,
      minYieldBps,
      duration,
      minBidIncrement || 0
    );

    // Save to database
    const auction = await auctionService.createAuction({
      auctionId,
      sellerAddress,
      invoiceContractAddress,
      invoiceId,
      faceValue,
      paymentToken,
      minYieldBps,
      auctionEndTime: new Date(Date.now() + duration * 1000),
      minBidIncrement: minBidIncrement || 0,
      txHash: chainResult.txHash
    });

    res.status(201).json({
      success: true,
      auction,
      txHash: chainResult.txHash
    });
  } catch (error) {
    console.error('Error creating auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions:
 *   get:
 *     summary: Get all active auctions
 *     tags: [Auctions]
 *     responses:
 *       200:
 *         description: List of active auctions
 */
router.get('/', async (req, res) => {
  try {
    const { status, limit } = req.query;
    const auctions = await auctionService.getActiveAuctions(limit || 50);
    
    res.json({
      success: true,
      auctions
    });
  } catch (error) {
    console.error('Error getting auctions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/seller:
 *   get:
 *     summary: Get auctions for current seller
 *     tags: [Auctions]
 *     responses:
 *       200:
 *         description: List of seller auctions
 */
router.get('/seller', authenticateToken, async (req, res) => {
  try {
    const sellerAddress = req.user.wallet_address;
    const auctions = await auctionService.getSellerAuctions(sellerAddress);
    
    res.json({
      success: true,
      auctions
    });
  } catch (error) {
    console.error('Error getting seller auctions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/bidder:
 *   get:
 *     summary: Get auctions the user has bid on
 *     tags: [Auctions]
 *     responses:
 *       200:
 *         description: List of bidder auctions
 */
router.get('/bidder', authenticateToken, async (req, res) => {
  try {
    const bidderAddress = req.user.wallet_address;
    const auctions = await auctionService.getBidderAuctions(bidderAddress);
    
    res.json({
      success: true,
      auctions
    });
  } catch (error) {
    console.error('Error getting bidder auctions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/stats:
 *   get:
 *     summary: Get auction statistics
 *     tags: [Auctions]
 *     responses:
 *       200:
 *         description: Auction statistics
 */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const address = req.user.wallet_address;
    const role = req.user.role;
    
    let stats;
    if (role === 'seller') {
      stats = await auctionService.getSellerStats(address);
    } else if (role === 'investor') {
      stats = await auctionService.getBidderStats(address);
    } else {
      stats = await auctionService.getAuctionStats();
    }
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting auction stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}:
 *   get:
 *     summary: Get auction details
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Auction details
 */
router.get('/:auctionId', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    res.json({
      success: true,
      auction
    });
  } catch (error) {
    console.error('Error getting auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/bids:
 *   get:
 *     summary: Get bids for an auction
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of bids
 */
router.get('/:auctionId/bids', async (req, res) => {
  try {
    const { auctionId } = req.params;
    const bids = await auctionService.getAuctionBids(auctionId);
    
    res.json({
      success: true,
      bids
    });
  } catch (error) {
    console.error('Error getting auction bids:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/start:
 *   post:
 *     summary: Start an auction
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Auction started
 */
router.post('/:auctionId/start', authenticateToken, requireKYC, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    if (auction.seller_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (auction.status !== 'created') {
      return res.status(400).json({ error: 'Auction cannot be started' });
    }
    
    // Start on chain
    const chainResult = await auctionService.startAuctionOnChain(auctionId);
    
    // Update database
    await auctionService.getAuction(auctionId); // This would need an update function
    
    res.json({
      success: true,
      txHash: chainResult.txHash
    });
  } catch (error) {
    console.error('Error starting auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/bid:
 *   post:
 *     summary: Place a bid on an auction
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
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
 *               - yieldBps
 *               - bidAmount
 *             properties:
 *               yieldBps:
 *                 type: integer
 *               bidAmount:
 *                 type: number
 *     responses:
 *       200:
 *         description: Bid placed
 */
router.post('/:auctionId/bid', authenticateToken, requireKYC, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const { yieldBps, bidAmount } = req.body;
    const bidderAddress = req.user.wallet_address;
    
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Auction is not active' });
    }
    
    if (auction.seller_address === bidderAddress) {
      return res.status(400).json({ error: 'Seller cannot bid on their own auction' });
    }
    
    if (yieldBps > auction.min_yield_bps) {
      return res.status(400).json({ error: 'Yield rate is too high' });
    }
    
    // Place bid on chain
    const chainResult = await auctionService.placeBidOnChain(
      auctionId,
      yieldBps,
      bidAmount,
      auction.payment_token
    );
    
    // Save to database
    await auctionService.placeBid({
      auctionId,
      bidderAddress,
      yieldBps,
      bidAmount,
      txHash: chainResult.txHash
    });
    
    res.json({
      success: true,
      bid: {
        auctionId,
        bidderAddress,
        yieldBps,
        bidAmount
      },
      txHash: chainResult.txHash
    });
  } catch (error) {
    console.error('Error placing bid:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/end:
 *   post:
 *     summary: End an auction
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Auction ended
 */
router.post('/:auctionId/end', authenticateToken, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    // End on chain
    const chainResult = await auctionService.endAuctionOnChain(auctionId);
    
    // Update database
    await auctionService.endAuction(auctionId);
    
    res.json({
      success: true,
      txHash: chainResult.txHash,
      winner: chainResult.winner,
      winningBid: chainResult.winningBid
    });
  } catch (error) {
    console.error('Error ending auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/settle:
 *   post:
 *     summary: Settle an auction (transfer funds and invoice)
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Auction settled
 */
router.post('/:auctionId/settle', authenticateToken, requireKYC, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    if (auction.status !== 'ended') {
      return res.status(400).json({ error: 'Auction must be ended first' });
    }
    
    if (!auction.highest_bidder) {
      return res.status(400).json({ error: 'No winning bid' });
    }
    
    // Settle on chain
    const chainResult = await auctionService.settleAuctionOnChain(auctionId);
    
    // Calculate platform fee (2.5% default)
    const platformFee = BigInt(auction.highest_bid) * BigInt(250) / BigInt(10000);
    
    // Update database
    await auctionService.settleAuction(auctionId, {
      winnerAddress: auction.highest_bidder,
      winningYieldBps: auction.min_yield_bps, // This would come from winning bid
      platformFee: platformFee.toString(),
      txHash: chainResult.txHash
    });
    
    res.json({
      success: true,
      txHash: chainResult.txHash,
      winner: chainResult.winner,
      platformFee: chainResult.platformFee
    });
  } catch (error) {
    console.error('Error settling auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auctions/{auctionId}/cancel:
 *   post:
 *     summary: Cancel an auction
 *     tags: [Auctions]
 *     parameters:
 *       - in: path
 *         name: auctionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Auction cancelled
 */
router.post('/:auctionId/cancel', authenticateToken, async (req, res) => {
  try {
    const { auctionId } = req.params;
    const auction = await auctionService.getAuction(auctionId);
    
    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }
    
    if (auction.seller_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (!['created', 'active'].includes(auction.status)) {
      return res.status(400).json({ error: 'Auction cannot be cancelled' });
    }
    
    // Cancel on chain
    const chainResult = await auctionService.cancelAuctionOnChain(auctionId);
    
    // Update database
    await auctionService.cancelAuction(auctionId);
    
    res.json({
      success: true,
      txHash: chainResult.txHash
    });
  } catch (error) {
    console.error('Error cancelling auction:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
