// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title InvoiceAuction
 * @author FinovatePay Team
 * @notice Allows sellers to auction invoices to multiple investors who bid for the best yield/rate
 */
contract InvoiceAuction is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Auction status enum
    enum AuctionStatus { Created, Active, Ended, Cancelled, Settled }

    // Auction structure
    struct Auction {
        bytes32 auctionId;
        address seller;
        address invoiceContract;
        uint256 invoiceId;
        uint256 faceValue;
        address paymentToken;
        uint256 minYieldBps; // Minimum yield asked by seller (in basis points)
        uint256 auctionEndTime;
        uint256 minBidIncrement; // Minimum increment for each bid
        uint256 highestBid;
        address highestBidder;
        AuctionStatus status;
        uint256 createdAt;
    }

    // Bid structure
    struct Bid {
        bytes32 bidId;
        bytes32 auctionId;
        address bidder;
        uint256 yieldBps; // Yield rate offered (lower is better for seller)
        uint256 bidAmount;
        uint256 timestamp;
    }

    // Platform fee (in basis points)
    uint256 public platformFeeBps = 250; // 2.5% default

    // Auction mapping
    mapping(bytes32 => Auction) public auctions;

    // Bids mapping (auctionId => array of bids)
    mapping(bytes32 => Bid[]) public auctionBids;

    // Track address auctions
    mapping(address => bytes32[]) public sellerAuctions;
    mapping(address => bytes32[]) public bidderAuctions;

    // Events
    event AuctionCreated(
        bytes32 indexed auctionId,
        address indexed seller,
        address invoiceContract,
        uint256 invoiceId,
        uint256 faceValue,
        uint256 minYieldBps,
        uint256 auctionEndTime
    );

    event AuctionStarted(bytes32 indexed auctionId);

    event BidPlaced(
        bytes32 indexed auctionId,
        address indexed bidder,
        uint256 yieldBps,
        uint256 bidAmount
    );

    event AuctionEnded(
        bytes32 indexed auctionId,
        address winner,
        uint256 winningBid,
        uint256 winningYield
    );

    event AuctionSettled(
        bytes32 indexed auctionId,
        address winner,
        uint256 amount,
        uint256 platformFee
    );

    event AuctionCancelled(bytes32 indexed auctionId);

    event PlatformFeeUpdated(uint256 newFeeBps);

    /**
     * @notice Create a new invoice auction
     * @param _auctionId Unique auction ID
     * @param _invoiceContract Address of the invoice contract
     * @param _invoiceId ID of the invoice being auctioned
     * @param _faceValue Face value of the invoice
     * @param _paymentToken Token address for payment (address(0) for native)
     * @param _minYieldBps Minimum yield rate seller accepts (in bps)
     * @param _duration Auction duration in seconds
     * @param _minBidIncrement Minimum increment for bids
     */
    function createAuction(
        bytes32 _auctionId,
        address _invoiceContract,
        uint256 _invoiceId,
        uint256 _faceValue,
        address _paymentToken,
        uint256 _minYieldBps,
        uint256 _duration,
        uint256 _minBidIncrement
    ) external nonReentrant {
        require(_auctionId != bytes32(0), "Invalid auction ID");
        require(_invoiceContract != address(0), "Invalid invoice contract");
        require(_faceValue > 0, "Invalid face value");
        require(_minYieldBps > 0 && _minYieldBps <= 10000, "Invalid min yield");
        require(_duration > 0 && _duration <= 30 days, "Invalid duration");
        require(auctions[_auctionId].createdAt == 0, "Auction already exists");

        Auction storage auction = auctions[_auctionId];
        auction.auctionId = _auctionId;
        auction.seller = msg.sender;
        auction.invoiceContract = _invoiceContract;
        auction.invoiceId = _invoiceId;
        auction.faceValue = _faceValue;
        auction.paymentToken = _paymentToken;
        auction.minYieldBps = _minYieldBps;
        auction.auctionEndTime = block.timestamp + _duration;
        auction.minBidIncrement = _minBidIncrement;
        auction.highestBid = 0;
        auction.highestBidder = address(0);
        auction.status = AuctionStatus.Created;
        auction.createdAt = block.timestamp;

        sellerAuctions[msg.sender].push(_auctionId);

        emit AuctionCreated(
            _auctionId,
            msg.sender,
            _invoiceContract,
            _invoiceId,
            _faceValue,
            _minYieldBps,
            auction.auctionEndTime
        );
    }

    /**
     * @notice Start an auction (seller calls after creation)
     */
    function startAuction(bytes32 _auctionId) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.seller == msg.sender, "Not auction seller");
        require(auction.status == AuctionStatus.Created, "Auction not in created state");
        require(block.timestamp < auction.auctionEndTime, "Auction end time passed");

        auction.status = AuctionStatus.Active;

        emit AuctionStarted(_auctionId);
    }

    /**
     * @notice Place a bid on an auction
     * @param _auctionId Auction ID
     * @param _yieldBps Yield rate offered (lower is better)
     */
    function placeBid(bytes32 _auctionId, uint256 _yieldBps) external payable nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.Active, "Auction not active");
        require(block.timestamp < auction.auctionEndTime, "Auction ended");
        require(msg.sender != auction.seller, "Seller cannot bid");
        require(_yieldBps > 0 && _yieldBps <= 10000, "Invalid yield");
        require(_yieldBps <= auction.minYieldBps, "Yield too high");

        uint256 bidAmount;
        if (auction.paymentToken == address(0)) {
            // Native currency bid
            bidAmount = msg.value;
        } else {
            // ERC20 token bid
            require(msg.value == 0, "Should not send native with ERC20 bid");
            IERC20 token = IERC20(auction.paymentToken);
            bidAmount = auction.faceValue; // Bid the full face value
            
            // Transfer tokens from bidder
            token.safeTransferFrom(msg.sender, address(this), bidAmount);
        }

        // Check if bid is valid
        uint256 minValidBid = auction.highestBid == 0 
            ? (auction.faceValue * (10000 - auction.minYieldBps)) / 10000 // First bid must be at least min yield discount
            : auction.highestBid + auction.minBidIncrement;

        require(bidAmount >= minValidBid, "Bid too low");

        // Refund previous highest bidder
        if (auction.highestBidder != address(0) && auction.highestBid > 0) {
            _refundBidder(auction.highestBidder, auction.highestBid, auction.paymentToken);
        }

        // Update highest bid
        auction.highestBid = bidAmount;
        auction.highestBidder = msg.sender;

        // Record bid
        bytes32 bidId = keccak256(abi.encodePacked(_auctionId, msg.sender, block.timestamp));
        auctionBids[_auctionId].push(Bid({
            bidId: bidId,
            auctionId: _auctionId,
            bidder: msg.sender,
            yieldBps: _yieldBps,
            bidAmount: bidAmount,
            timestamp: block.timestamp
        }));

        bidderAuctions[msg.sender].push(_auctionId);

        emit BidPlaced(_auctionId, msg.sender, _yieldBps, bidAmount);
    }

    /**
     * @notice End an auction (can be called by anyone after end time)
     */
    function endAuction(bytes32 _auctionId) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.Active, "Auction not active");
        require(block.timestamp >= auction.auctionEndTime, "Auction not ended yet");

        auction.status = AuctionStatus.Ended;

        if (auction.highestBidder != address(0)) {
            emit AuctionEnded(
                _auctionId,
                auction.highestBidder,
                auction.highestBid,
                0 // Will be fetched from bid
            );
        } else {
            emit AuctionCancelled(_auctionId);
        }
    }

    /**
     * @notice Settle the auction - transfer invoice to winner and funds to seller
     */
    function settleAuction(bytes32 _auctionId) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.status == AuctionStatus.Ended, "Auction not ended");
        require(auction.highestBidder != address(0), "No winner");

        auction.status = AuctionStatus.Settled;

        // Calculate platform fee
        uint256 platformFee = (auction.highestBid * platformFeeBps) / 10000;
        uint256 sellerAmount = auction.highestBid - platformFee;

        // Transfer payment to seller
        if (auction.paymentToken == address(0)) {
            (bool success, ) = payable(auction.seller).call{value: sellerAmount}("");
            require(success, "Transfer to seller failed");
            
            // Transfer platform fee to fee wallet
            (bool feeSuccess, ) = payable(owner()).call{value: platformFee}("");
            require(feeSuccess, "Transfer fee failed");
        } else {
            IERC20 token = IERC20(auction.paymentToken);
            token.safeTransfer(auction.seller, sellerAmount);
            token.safeTransfer(owner(), platformFee);
        }

        emit AuctionSettled(
            _auctionId,
            auction.highestBidder,
            auction.highestBid,
            platformFee
        );
    }

    /**
     * @notice Cancel an auction (seller only, before auction ends)
     */
    function cancelAuction(bytes32 _auctionId) external nonReentrant {
        Auction storage auction = auctions[_auctionId];
        require(auction.seller == msg.sender, "Not auction seller");
        require(auction.status == AuctionStatus.Created || auction.status == AuctionStatus.Active, "Cannot cancel");

        // Refund highest bidder if exists
        if (auction.highestBidder != address(0) && auction.highestBid > 0) {
            _refundBidder(auction.highestBidder, auction.highestBid, auction.paymentToken);
        }

        auction.status = AuctionStatus.Cancelled;

        emit AuctionCancelled(_auctionId);
    }

    /**
     * @notice Get auction details
     */
    function getAuction(bytes32 _auctionId) external view returns (
        bytes32 auctionId,
        address seller,
        address invoiceContract,
        uint256 invoiceId,
        uint256 faceValue,
        address paymentToken,
        uint256 minYieldBps,
        uint256 auctionEndTime,
        uint256 minBidIncrement,
        uint256 highestBid,
        address highestBidder,
        uint8 status,
        uint256 createdAt,
        uint256 bidCount
    ) {
        Auction storage auction = auctions[_auctionId];
        return (
            auction.auctionId,
            auction.seller,
            auction.invoiceContract,
            auction.invoiceId,
            auction.faceValue,
            auction.paymentToken,
            auction.minYieldBps,
            auction.auctionEndTime,
            auction.minBidIncrement,
            auction.highestBid,
            auction.highestBidder,
            uint8(auction.status),
            auction.createdAt,
            auctionBids[_auctionId].length
        );
    }

    /**
     * @notice Get all bids for an auction
     */
    function getAuctionBids(bytes32 _auctionId) external view returns (
        bytes32[] memory bidIds,
        address[] memory bidders,
        uint256[] memory yieldBps,
        uint256[] memory bidAmounts,
        uint256[] memory timestamps
    ) {
        Bid[] storage bids = auctionBids[_auctionId];
        uint256 count = bids.length;
        
        bidIds = new bytes32[](count);
        bidders = new address[](count);
        yieldBps = new uint256[](count);
        bidAmounts = new uint256[](count);
        timestamps = new uint256[](count);

        for (uint256 i = 0; i < count; i++) {
            Bid storage bid = bids[i];
            bidIds[i] = bid.bidId;
            bidders[i] = bid.bidder;
            yieldBps[i] = bid.yieldBps;
            bidAmounts[i] = bid.bidAmount;
            timestamps[i] = bid.timestamp;
        }
    }

    /**
     * @notice Get all auctions for a seller
     */
    function getSellerAuctions(address _seller) external view returns (bytes32[] memory) {
        return sellerAuctions[_seller];
    }

    /**
     * @notice Get all auctions a bidder has participated in
     */
    function getBidderAuctions(address _bidder) external view returns (bytes32[] memory) {
        return bidderAuctions[_bidder];
    }

    /**
     * @notice Update platform fee (owner only)
     */
    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high"); // Max 10%
        platformFeeBps = _feeBps;
        emit PlatformFeeUpdated(_feeBps);
    }

    /**
     * @notice Withdraw native tokens (owner only)
     */
    function withdrawNative() external onlyOwner nonReentrant {
        payable(owner()).transfer(address(this).balance);
    }

    /**
     * @notice Withdraw ERC20 tokens (owner only)
     */
    function withdrawToken(address _token) external onlyOwner nonReentrant {
        IERC20 token = IERC20(_token);
        token.safeTransfer(owner(), token.balanceOf(address(this)));
    }

    /**
     * @dev Internal function to refund a bidder
     */
    function _refundBidder(address _bidder, uint256 _amount, address _paymentToken) internal {
        if (_paymentToken == address(0)) {
            (bool success, ) = payable(_bidder).call{value: _amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(_paymentToken).safeTransfer(_bidder, _amount);
        }
    }

    // Fallback receive function
    receive() external payable {}
}
