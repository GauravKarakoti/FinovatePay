const { ethers } = require('ethers');
const StreamingPayment = require('../models/StreamingPayment');
const {
  createStreamOnChain,
  approveStreamOnChain,
  releasePaymentOnChain,
  pauseStreamOnChain,
  resumeStreamOnChain,
  cancelStreamOnChain,
  getStreamFromChain,
  getRemainingBalanceOnChain
} = require('../services/streamingService');
const { pool } = require('../config/database');

// Helper function to convert UUID to bytes32
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Create a new subscription stream (seller creates)
 */
exports.createStream = async (req, res) => {
  try {
    const { 
      buyerAddress, 
      totalAmount, 
      interval, 
      numPayments, 
      tokenAddress, 
      description 
    } = req.body;
    
    const sellerAddress = req.user.wallet_address;
    
    // Validate input
    if (!buyerAddress || !totalAmount || !interval || !numPayments || !tokenAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (!['daily', 'weekly', 'monthly'].includes(interval.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid interval. Must be daily, weekly, or monthly' });
    }
    
    // Generate stream ID
    const streamId = uuidToBytes32(require('uuid').v4());
    
    // Create stream on blockchain
    const amountInWei = ethers.utils.parseUnits(totalAmount.toString(), 18);
    
    const chainResult = await createStreamOnChain(
      streamId,
      sellerAddress,
      buyerAddress,
      amountInWei,
      interval,
      numPayments,
      tokenAddress,
      description || 'Subscription payment'
    );
    
    // Save to database
    const stream = await StreamingPayment.create({
      streamId: streamId,
      sellerAddress,
      buyerAddress,
      amount: amountInWei.toString(),
      perIntervalAmount: (amountInWei / BigInt(numPayments)).toString(),
      tokenAddress,
      intervalType: interval.toLowerCase(),
      description,
      totalIntervals: numPayments,
      streamTxHash: chainResult.txHash
    });
    
    res.status(201).json({
      success: true,
      stream,
      txHash: chainResult.txHash
    });
    
  } catch (error) {
    console.error('Error creating stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Approve and fund a stream (buyer approves)
 */
exports.approveStream = async (req, res) => {
  try {
    const { streamId, amount } = req.body;
    const buyerAddress = req.user.wallet_address;
    
    // Get stream from DB
    const stream = await StreamingPayment.findById(streamId);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    if (stream.buyer_address !== buyerAddress) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (stream.status !== 'pending') {
      return res.status(400).json({ error: 'Stream is not pending' });
    }
    
    // Approve on chain
    const amountInWei = ethers.utils.parseUnits(amount.toString(), 18);
    const result = await approveStreamOnChain(streamId, amountInWei, stream.token_address);
    
    // Update database
    await StreamingPayment.updateStatus(streamId, 'active', {
      startTime: new Date(),
      nextReleaseTime: new Date(Date.now() + getIntervalMs(stream.interval_type)),
      totalPaid: amountInWei.toString(),
      streamTxHash: result.txHash
    });
    
    res.json({
      success: true,
      txHash: result.txHash
    });
    
  } catch (error) {
    console.error('Error approving stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Release payment (can be called by anyone for completed intervals)
 */
exports.releasePayment = async (req, res) => {
  try {
    const { streamId } = req.body;
    
    // Get stream from DB
    const stream = await StreamingPayment.findById(streamId);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    if (stream.status !== 'active') {
      return res.status(400).json({ error: 'Stream is not active' });
    }
    
    // Release on chain
    const result = await releasePaymentOnChain(streamId);
    
    // Update database
    await StreamingPayment.incrementReleased(
      streamId,
      result.amount,
      result.intervalsCompleted
    );
    
    // Check if completed
    const updatedStream = await StreamingPayment.findById(streamId);
    if (updatedStream && BigInt(updatedStream.total_released) >= BigInt(updatedStream.amount)) {
      await StreamingPayment.updateStatus(streamId, 'completed');
    }
    
    res.json({
      success: true,
      txHash: result.txHash,
      amount: result.amount,
      intervalsCompleted: result.intervalsCompleted
    });
    
  } catch (error) {
    console.error('Error releasing payment:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Pause stream (buyer)
 */
exports.pauseStream = async (req, res) => {
  try {
    const { streamId } = req.body;
    const userAddress = req.user.wallet_address;
    
    const stream = await StreamingPayment.findById(streamId);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    if (stream.buyer_address !== userAddress) {
      return res.status(403).json({ error: 'Only buyer can pause' });
    }
    
    const result = await pauseStreamOnChain(streamId);
    await StreamingPayment.updateStatus(streamId, 'paused');
    
    res.json({
      success: true,
      txHash: result.txHash
    });
    
  } catch (error) {
    console.error('Error pausing stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Resume stream (buyer)
 */
exports.resumeStream = async (req, res) => {
  try {
    const { streamId } = req.body;
    const userAddress = req.user.wallet_address;
    
    const stream = await StreamingPayment.findById(streamId);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    if (stream.buyer_address !== userAddress) {
      return res.status(403).json({ error: 'Only buyer can resume' });
    }
    
    const result = await resumeStreamOnChain(streamId);
    
    await StreamingPayment.updateStatus(streamId, 'active', {
      nextReleaseTime: new Date(Date.now() + getIntervalMs(stream.interval_type))
    });
    
    res.json({
      success: true,
      txHash: result.txHash
    });
    
  } catch (error) {
    console.error('Error resuming stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Cancel stream (either party)
 */
exports.cancelStream = async (req, res) => {
  try {
    const { streamId } = req.body;
    const userAddress = req.user.wallet_address;
    
    const stream = await StreamingPayment.findById(streamId);
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    if (stream.seller_address !== userAddress && stream.buyer_address !== userAddress) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    const result = await cancelStreamOnChain(streamId);
    
    await StreamingPayment.updateStatus(streamId, 'cancelled');
    
    res.json({
      success: true,
      txHash: result.txHash,
      remainingBalance: result.remainingBalance
    });
    
  } catch (error) {
    console.error('Error cancelling stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get stream details
 */
exports.getStream = async (req, res) => {
  try {
    const { streamId } = req.params;
    
    // Try DB first
    let stream = await StreamingPayment.findById(streamId);
    
    // Optionally sync with chain
    if (stream) {
      const chainData = await getStreamFromChain(streamId);
      if (chainData) {
        // Merge chain data if needed
        stream.chainStatus = chainData.status;
        stream.chainNextRelease = chainData.nextReleaseTime;
        stream.chainTotalReleased = chainData.totalReleased;
      }
    }
    
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    // Check authorization
    if (stream.seller_address !== req.user.wallet_address && 
        stream.buyer_address !== req.user.wallet_address) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json(stream);
    
  } catch (error) {
    console.error('Error getting stream:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get seller's streams
 */
exports.getSellerStreams = async (req, res) => {
  try {
    const streams = await StreamingPayment.findBySeller(req.user.wallet_address);
    res.json(streams);
  } catch (error) {
    console.error('Error getting seller streams:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get buyer's streams
 */
exports.getBuyerStreams = async (req, res) => {
  try {
    const streams = await StreamingPayment.findByBuyer(req.user.wallet_address);
    res.json(streams);
  } catch (error) {
    console.error('Error getting buyer streams:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all streams for current user
 */
exports.getMyStreams = async (req, res) => {
  try {
    const address = req.user.wallet_address;
    
    const [asSeller, asBuyer] = await Promise.all([
      StreamingPayment.findBySeller(address),
      StreamingPayment.findByBuyer(address)
    ]);
    
    // Merge and sort by date
    const allStreams = [...asSeller, ...asBuyer].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
    
    // Remove duplicates
    const uniqueStreams = Array.from(
      new Map(allStreams.map(s => [s.stream_id, s])).values()
    );
    
    res.json(uniqueStreams);
  } catch (error) {
    console.error('Error getting my streams:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Helper function to get interval in milliseconds
 */
function getIntervalMs(interval) {
  const msPerDay = 24 * 60 * 60 * 1000;
  switch (interval) {
    case 'daily':
      return msPerDay;
    case 'weekly':
      return 7 * msPerDay;
    case 'monthly':
    default:
      return 30 * msPerDay;
  }
}
