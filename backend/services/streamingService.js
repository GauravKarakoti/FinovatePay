const { ethers } = require('ethers');
const { getProvider, getSigner, contractAddresses } = require('../config/blockchain');

// StreamingPayment contract ABI (minimal for now)
const StreamingPaymentABI = [
  // Struct
  "enum Interval { Daily, Weekly, Monthly }",
  "enum StreamStatus { Pending, Active, Paused, Cancelled, Completed }",
  "struct Stream { bytes32 streamId; address seller; address buyer; uint256 amount; uint256 perIntervalAmount; address token; Interval interval; StreamStatus status; uint256 startTime; uint256 nextReleaseTime; uint256 totalReleased; uint256 totalPaid; uint256 intervalsCompleted; uint256 createdAt; string description; }",
  
  // Read functions
  "function streams(bytes32) view returns (tuple(bytes32 streamId, address seller, address buyer, uint256 amount, uint256 perIntervalAmount, address token, uint8 interval, uint8 status, uint256 startTime, uint256 nextReleaseTime, uint256 totalReleased, uint256 totalPaid, uint256 intervalsCompleted, uint256 createdAt, string description))",
  "function canRelease(bytes32) view returns (bool)",
  "function getRemainingBalance(bytes32) view returns (uint256)",
  "function protocolFeeBps() view returns (uint256)",
  
  // Write functions
  "function createStream(bytes32, address, uint256, uint8, uint256, address, string) returns (bool)",
  "function approveStream(bytes32) payable",
  "function releasePayment(bytes32)",
  "function pauseStream(bytes32)",
  "function resumeStream(bytes32)",
  "function cancelStream(bytes32)",
  
  // Events
  "event StreamCreated(bytes32 indexed, address indexed, address indexed, uint256, uint256, address, uint8, string)",
  "event StreamApproved(bytes32 indexed, address indexed, uint256)",
  "event StreamStarted(bytes32 indexed, uint256, uint256)",
  "event PaymentReleased(bytes32 indexed, uint256, uint256)",
  "event StreamPaused(bytes32 indexed, address indexed)",
  "event StreamResumed(bytes32 indexed, address indexed)",
  "event StreamCancelled(bytes32 indexed, address indexed, uint256)",
  "event StreamCompleted(bytes32 indexed, uint256, uint256)"
];

let streamingContract = null;
let configError = null;

/**
 * Get StreamingPayment contract instance
 */
const getStreamingContract = (signerOrProvider) => {
  if (!contractAddresses.streamingPayment) {
    console.warn("[StreamingService] StreamingPayment address not configured");
    return null;
  }
  
  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    return new ethers.Contract(
      contractAddresses.streamingPayment,
      StreamingPaymentABI,
      provider
    );
  } catch (error) {
    console.error("[StreamingService] Failed to get contract:", error.message);
    return null;
  }
};

/**
 * Get contract with signer for write operations
 */
const getStreamingContractWithSigner = () => {
  const signer = getSigner();
  if (!signer) {
    throw new Error('Signer not available');
  }
  return getStreamingContract(signer);
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
  const contract = getStreamingContractWithSigner();
  
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

/**
 * Approve and fund a stream (buyer)
 */
const approveStreamOnChain = async (streamId, amount, tokenAddress) => {
  const contract = getStreamingContractWithSigner();
  
  const overrides = tokenAddress === ethers.ZeroAddress ? { value: amount } : {};
  
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
  const contract = getStreamingContractWithSigner();
  
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
  const contract = getStreamingContractWithSigner();
  
  const tx = await contract.pauseStream(streamId);
  await tx.wait();
  
  return { txHash: tx.hash };
};

/**
 * Resume a paused stream
 */
const resumeStreamOnChain = async (streamId) => {
  const contract = getStreamingContractWithSigner();
  
  const tx = await contract.resumeStream(streamId);
  await tx.wait();
  
  return { txHash: tx.hash };
};

/**
 * Cancel a stream
 */
const cancelStreamOnChain = async (streamId) => {
  const contract = getStreamingContractWithSigner();
  
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
  const contract = getStreamingContract();
  
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
  const contract = getStreamingContract();
  
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
  const contract = getStreamingContract();
  
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
  getStreamingContractWithSigner,
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
