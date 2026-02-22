// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import "./ComplianceManager.sol";

/**
 * @title StreamingPayment
 * @dev Smart contract for recurring/streaming payments
 * Allows sellers to create subscription invoices and buyers to stream funds over time
 */
contract StreamingPayment is ReentrancyGuard, Pausable, ERC2771Context {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/
    enum StreamStatus {
        Pending,      // Created by seller, waiting for buyer approval
        Active,       // Approved and streaming funds
        Paused,       // Temporarily paused by buyer
        Cancelled,    // Cancelled by either party
        Completed     // All payments completed
    }

    enum Interval {
        Daily,
        Weekly,
        Monthly
    }

    struct Stream {
        bytes32 streamId;
        address seller;
        address buyer;
        uint256 amount;           // Total subscription amount
        uint256 perIntervalAmount; // Amount released per interval
        address token;            // Payment token (USDC, etc.)
        Interval interval;
        StreamStatus status;
        uint256 startTime;
        uint256 nextReleaseTime;
        uint256 totalReleased;    // Total amount released so far
        uint256 totalPaid;        // Total amount paid by buyer
        uint256 intervalsCompleted;
        uint256 createdAt;
        string description;       // Subscription description
    }

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/
    mapping(bytes32 => Stream) public streams;
    mapping(address => bytes32[]) public userStreams;
    
    ComplianceManager public complianceManager;
    address public admin;
    address public treasury;
    
    // Protocol fee (in basis points, e.g., 100 = 1%)
    uint256 public protocolFeeBps = 100; // 1% default
    uint256 public constant MAX_FEE_BPS = 500; // Max 5%

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event StreamCreated(
        bytes32 indexed streamId,
        address indexed seller,
        address indexed buyer,
        uint256 amount,
        uint256 perIntervalAmount,
        address token,
        Interval interval,
        string description
    );

    event StreamApproved(
        bytes32 indexed streamId,
        address indexed buyer,
        uint256 fundedAmount
    );

    event StreamStarted(
        bytes32 indexed streamId,
        uint256 startTime,
        uint256 nextReleaseTime
    );

    event PaymentReleased(
        bytes32 indexed streamId,
        uint256 amount,
        uint256 intervalsCompleted
    );

    event StreamPaused(bytes32 indexed streamId, address indexed pauser);

    event StreamResumed(bytes32 indexed streamId, address indexed resumer);

    event StreamCancelled(
        bytes32 indexed streamId,
        address indexed canceller,
        uint256 remainingBalance
    );

    event StreamCompleted(
        bytes32 indexed streamId,
        uint256 totalReleased,
        uint256 intervalsCompleted
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyStreamSeller(bytes32 streamId) {
        require(streams[streamId].seller == _msgSender(), "Not seller");
        _;
    }

    modifier onlyStreamBuyer(bytes32 streamId) {
        require(streams[streamId].buyer == _msgSender(), "Not buyer");
        _;
    }

    modifier onlyStreamParticipant(bytes32 streamId) {
        require(
            streams[streamId].seller == _msgSender() || 
            streams[streamId].buyer == _msgSender(),
            "Not participant"
        );
        _;
    }

    modifier onlyCompliant(address account) {
        require(!complianceManager.isFrozen(account), "Account frozen");
        require(complianceManager.isKYCVerified(account), "KYC not verified");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _trustedForwarder,
        address _complianceManager,
        address _treasury
    ) ERC2771Context(_trustedForwarder) {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        treasury = _treasury;
    }

    /*//////////////////////////////////////////////////////////////
                            STREAM CREATION
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @dev Create a new subscription stream (called by seller)
     * @param _streamId Unique stream identifier
     * @param _buyer Buyer address who will pay
     * @param _totalAmount Total subscription amount
     * @param _interval Payment interval (Daily=0, Weekly=1, Monthly=2)
     * @param _numPayments Number of payments/interval
     * @param _token Payment token address
     * @param _description Subscription description
     */
    function createStream(
        bytes32 _streamId,
        address _buyer,
        uint256 _totalAmount,
        Interval _interval,
        uint256 _numPayments,
        address _token,
        string calldata _description
    ) external onlyCompliant(_msgSender()) whenNotPaused returns (bool) {
        require(streams[_streamId].seller == address(0), "Stream exists");
        require(_buyer != address(0), "Invalid buyer");
        require(_totalAmount > 0, "Invalid amount");
        require(_numPayments > 0, "Invalid payments");
        
        // Calculate per-interval amount
        uint256 perIntervalAmount = _totalAmount / _numPayments;
        require(perIntervalAmount > 0, "Amount too small");
        
        // Calculate total funding needed (including fees)
        uint256 totalWithFee = _calculateTotalWithFee(perIntervalAmount * _numPayments);
        
        streams[_streamId] = Stream({
            streamId: _streamId,
            seller: _msgSender(),
            buyer: _buyer,
            amount: totalWithFee,
            perIntervalAmount: perIntervalAmount,
            token: _token,
            interval: _interval,
            status: StreamStatus.Pending,
            startTime: 0,
            nextReleaseTime: 0,
            totalReleased: 0,
            totalPaid: 0,
            intervalsCompleted: 0,
            createdAt: block.timestamp,
            description: _description
        });
        
        userStreams[_msgSender()].push(_streamId);
        
        emit StreamCreated(
            _streamId,
            _msgSender(),
            _buyer,
            totalWithFee,
            perIntervalAmount,
            _token,
            _interval,
            _description
        );
        
        return true;
    }

    /**
     * @dev Buyer approves and funds the subscription
     * @param _streamId Stream identifier
     */
    function approveStream(bytes32 _streamId)
        external
        onlyCompliant(_msgSender())
        nonReentrant
        whenNotPaused
    {
        Stream storage stream = streams[_streamId];
        require(stream.seller != address(0), "Stream not found");
        require(_msgSender() == stream.buyer, "Not buyer");
        require(stream.status == StreamStatus.Pending, "Not pending");
        
        uint256 totalAmount = stream.amount;
        
        // Transfer tokens from buyer
        if (stream.token == address(0)) {
            require(msg.value >= totalAmount, "Insufficient ETH");
            // Refund excess
            if (msg.value > totalAmount) {
                payable(_msgSender()).transfer(msg.value - totalAmount);
            }
        } else {
            IERC20(stream.token).safeTransferFrom(
                _msgSender(),
                address(this),
                totalAmount
            );
        }
        
        stream.status = StreamStatus.Active;
        stream.totalPaid = totalAmount;
        stream.startTime = block.timestamp;
        stream.nextReleaseTime = block.timestamp + _getIntervalSeconds(stream.interval);
        
        emit StreamApproved(_streamId, _msgSender(), totalAmount);
        emit StreamStarted(_streamId, stream.startTime, stream.nextReleaseTime);
    }

    /**
     * @dev Release payment for a completed interval (can be called by anyone)
     * @param _streamId Stream identifier
     */
    function releasePayment(bytes32 _streamId)
        external
        nonReentrant
        whenNotPaused
    {
        Stream storage stream = streams[_streamId];
        require(stream.status == StreamStatus.Active, "Not active");
        require(block.timestamp >= stream.nextReleaseTime, "Too early");
        
        uint256 amountToRelease = stream.perIntervalAmount;
        
        // Check if this is the final payment
        uint256 remaining = stream.amount - stream.totalReleased;
        if (amountToRelease > remaining) {
            amountToRelease = remaining;
        }
        
        require(amountToRelease > 0, "No more payments");
        
        // Calculate and deduct protocol fee
        uint256 fee = (amountToRelease * protocolFeeBps) / 10000;
        uint256 sellerAmount = amountToRelease - fee;
        
        // Transfer to seller
        if (stream.token == address(0)) {
            payable(stream.seller).transfer(sellerAmount);
            if (fee > 0) {
                payable(treasury).transfer(fee);
            }
        } else {
            IERC20(stream.token).safeTransfer(stream.seller, sellerAmount);
            if (fee > 0) {
                IERC20(stream.token).safeTransfer(treasury, fee);
            }
        }
        
        stream.totalReleased += amountToRelease;
        stream.intervalsCompleted++;
        
        // Update next release time
        if (stream.totalReleased < stream.amount) {
            stream.nextReleaseTime += _getIntervalSeconds(stream.interval);
        }
        
        emit PaymentReleased(_streamId, amountToRelease, stream.intervalsCompleted);
        
        // Check if stream is completed
        if (stream.totalReleased >= stream.amount) {
            stream.status = StreamStatus.Completed;
            emit StreamCompleted(_streamId, stream.totalReleased, stream.intervalsCompleted);
        }
    }

    /**
     * @dev Pause the stream (buyer can pause)
     * @param _streamId Stream identifier
     */
    function pauseStream(bytes32 _streamId)
        external
        onlyStreamBuyer(_streamId)
    {
        Stream storage stream = streams[_streamId];
        require(stream.status == StreamStatus.Active, "Not active");
        
        stream.status = StreamStatus.Paused;
        
        emit StreamPaused(_streamId, _msgSender());
    }

    /**
     * @dev Resume a paused stream (buyer can resume)
     * @param _streamId Stream identifier
     */
    function resumeStream(bytes32 _streamId)
        external
        onlyStreamBuyer(_streamId)
    {
        Stream storage stream = streams[_streamId];
        require(stream.status == StreamStatus.Paused, "Not paused");
        
        stream.status = StreamStatus.Active;
        stream.nextReleaseTime = block.timestamp + _getIntervalSeconds(stream.interval);
        
        emit StreamResumed(_streamId, _msgSender());
    }

    /**
     * @dev Cancel the stream (either party can cancel)
     * @param _streamId Stream identifier
     */
    function cancelStream(bytes32 _streamId)
        external
        onlyStreamParticipant(_streamId)
        nonReentrant
    {
        Stream storage stream = streams[_streamId];
        require(
            stream.status == StreamStatus.Active ||
            stream.status == StreamStatus.Paused ||
            stream.status == StreamStatus.Pending,
            "Cannot cancel"
        );
        
        uint256 remainingBalance = stream.amount - stream.totalReleased;
        
        stream.status = StreamStatus.Cancelled;
        
        // If there's remaining balance, refund to buyer
        if (remainingBalance > 0) {
            if (stream.token == address(0)) {
                payable(stream.buyer).transfer(remainingBalance);
            } else {
                IERC20(stream.token).safeTransfer(stream.buyer, remainingBalance);
            }
        }
        
        emit StreamCancelled(_streamId, _msgSender(), remainingBalance);
    }

    /*//////////////////////////////////////////////////////////////
                            VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Get stream details
     * @param _streamId Stream identifier
     */
    function getStream(bytes32 _streamId)
        external
        view
        returns (Stream memory)
    {
        return streams[_streamId];
    }

    /**
     * @dev Get user's streams
     * @param user User address
     */
    function getUserStreams(address user)
        external
        view
        returns (bytes32[] memory)
    {
        return userStreams[user];
    }

    /**
     * @dev Check if a stream can be released
     * @param _streamId Stream identifier
     */
    function canRelease(bytes32 _streamId)
        external
        view
        returns (bool)
    {
        Stream storage stream = streams[_streamId];
        return stream.status == StreamStatus.Active &&
               block.timestamp >= stream.nextReleaseTime &&
               stream.totalReleased < stream.amount;
    }

    /**
     * @dev Get remaining balance in stream
     * @param _streamId Stream identifier
     */
    function getRemainingBalance(bytes32 _streamId)
        external
        view
        returns (uint256)
    {
        Stream storage stream = streams[_streamId];
        return stream.amount - stream.totalReleased;
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Update protocol fee
     * @param _newFeeBps New fee in basis points
     */
    function setProtocolFee(uint256 _newFeeBps)
        external
        onlyAdmin
    {
        require(_newFeeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFee = protocolFeeBps;
        protocolFeeBps = _newFeeBps;
        emit FeeUpdated(oldFee, _newFeeBps);
    }

    /**
     * @dev Update treasury address
     * @param _newTreasury New treasury address
     */
    function setTreasury(address _newTreasury)
        external
        onlyAdmin
    {
        require(_newTreasury != address(0), "Invalid treasury");
        treasury = _newTreasury;
    }

    /**
     * @dev Pause all streams (emergency)
     */
    function pause() external onlyAdmin {
        _pause();
    }

    /**
     * @dev Unpause all streams
     */
    function unpause() external onlyAdmin {
        _unpause();
    }

    /*//////////////////////////////////////////////////////////////
                            INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Calculate total amount including fee
     */
    function _calculateTotalWithFee(uint256 amount)
        internal
        view
        returns (uint256)
    {
        uint256 fee = (amount * protocolFeeBps) / 10000;
        return amount + fee;
    }

    /**
     * @dev Get interval in seconds
     */
    function _getIntervalSeconds(Interval _interval)
        internal
        pure
        returns (uint256)
    {
        if (_interval == Interval.Daily) {
            return 1 days;
        } else if (_interval == Interval.Weekly) {
            return 7 days;
        } else {
            return 30 days; // Monthly
        }
    }

    /*//////////////////////////////////////////////////////////////
                        ERC2771 OVERRIDES
    //////////////////////////////////////////////////////////////*/
    function _msgSender()
        internal
        view
        override(ERC2771Context, Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context, Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ERC2771Context, Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }

    // Emergency withdraw for ETH
    function emergencyWithdraw()
        external
        onlyAdmin
    {
        payable(admin).transfer(address(this).balance);
    }

    // Emergency withdraw for ERC20
    function emergencyWithdrawToken(address token)
        external
        onlyAdmin
    {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(admin, balance);
    }

    receive() external payable {}
}
