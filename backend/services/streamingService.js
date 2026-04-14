const { ethers } = require('ethers');
const { getSigner, contractAddresses } = require('../config/blockchain');


/**
 * Get StreamingPayment contract instance
*/
const getStreamingContract = async () => {
  if (!contractAddresses.streamingPayment) {
    console.warn("[StreamingService] StreamingPayment address not configured");
    return null;
  }
  
  const signer = await getSigner();
  const StreamingPaymentABI = require('../../deployed/StreamingPayment.json').abi;
  
  try {
    if (!signer) {
      throw new Error('Signer not available');
    }
    
    return new ethers.Contract(contractAddresses.streamingPayment, StreamingPaymentABI, signer);
  } catch (error) {
    console.error("[StreamingService] Failed to get contract:", error.message);
    return null;
  }
};

/**
 * Convert interval string to enum value
 */
const intervalToEnum = (interval) => {
  const intervalMap = {
    'daily': 0,
    'weekly': 1,
    'monthly': 2
  };
  return intervalMap[interval?.toLowerCase()] ?? 2; // Default to monthly
};

/**
 * Convert enum value to string
 */
const enumToInterval = (enumValue) => {
  const intervalMap = ['daily', 'weekly', 'monthly'];
  return intervalMap[enumValue] || 'monthly';
};

/**
 * Convert stream status enum to string
 */
const statusToString = (status) => {
  const statusMap = ['pending', 'active', 'paused', 'cancelled', 'completed'];
  return statusMap[status] || 'pending';
};

/**
 * Create a new streaming payment
 */
const createStreamOnChain = async (
  streamId,
  sellerAddress,
  buyerAddress,
  totalAmount,
  interval,
  numPayments,
  tokenAddress,
  description
) => {
  const contract = await getStreamingContract();
  
  const tx = await contract.createStream(
    streamId,
    buyerAddress,
    totalAmount,
    intervalToEnum(interval),
    numPayments,
    tokenAddress,
    description
  );
  
  const receipt = await tx.wait();
  
  // Find the StreamCreated event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'StreamCreated');
  
  return {
    txHash: tx.hash,
    event: event ? event.args : null
  };
};

const approveStreamOnChain = async (streamId, _dbAmount, tokenAddress) => {
  const contract = await getStreamingContract();
  
  // 👉 FIX: Fetch the exact required amount directly from the contract
  // This ensures the 1% protocol fee is correctly included in the msg.value
  const streamData = await contract.streams(streamId);
  const requiredAmount = streamData.amount;
  
  const isNativeToken = !tokenAddress || 
    tokenAddress.toLowerCase() === ethers.ZeroAddress.toLowerCase() ||
    tokenAddress === '0x0000000000000000000000000000000000000000';
    
  // Use the requiredAmount from the contract instead of the one from the DB
  const overrides = isNativeToken ? { value: requiredAmount } : {};
  
  const tx = await contract.approveStream(streamId, overrides);
  const receipt = await tx.wait();
  
  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
};

/**
 * Release payment for a completed interval
 */
const releasePaymentOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  const tx = await contract.releasePayment(streamId);
  const receipt = await tx.wait();
  
  // Find PaymentReleased event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'PaymentReleased');
  
  return {
    txHash: tx.hash,
    amount: event ? event.args.amount : null,
    intervalsCompleted: event ? event.args.intervalsCompleted : null
  };
};

/**
 * Pause a stream
 */
const pauseStreamOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  const tx = await contract.pauseStream(streamId);
  await tx.wait();
  
  return { txHash: tx.hash };
};

/**
 * Resume a paused stream
 */
const resumeStreamOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  const tx = await contract.resumeStream(streamId);
  await tx.wait();
  
  return { txHash: tx.hash };
};

/**
 * Cancel a stream
 */
const cancelStreamOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  const tx = await contract.cancelStream(streamId);
  const receipt = await tx.wait();
  
  // Find StreamCancelled event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'StreamCancelled');
  
  return {
    txHash: tx.hash,
    remainingBalance: event ? event.args.remainingBalance : null
  };
};

/**
 * Get stream details from chain
 */
const getStreamFromChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  if (!contract) {
    return null;
  }
  
  try {
    const stream = await contract.streams(streamId);
    
    return {
      streamId: stream.streamId,
      seller: stream.seller,
      buyer: stream.buyer,
      amount: stream.amount.toString(),
      perIntervalAmount: stream.perIntervalAmount.toString(),
      token: stream.token,
      interval: enumToInterval(stream.interval),
      status: statusToString(stream.status),
      startTime: stream.startTime > 0 ? new Date(stream.startTime * 1000) : null,
      nextReleaseTime: stream.nextReleaseTime > 0 ? new Date(stream.nextReleaseTime * 1000) : null,
      totalReleased: stream.totalReleased.toString(),
      totalPaid: stream.totalPaid.toString(),
      intervalsCompleted: stream.intervalsCompleted.toString(),
      createdAt: new Date(stream.createdAt * 1000),
      description: stream.description
    };
  } catch (error) {
    console.error("[StreamingService] Error getting stream:", error.message);
    return null;
  }
};

/**
 * Check if a stream can be released
 */
const canReleaseOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  if (!contract) {
    return false;
  }
  
  try {
    return await contract.canRelease(streamId);
  } catch {
    return false;
  }
};

/**
 * Get remaining balance
 */
const getRemainingBalanceOnChain = async (streamId) => {
  const contract = await getStreamingContract();
  
  if (!contract) {
    return '0';
  }
  
  try {
    return (await contract.getRemainingBalance(streamId)).toString();
  } catch {
    return '0';
  }
};

/**
 * Process due payments (for cron job or background job)
 */
const processDuePayments = async () => {
  const StreamingPayment = require('../models/StreamingPayment');
  
  // Get all active streams that are due for release
  const dueStreams = await StreamingPayment.getStreamsReadyForRelease();
  
  const results = [];
  
  for (const stream of dueStreams) {
    try {
      const canRelease = await canReleaseOnChain(stream.stream_id);
      
      if (canRelease) {
        const result = await releasePaymentOnChain(stream.stream_id);
        
        // Update database
        await StreamingPayment.incrementReleased(
          stream.stream_id,
          result.amount,
          result.intervalsCompleted
        );
        
        results.push({
          streamId: stream.stream_id,
          success: true,
          txHash: result.txHash,
          amount: result.amount
        });
      }
    } catch (error) {
      console.error(`Error processing stream ${stream.stream_id}:`, error);
      results.push({
        streamId: stream.stream_id,
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
};

module.exports = {
  getStreamingContract,
  createStreamOnChain,
  approveStreamOnChain,
  releasePaymentOnChain,
  pauseStreamOnChain,
  resumeStreamOnChain,
  cancelStreamOnChain,
  getStreamFromChain,
  canReleaseOnChain,
  getRemainingBalanceOnChain,
  processDuePayments,
  intervalToEnum,
  enumToInterval,
  statusToString
};
