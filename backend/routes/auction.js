const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const auctionService = require('../services/auctionService');
const { emitToAuction } = require('../socket');
const EmailService = require('../services/emailService');
const { pool } = require('../config/database');

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

    const auction = await auctionService.createAuction({
      auctionId,
      sellerAddress,
      invoiceContractAddress,
      invoiceId,
      faceValue,
      paymentToken,
      minYieldBps,
      // Add fallback to 86400 seconds (1 day) so it doesn't calculate NaN
      auctionEndTime: new Date(Date.now() + (duration > 0 ? duration : 86400) * 1000),
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

    // Send email notifications to investors about new auction
    try {
      // Fetch all investors
      const investorsResult = await pool.query(
        "SELECT id, email, wallet_address FROM users WHERE role = 'investor' AND kyc_status = 'verified'"
      );

      const auctionEndTime = new Date(auction.auction_end_time || Date.now() + 86400000);
      const timeRemaining = getTimeRemaining(auctionEndTime);

      // Send emails to all verified investors (async, don't wait)
      investorsResult.rows.forEach(investor => {
        EmailService.sendAuctionStartedEmail(investor.email, {
          auctionId,
          faceValue: auction.face_value,
          minYieldBps: auction.min_yield_bps,
          auctionEndTime: auctionEndTime.toLocaleString(),
          timeRemaining,
          paymentTokenSymbol: 'USDC'
        }, investor.id).catch(err => {
          console.error(`Failed to send auction started email to ${investor.email}:`, err.message);
        });
      });
    } catch (emailError) {
      console.error('Error sending auction started notifications:', emailError.message);
      // Don't fail the request if email fails
    }
    
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

    // Send email notifications (async, don't wait)
    const previousHighestBidder = auction.highest_bidder;
    const previousHighestBid = auction.highest_bid;

    // Send email to seller about new bid
    try {
      const sellerResult = await pool.query(
        'SELECT id, email FROM users WHERE wallet_address = $1',
        [auction.seller_address]
      );
      if (sellerResult.rows.length > 0) {
        const seller = sellerResult.rows[0];
        const bids = await auctionService.getAuctionBids(auctionId);
        EmailService.sendBidPlacedEmail(seller.email, {
          auctionId,
          bidderAddress,
          faceValue: auction.face_value,
          bidAmount,
          yieldBps,
          highestBid: bidAmount,
          auctionEndTime: new Date(auction.auction_end_time).toLocaleString(),
          totalBids: bids.length + 1
        }, seller.id).catch(err => {
          console.error('Failed to send bid placed email to seller:', err.message);
        });
      }
    } catch (emailError) {
      console.error('Error sending bid placed email:', emailError.message);
    }

    // Send outbid notification to previous highest bidder
    if (previousHighestBidder && previousHighestBidder !== bidderAddress) {
      try {
        const previousBidderResult = await pool.query(
          'SELECT id, email FROM users WHERE wallet_address = $1',
          [previousHighestBidder]
        );
        if (previousBidderResult.rows.length > 0) {
          const previousBidder = previousBidderResult.rows[0];
          const auctionEndTime = new Date(auction.auction_end_time);
          EmailService.sendOutbidEmail(previousBidder.email, {
            auctionId,
            yourBid: previousHighestBid,
            newHighestBid: bidAmount,
            faceValue: auction.face_value,
            timeRemaining: getTimeRemaining(auctionEndTime),
            auctionEndTime: auctionEndTime.toLocaleString()
          }, previousBidder.id).catch(err => {
            console.error('Failed to send outbid email:', err.message);
          });
        }
      } catch (emailError) {
        console.error('Error sending outbid email:', emailError.message);
      }
    }

    // Emit socket event to all subscribers in the auction room
    const io = req.app.get('io');
    if (io) {
      emitToAuction(io, auctionId, 'auction:bid', {
        auctionId,
        bidderAddress,
        yieldBps,
        bidAmount,
        txHash: chainResult.txHash,
        timestamp: new Date().toISOString()
      });
    }
    
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

    // Send email notifications for auction ended
    try {
      const winner = chainResult.winner;
      const winningBid = chainResult.winningBid;
      const bids = await auctionService.getAuctionBids(auctionId);

      // Send email to seller
      const sellerResult = await pool.query(
        'SELECT id, email FROM users WHERE wallet_address = $1',
        [auction.seller_address]
      );
      if (sellerResult.rows.length > 0) {
        const seller = sellerResult.rows[0];
        EmailService.sendAuctionEndedEmail(seller.email, {
          auctionId,
          faceValue: auction.face_value,
          winningBid,
          winnerAddress: winner,
          totalBids: bids.length
        }, false, true, seller.id).catch(err => {
          console.error('Failed to send auction ended email to seller:', err.message);
        });
      }

      // Send email to winner
      if (winner) {
        const winnerResult = await pool.query(
          'SELECT id, email FROM users WHERE wallet_address = $1',
          [winner]
        );
        if (winnerResult.rows.length > 0) {
          const winnerUser = winnerResult.rows[0];
          EmailService.sendAuctionEndedEmail(winnerUser.email, {
            auctionId,
            faceValue: auction.face_value,
            winningBid,
            winnerAddress: winner,
            totalBids: bids.length
          }, true, false, winnerUser.id).catch(err => {
            console.error('Failed to send auction ended email to winner:', err.message);
          });
        }
      }
    } catch (emailError) {
      console.error('Error sending auction ended emails:', emailError.message);
    }

    // Emit socket event to all subscribers in the auction room
    const io = req.app.get('io');
    if (io) {
      emitToAuction(io, auctionId, 'auction:ended', {
        auctionId,
        winner: chainResult.winner,
        winningBid: chainResult.winningBid,
        txHash: chainResult.txHash,
        timestamp: new Date().toISOString()
      });
    }
    
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

    // Emit socket event to all subscribers in the auction room
    const io = req.app.get('io');
    if (io) {
      emitToAuction(io, auctionId, 'auction:settled', {
        auctionId,
        winner: chainResult.winner,
        amount: chainResult.amount,
        platformFee: chainResult.platformFee,
        txHash: chainResult.txHash,
        timestamp: new Date().toISOString()
      });
    }
    
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

    // Emit socket event to all subscribers in the auction room
    const io = req.app.get('io');
    if (io) {
      emitToAuction(io, auctionId, 'auction:cancelled', {
        auctionId,
        txHash: chainResult.txHash,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      txHash: chainResult.txHash
    });
  } catch (error) {
    console.error('Error cancelling auction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper function to calculate time remaining
 */
function getTimeRemaining(endTime) {
  const now = new Date();
  const diff = endTime - now;
  
  if (diff <= 0) {
    return 'Ended';
  }
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

module.exports = router;
