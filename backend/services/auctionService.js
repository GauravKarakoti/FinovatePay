const { ethers } = require('ethers');
const { getProvider, getSigner, contractAddresses } = require('../config/blockchain');
const InvoiceAuction = require('../models/InvoiceAuction');

// InvoiceAuction contract ABI
const InvoiceAuctionABI = [
  // Struct
  "enum AuctionStatus { Created, Active, Ended, Cancelled, Settled }",
  "struct Auction { bytes32 auctionId; address seller; address invoiceContract; uint256 invoiceId; uint256 faceValue; address paymentToken; uint256 minYieldBps; uint256 auctionEndTime; uint256 minBidIncrement; uint256 highestBid; address highestBidder; AuctionStatus status; uint256 createdAt; }",
  "struct Bid { bytes32 bidId; bytes32 auctionId; address bidder; uint256 yieldBps; uint256 bidAmount; uint256 timestamp; }",

  // Read functions
  "function auctions(bytes32) view returns (tuple(bytes32 auctionId, address seller, address invoiceContract, uint256 invoiceId, uint256 faceValue, address paymentToken, uint256 minYieldBps, uint256 auctionEndTime, uint256 minBidIncrement, uint256 highestBid, address highestBidder, uint8 status, uint256 createdAt))",
  "function auctionBids(bytes32, uint256) view returns (tuple(bytes32 bidId, bytes32 auctionId, address bidder, uint256 yieldBps, uint256 bidAmount, uint256 timestamp))",
  "function platformFeeBps() view returns (uint256)",
  "function sellerAuctions(address) view returns (bytes32[])",
  "function bidderAuctions(address) view returns (bytes32[])",

  // Write functions
  "function createAuction(bytes32, address, uint256, uint256, address, uint256, uint256, uint256) returns (bool)",
  "function startAuction(bytes32)",
  "function placeBid(bytes32, uint256) payable",
  "function endAuction(bytes32)",
  "function settleAuction(bytes32)",
  "function cancelAuction(bytes32)",
  "function setPlatformFee(uint256)",

  // Events
  "event AuctionCreated(bytes32 indexed, address indexed, address indexed, uint256, uint256, uint256, uint256, uint256)",
  "event AuctionStarted(bytes32 indexed)",
  "event BidPlaced(bytes32 indexed, address indexed, uint256, uint256)",
  "event AuctionEnded(bytes32 indexed, address, uint256, uint256)",
  "event AuctionSettled(bytes32 indexed, address, uint256, uint256)",
  "event AuctionCancelled(bytes32 indexed)",
  "event PlatformFeeUpdated(uint256)"
];

let auctionContract = null;

/**
 * Get InvoiceAuction contract instance
 */
const getAuctionContract = (signerOrProvider) => {
  if (!contractAddresses.invoiceAuction) {
    console.warn("[AuctionService] InvoiceAuction address not configured");
    return null;
  }

  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }

    return new ethers.Contract(
      contractAddresses.invoiceAuction,
      InvoiceAuctionABI,
      provider
    );
  } catch (error) {
    console.error("[AuctionService] Failed to get contract:", error.message);
    return null;
  }
};

/**
 * Get contract with signer for write operations
 */
const getAuctionContractWithSigner = () => {
  const signer = getSigner();
  if (!signer) {
    throw new Error('Signer not available');
  }
  return getAuctionContract(signer);
};

/**
 * Convert auction status enum to string
 */
const statusToString = (status) => {
  const statusMap = ['created', 'active', 'ended', 'cancelled', 'settled'];
  return statusMap[status] || 'created';
};

/**
 * Generate auction ID
 */
const generateAuctionId = (invoiceId, sellerAddress) => {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'uint256'],
      [invoiceId, sellerAddress, Date.now()]
    )
  );
};

/**
 * Create a new auction on chain
 */
const createAuctionOnChain = async (
  auctionId,
  invoiceContractAddress,
  invoiceId,
  faceValue,
  paymentToken,
  minYieldBps,
  duration,
  minBidIncrement
) => {
  const contract = getAuctionContractWithSigner();

  const tx = await contract.createAuction(
    auctionId,
    invoiceContractAddress,
    invoiceId,
    faceValue,
    paymentToken,
    minYieldBps,
    duration,
    minBidIncrement
  );

  const receipt = await tx.wait();

  // Find AuctionCreated event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'AuctionCreated');

  return {
    txHash: tx.hash,
    event: event ? event.args : null
  };
};

/**
 * Start an auction
 */
const startAuctionOnChain = async (auctionId) => {
  const contract = getAuctionContractWithSigner();

  const tx = await contract.startAuction(auctionId);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt.blockNumber
  };
};

/**
 * Place a bid on an auction
 */
const placeBidOnChain = async (auctionId, yieldBps, bidAmount, paymentToken) => {
  const contract = getAuctionContractWithSigner();

  const overrides = paymentToken === ethers.ZeroAddress ? { value: bidAmount } : {};

  const tx = await contract.placeBid(auctionId, yieldBps, overrides);
  const receipt = await tx.wait();

  // Find BidPlaced event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'BidPlaced');

  return {
    txHash: tx.hash,
    bidAmount: event ? event.args.bidAmount : null,
    yieldBps: event ? event.args.yieldBps : null
  };
};

/**
 * End an auction
 */
const endAuctionOnChain = async (auctionId) => {
  const contract = getAuctionContractWithSigner();

  const tx = await contract.endAuction(auctionId);
  const receipt = await tx.wait();

  // Find AuctionEnded event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'AuctionEnded');

  return {
    txHash: tx.hash,
    winner: event ? event.args.winner : null,
    winningBid: event ? event.args.winningBid : null
  };
};

/**
 * Settle an auction
 */
const settleAuctionOnChain = async (auctionId) => {
  const contract = getAuctionContractWithSigner();

  const tx = await contract.settleAuction(auctionId);
  const receipt = await tx.wait();

  // Find AuctionSettled event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'AuctionSettled');

  return {
    txHash: tx.hash,
    winner: event ? event.args.winner : null,
    amount: event ? event.args.amount : null,
    platformFee: event ? event.args.platformFee : null
  };
};

/**
 * Cancel an auction
 */
const cancelAuctionOnChain = async (auctionId) => {
  const contract = getAuctionContractWithSigner();

  const tx = await contract.cancelAuction(auctionId);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash
  };
};

/**
 * Get auction details from chain
 */
const getAuctionFromChain = async (auctionId) => {
  const contract = getAuctionContract();

  if (!contract) {
    return null;
  }

  try {
    const auction = await contract.auctions(auctionId);

    return {
      auctionId: auction.auctionId,
      seller: auction.seller,
      invoiceContract: auction.invoiceContract,
      invoiceId: auction.invoiceId.toString(),
      faceValue: auction.faceValue.toString(),
      paymentToken: auction.paymentToken,
      minYieldBps: auction.minYieldBps.toString(),
      auctionEndTime: new Date(auction.auctionEndTime * 1000),
      minBidIncrement: auction.minBidIncrement.toString(),
      highestBid: auction.highestBid.toString(),
      highestBidder: auction.highestBidder,
      status: statusToString(auction.status),
      createdAt: new Date(auction.createdAt * 1000)
    };
  } catch (error) {
    console.error("[AuctionService] Error getting auction:", error.message);
    return null;
  }
};

/**
 * Get auction bids from chain
 */
const getAuctionBidsFromChain = async (auctionId) => {
  const contract = getAuctionContract();

  if (!contract) {
    return [];
  }

  try {
    // Get bid count from contract (need to track separately or use events)
    // For now, we'll get from database
    return [];
  } catch (error) {
    console.error("[AuctionService] Error getting bids:", error.message);
    return [];
  }
};

/**
 * Create auction in database
 */
const createAuction = async (auctionData) => {
  return await InvoiceAuction.create(auctionData);
};

/**
 * Get auction from database
 */
const getAuction = async (auctionId) => {
  return await InvoiceAuction.findById(auctionId);
};

/**
 * Get all active auctions
 */
const getActiveAuctions = async (limit = 50) => {
  return await InvoiceAuction.findActiveAuctions(limit);
};

/**
 * Get auctions by seller
 */
const getSellerAuctions = async (sellerAddress) => {
  return await InvoiceAuction.findBySeller(sellerAddress);
};

/**
 * Get auctions by bidder
 */
const getBidderAuctions = async (bidderAddress) => {
  return await InvoiceAuction.findBidsByBidder(bidderAddress);
};

/**
 * Get auction bids from database
 */
const getAuctionBids = async (auctionId) => {
  return await InvoiceAuction.findBidsByAuction(auctionId);
};

/**
 * Place a bid (database + chain)
 */
const placeBid = async (bidData) => {
  const { auctionId, bidderAddress, yieldBps, bidAmount, txHash } = bidData;

  // Generate bid ID
  const bidId = ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'uint256'],
      [auctionId, bidderAddress, Date.now()]
    )
  );

  // Save to database
  const bid = await InvoiceAuction.addBid({
    bidId,
    auctionId,
    bidderAddress,
    yieldBps,
    bidAmount
  });

  // Update auction highest bid
  await InvoiceAuction.updateStatus(auctionId, 'active', {
    highestBid: bidAmount,
    highestBidder: bidderAddress
  });

  // Mark previous best bid as outbid
  const bestBid = await InvoiceAuction.getBestBid(auctionId);
  if (bestBid && bestBid.bid_id !== bidId) {
    await InvoiceAuction.updateBidStatus(bestBid.bid_id, 'outbid');
  }

  return bid;
};

/**
 * End auction (database + chain)
 */
const endAuction = async (auctionId) => {
  // Get auction from database
  const auction = await InvoiceAuction.findById(auctionId);

  if (!auction) {
    throw new Error('Auction not found');
  }

  if (auction.status !== 'active') {
    throw new Error('Auction is not active');
  }

  // Update database
  await InvoiceAuction.updateStatus(auctionId, 'ended');

  // If there's a winner, mark their bid as winner
  if (auction.highest_bidder) {
    const bestBid = await InvoiceAuction.getBestBid(auctionId);
    if (bestBid) {
      await InvoiceAuction.updateBidStatus(bestBid.bid_id, 'winner');
    }
  }

  return auction;
};

/**
 * Settle auction (database + chain)
 */
const settleAuction = async (auctionId, settleData) => {
  const { winnerAddress, winningYieldBps, platformFee, txHash } = settleData;

  // Update database
  await InvoiceAuction.updateStatus(auctionId, 'settled', {
    winnerAddress,
    winningYieldBps,
    platformFee,
    txHash
  });

  // Mark winning bid as settled
  const winningBid = await InvoiceAuction.findWinningBid(auctionId);
  if (winningBid) {
    await InvoiceAuction.updateBidStatus(winningBid.bid_id, 'winner');
  }

  return await InvoiceAuction.findById(auctionId);
};

/**
 * Cancel auction
 */
const cancelAuction = async (auctionId) => {
  // Update database
  await InvoiceAuction.updateStatus(auctionId, 'cancelled');

  // Mark all active bids as cancelled
  const bids = await InvoiceAuction.findBidsByAuction(auctionId);
  for (const bid of bids) {
    if (bid.status === 'active') {
      await InvoiceAuction.updateBidStatus(bid.bid_id, 'cancelled');
    }
  }

  return await InvoiceAuction.findById(auctionId);
};

/**
 * Get auction stats
 */
const getAuctionStats = async () => {
  return await InvoiceAuction.getAuctionStats();
};

/**
 * Get seller stats
 */
const getSellerStats = async (sellerAddress) => {
  return await InvoiceAuction.getSellerStats(sellerAddress);
};

/**
 * Get bidder stats
 */
const getBidderStats = async (bidderAddress) => {
  return await InvoiceAuction.getBidderStats(bidderAddress);
};

module.exports = {
  getAuctionContract,
  getAuctionContractWithSigner,
  createAuctionOnChain,
  startAuctionOnChain,
  placeBidOnChain,
  endAuctionOnChain,
  settleAuctionOnChain,
  cancelAuctionOnChain,
  getAuctionFromChain,
  getAuctionBidsFromChain,
  createAuction,
  getAuction,
  getActiveAuctions,
  getSellerAuctions,
  getBidderAuctions,
  getAuctionBids,
  placeBid,
  endAuction,
  settleAuction,
  cancelAuction,
  getAuctionStats,
  getSellerStats,
  getBidderStats,
  generateAuctionId,
  statusToString
};
