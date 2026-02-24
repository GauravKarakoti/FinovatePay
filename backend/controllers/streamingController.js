const { ethers } = require('ethers');
const errorResponse = require('../utils/errorResponse');
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
      return errorResponse(res, 'Missing required fields', 400);
    }
    
    if (!['daily', 'weekly', 'monthly'].includes(interval.toLowerCase())) {
      return errorResponse(res, 'Invalid interval. Must be daily, weekly, or monthly', 400);
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
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    if (stream.buyer_address !== buyerAddress) {
      return errorResponse(res, 'Not authorized', 403);
    }
    
    if (stream.status !== 'pending') {
      return errorResponse(res, 'Stream is not pending', 400);
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
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    if (stream.status !== 'active') {
      return errorResponse(res, 'Stream is not active', 400);
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
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    if (stream.buyer_address !== userAddress) {
      return errorResponse(res, 'Only buyer can pause', 403);
    }
    
    const result = await pauseStreamOnChain(streamId);
    await StreamingPayment.updateStatus(streamId, 'paused');
    
    res.json({
      success: true,
      txHash: result.txHash
    });
    
  } catch (error) {
    console.error('Error pausing stream:', error);
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    if (stream.buyer_address !== userAddress) {
      return errorResponse(res, 'Only buyer can resume', 403);
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
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    if (stream.seller_address !== userAddress && stream.buyer_address !== userAddress) {
      return errorResponse(res, 'Not authorized', 403);
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
    return errorResponse(res, error, 500);
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
      return errorResponse(res, 'Stream not found', 404);
    }
    
    // Check authorization
    if (stream.seller_address !== req.user.wallet_address && 
        stream.buyer_address !== req.user.wallet_address) {
      return errorResponse(res, 'Not authorized', 403);
    }
    
    res.json(stream);
    
  } catch (error) {
    console.error('Error getting stream:', error);
    return errorResponse(res, error, 500);
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
    return errorResponse(res, error, 500);
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
    return errorResponse(res, error, 500);
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
    return errorResponse(res, error, 500);
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
