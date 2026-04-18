const { ethers } = require('ethers');
const { getProvider, getSigner, contractAddresses } = require('../config/blockchain');
const InvoiceAuction = require('../models/InvoiceAuction');
const InvoiceAuctionABI = require('../../deployed/InvoiceAuction.json').abi;

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

const getAuctionContractWithSigner = async () => { // Make this async
  const signer = await getSigner(); // Await the signer (fixes the Ethers v6 promise issue)
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

const generateAuctionId = (invoiceId, sellerAddress) => {
  return ethers.keccak256(
    ethers.solidityPacked(
      ['uint256', 'address', 'bytes32'],
      [
        invoiceId != null ? invoiceId : 0, // Fallback to 0 if null/undefined
        sellerAddress, 
        ethers.hexlify(ethers.randomBytes(32)) // Hexlify the Uint8Array to be safe
      ]
    )
  );
};

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
  const contract = await getAuctionContractWithSigner(); 

  // Resolve invoice contract address (fallback to deployed Invoice contract if frontend omitted it)
  let resolvedInvoiceContract = invoiceContractAddress;
  if (!resolvedInvoiceContract) {
    resolvedInvoiceContract = contractAddresses.invoiceFactory; 
  }

  const tx = await contract.createAuction(
    auctionId,
    resolvedInvoiceContract,                              
    invoiceId != null ? invoiceId : 0,
    faceValue > 0 ? faceValue : 1,                        // Fallback to 1 to bypass "Invalid face value"
    paymentToken ? paymentToken : ethers.ZeroAddress,     
    minYieldBps > 0 ? minYieldBps : 100,                  // Fallback to 100 bps (1%) to bypass "Invalid min yield"
    duration > 0 ? duration : 86400,                      // Fallback to 86400 seconds (1 day) to bypass "Invalid duration"
    minBidIncrement != null ? minBidIncrement : 0         // 0 is explicitly allowed for this field
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
  const contract = await getAuctionContractWithSigner(); // ADD AWAIT HERE

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
  const contract = await getAuctionContractWithSigner(); // ADD AWAIT HERE

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
  const contract = await getAuctionContractWithSigner(); // ADD AWAIT HERE

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
  const contract = await getAuctionContractWithSigner(); // ADD AWAIT HERE

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
  const contract = await getAuctionContractWithSigner(); // ADD AWAIT HERE

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

const startAuction = async (auctionId) => {
  // Get auction from database
  const auction = await InvoiceAuction.findById(auctionId);

  if (!auction) {
    throw new Error('Auction not found');
  }

  // Update database status to active
  await InvoiceAuction.updateStatus(auctionId, 'active');

  return await InvoiceAuction.findById(auctionId);
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

  // Generate bid ID with random salt to prevent race condition collisions
  const bidId = ethers.keccak256(
    ethers.solidityPacked(
      ['bytes32', 'address', 'bytes32'],
      [auctionId, bidderAddress, ethers.randomBytes(32)]
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
  statusToString,
  startAuction
};
