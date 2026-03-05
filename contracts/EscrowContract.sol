// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/utils/SafeERC721.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";
import "./EscrowYieldPool.sol";
import "./MultiSigWallet.sol";


contract EscrowContract is
    ReentrancyGuard,
    Pausable,
    ERC2771Context,
    IERC721Receiver,
    EIP712
{

    using ECDSA for bytes32;
    using SafeERC20 for IERC20; // Moved this up here

    /*//////////////////////////////////////////////////////////////
                                TYPES
    //////////////////////////////////////////////////////////////*/
    enum EscrowStatus {
        Created,
        Funded,
        Disputed,
        Released,
        Expired
    }

    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        address token;
        EscrowStatus status;
        address payee;
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        // --- NEW: RWA Collateral Link ---
        address rwaNftContract; // Address of the ProduceTracking contract
        uint256 rwaTokenId;     // The tokenId of the produce lot
        uint256 feeAmount;      // Platform fee amount
        uint256 discountRate;   // Discount rate in basis points (e.g. 50 = 0.5%)
        uint256 discountDeadline; // Timestamp deadline for early payment discount
    }

    struct DisputeVoting {
        uint256 snapshotArbitratorCount;
        uint256 votesForBuyer;
        uint256 votesForSeller;
        bool resolved;
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => DisputeVoting) public disputeVotings;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    ComplianceManager public complianceManager;
    ArbitratorsRegistry public arbitratorsRegistry;

    // --- NEW: Yield Pool Integration ---
    EscrowYieldPool public yieldPool;
    bool public yieldPoolEnabled = false;
    // Track which escrows have funds in yield pool
    mapping(bytes32 => bool) public escrowInYieldPool;
    // Track yield earned per escrow
    mapping(bytes32 => uint256) public escrowYieldEarned;

    // --- Multi-Sig Wallet Integration for High-Value Transactions ---
    // Threshold above which multi-sig is required (in USD equivalent, 1e8 = $10,000)
    uint256 public multiSigThreshold = 1000000000; // ~$10,000 with 8 decimal precision
    // Number of required confirmations for high-value transactions
    uint256 public multiSigRequiredConfirmations = 2;
    // Linked MultiSigWallet for high-value transactions
    MultiSigWallet public multiSigWallet;
    // Track multi-sig approvals per escrow
    mapping(bytes32 => address[]) public multiSigApprovers;
    mapping(bytes32 => mapping(address => bool)) public hasMultiSigApproved;
    // Track if escrow requires multi-sig
    mapping(bytes32 => bool) public requiresMultiSig;
    // Track high-value transaction status
    mapping(bytes32 => bool) public highValueTxReleased;

    // Events for multi-sig
    event MultiSigThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event MultiSigRequiredConfirmationsUpdated(uint256 oldConfirmations, uint256 newConfirmations);
    event MultiSigWalletSet(address indexed oldWallet, address indexed newWallet);
    event HighValueTransactionCreated(bytes32 indexed invoiceId, uint256 amount);
    event HighValueTransactionApproved(bytes32 indexed invoiceId, address indexed approver);
    event HighValueTransactionReleased(bytes32 indexed invoiceId);

    // --- Governance Integration ---
    address public governanceManager; // Governance manager contract
    bool public governanceEnabled = false;
    
    // Pending parameter changes (to be applied after governance approval)
    struct PendingParameterChange {
        uint256 newValue;
        uint256 executionTime;
        bool executed;
        bytes32 proposalId;
    }
    
    mapping(bytes32 => PendingParameterChange) public pendingParameterChanges;
    
    // Parameter change types
    bytes32 public constant FEE_PERCENTAGE_CHANGE = keccak256("FEE_PERCENTAGE");
    bytes32 public constant MINIMUM_ESCROW_CHANGE = keccak256("MINIMUM_ESCROW");
    bytes32 public constant TREASURY_CHANGE = keccak256("TREASURY");
    bytes32 public constant QUORUM_CHANGE = keccak256("QUORUM");
    bytes32 public constant TIMELOCK_CHANGE = keccak256("TIMELOCK");
    
    // Pending values
    uint256 public pendingFeePercentage;
    uint256 public pendingMinimumEscrowAmount;
    address public pendingTreasury;
    uint256 public pendingQuorumPercentage;
    
    // Delay before parameter changes take effect (after governance approval)
    uint256 public parameterChangeDelay = 2 days;

    address public admin;
    address public treasury;        // Platform treasury address for fee collection
    uint256 public feePercentage;   // Fee percentage in basis points (e.g., 50 = 0.5%)
    uint256 public quorumPercentage = 51; // Quorum percentage (e.g. 51%)
    uint256 public minimumEscrowAmount = 100; // Minimum escrow amount to prevent zero-fee edge cases

    // Yield pool events
    event YieldPoolUpdated(address indexed oldPool, address indexed newPool);
    event YieldPoolEnabled(bool enabled);
    event FundsDepositedToYield(bytes32 indexed invoiceId, uint256 amount);
    event FundsWithdrawnFromYield(bytes32 indexed invoiceId, uint256 principal, uint256 yield);
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy, uint256 arbitratorCount); // Overload
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event DisputeResolved(bytes32 indexed invoiceId, bool sellerWins, uint256 votesForSeller, uint256 votesForBuyer); // Overload
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool voteForBuyer);
    event SafeEscape(bytes32 indexed invoiceId, address indexed admin);
    event FeeCollected(bytes32 indexed invoiceId, uint256 feeAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);
    event MinimumEscrowAmountUpdated(uint256 oldMinimum, uint256 newMinimum);

    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyCompliant(address account) {
        require(!complianceManager.isFrozen(account), "Account frozen");
        require(complianceManager.isKYCVerified(account), "KYC not verified");
        require(complianceManager.hasIdentity(account), "No identity SBT");
        _;
    }

    modifier onlyArbitrator() {
        require(address(arbitratorsRegistry) != address(0), "Registry not set");
        require(arbitratorsRegistry.isArbitrator(_msgSender()), "Not arbitrator");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                                CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/
    constructor(
        address _trustedForwarder,
        address _complianceManager,
        address _arbitratorsRegistry
    )
        ERC2771Context(_trustedForwarder)
        EIP712("EscrowContract", "1")
    {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        treasury = msg.sender; // Default treasury to admin
        feePercentage = 50;    // Default 0.5% fee (50 basis points)
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);
    }
    
    /**
     * @notice Set the treasury address for fee collection
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyAdmin {
        require(_treasury != address(0), "Treasury cannot be zero address");
        address oldTreasury = treasury;
        treasury = _treasury;
        emit TreasuryUpdated(oldTreasury, _treasury);
    }
    
    /**
     * @notice Set the fee percentage in basis points
     * @param _feePercentage Fee in basis points (e.g., 50 = 0.5%, 100 = 1%)
     */
    function setFeePercentage(uint256 _feePercentage) external onlyAdmin {
        require(_feePercentage <= 1000, "Fee cannot exceed 10%"); // Max 10% fee
        uint256 oldFee = feePercentage;
        feePercentage = _feePercentage;
        emit FeePercentageUpdated(oldFee, _feePercentage);
    }

    /**
     * @notice Set the minimum escrow amount to prevent zero-fee edge cases
     * @param _minimumEscrowAmount Minimum amount required to create an escrow
     */
    function setMinimumEscrowAmount(uint256 _minimumEscrowAmount) external onlyAdmin {
        require(_minimumEscrowAmount > 0, "Minimum amount must be > 0");
        uint256 oldMinimum = minimumEscrowAmount;
        minimumEscrowAmount = _minimumEscrowAmount;
        emit MinimumEscrowAmountUpdated(oldMinimum, _minimumEscrowAmount);
    }

    /*//////////////////////////////////////////////////////////////
                    YIELD POOL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setYieldPool(address _yieldPool) external onlyAdmin {
        require(_yieldPool != address(0), "Invalid yield pool");
        address oldPool = address(yieldPool);
        yieldPool = EscrowYieldPool(_yieldPool);
        emit YieldPoolUpdated(oldPool, _yieldPool);
    }

    function setYieldPoolEnabled(bool _enabled) external onlyAdmin {
        yieldPoolEnabled = _enabled;
        emit YieldPoolEnabled(_enabled);
    }

    function depositToYieldPool(bytes32 _invoiceId) external onlyAdmin {
        require(yieldPoolEnabled, "Yield pool not enabled");
        require(address(yieldPool) != address(0), "Yield pool not set");
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(!escrowInYieldPool[_invoiceId], "Already in yield pool");
        uint256 amount = escrow.amount;
        require(amount > 0, "No funds to deposit");
        IERC20(escrow.token).approve(address(yieldPool), amount);
        yieldPool.deposit(_invoiceId, escrow.token, amount);
        escrowInYieldPool[_invoiceId] = true;
        emit FundsDepositedToYield(_invoiceId, amount);
    }

    function withdrawFromYieldPool(bytes32 _invoiceId) external onlyAdmin {
        require(escrowInYieldPool[_invoiceId], "Not in yield pool");
        Escrow storage escrow = escrows[_invoiceId];
        yieldPool.withdraw(_invoiceId, escrow.token, address(this));
        escrowInYieldPool[_invoiceId] = false;
        (uint256 principal, uint256 yieldEarned, , ) = yieldPool.getDepositDetails(_invoiceId);
        emit FundsWithdrawnFromYield(_invoiceId, principal, yieldEarned);
    }

    function claimYield(bytes32 _invoiceId) external onlyAdmin {
        require(escrowInYieldPool[_invoiceId], "Not in yield pool");
        Escrow storage escrow = escrows[_invoiceId];
        yieldPool.withdraw(_invoiceId, escrow.token, address(this));
        escrowInYieldPool[_invoiceId] = false;
        (uint256 principal, uint256 yieldEarned, , ) = yieldPool.getDepositDetails(_invoiceId);
        escrow.amount = principal + yieldEarned;
        emit FundsWithdrawnFromYield(_invoiceId, principal, yieldEarned);
    }

    function getYieldInfo(bytes32 _invoiceId) external view returns (bool inYieldPool, uint256 estimatedYield) {
        inYieldPool = escrowInYieldPool[_invoiceId];
        if (inYieldPool && address(yieldPool) != address(0)) {
            estimatedYield = yieldPool.calculateCurrentYield(_invoiceId);
        }
    }

    /*//////////////////////////////////////////////////////////////
                    MULTI-SIG FUNCTIONS FOR HIGH-VALUE TRANSACTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set the multi-sig wallet address
     * @param _multiSigWallet Address of the MultiSigWallet contract
     */
    function setMultiSigWallet(address _multiSigWallet) external onlyAdmin {
        require(_multiSigWallet != address(0), "Invalid wallet address");
        address oldWallet = address(multiSigWallet);
        multiSigWallet = MultiSigWallet(_multiSigWallet);
        emit MultiSigWalletSet(oldWallet, _multiSigWallet);
    }

    /**
     * @notice Update the multi-sig threshold
     * @param _threshold New threshold value
     */
    function setMultiSigThreshold(uint256 _threshold) external onlyAdmin {
        require(_threshold > 0, "Threshold must be > 0");
        uint256 oldThreshold = multiSigThreshold;
        multiSigThreshold = _threshold;
        emit MultiSigThresholdUpdated(oldThreshold, _threshold);
    }

    /**
     * @notice Update the required confirmations for multi-sig
     * @param _requiredConfirmations New number of required confirmations
     */
    function setMultiSigRequiredConfirmations(uint256 _requiredConfirmations) external onlyAdmin {
        require(_requiredConfirmations > 0, "Confirmations must be > 0");
        uint256 oldConfirmations = multiSigRequiredConfirmations;
        multiSigRequiredConfirmations = _requiredConfirmations;
        emit MultiSigRequiredConfirmationsUpdated(oldConfirmations, _requiredConfirmations);
    }

    /**
     * @notice Check if an escrow requires multi-sig approval
     * @param _invoiceId The escrow invoice ID
     * @return bool True if multi-sig is required
     */
    function checkMultiSigRequired(bytes32 _invoiceId) external view returns (bool) {
        Escrow storage escrow = escrows[_invoiceId];
        return escrow.amount >= multiSigThreshold;
    }

    /**
     * @notice Get multi-sig approval status for an escrow
     * @param _invoiceId The escrow invoice ID
     * @return approvers Array of approver addresses
     * @return approvalCount Number of approvals received
     * @return required Number of approvals required
     */
    function getMultiSigApprovals(bytes32 _invoiceId) external view returns (
        address[] memory approvers,
        uint256 approvalCount,
        uint256 required
    ) {
        approvers = multiSigApprovers[_invoiceId];
        approvalCount = approvers.length;
        required = multiSigRequiredConfirmations;
    }

    /**
     * @notice Add multi-sig approval for a high-value escrow
     * @param _invoiceId The escrow invoice ID
     */
    function addMultiSigApproval(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        
        // Check if this is a high-value transaction requiring multi-sig
        require(escrow.amount >= multiSigThreshold, "Not a high-value transaction");
        
        // Only allow buyer or seller to approve
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not authorized"
        );
        
        // Check if already approved
        require(!hasMultiSigApproved[_invoiceId][_msgSender()], "Already approved");
        
        hasMultiSigApproved[_invoiceId][_msgSender()] = true;
        multiSigApprovers[_invoiceId].push(_msgSender());
        
        emit HighValueTransactionApproved(_invoiceId, _msgSender());
        
        // Check if we have enough approvals to release
        if (multiSigApprovers[_invoiceId].length >= multiSigRequiredConfirmations) {
            _releaseHighValueFunds(_invoiceId);
        }
    }

    /**
     * @notice Internal function to release high-value funds
     * @param _invoiceId The escrow invoice ID
     */
    function _releaseHighValueFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(!highValueTxReleased[_invoiceId], "Already released");
        
        highValueTxReleased[_invoiceId] = true;
        
        IERC20(escrow.token).safeTransfer(escrow.seller, escrow.amount);
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(
                address(this), 
                escrow.buyer, 
                escrow.rwaTokenId
            );
        }
        
        escrow.status = EscrowStatus.Released;
        
        emit HighValueTransactionReleased(_invoiceId);
        emit EscrowReleased(_invoiceId, escrow.amount);
    }

    /**
     * @notice Cancel a high-value transaction
     * @param _invoiceId The escrow invoice ID
     */
    function cancelHighValueTransaction(bytes32 _invoiceId) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.amount >= multiSigThreshold, "Not a high-value transaction");
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        
        // Reset approvals
        delete multiSigApprovers[_invoiceId];
        
        // Clear approval mappings
        address[] memory approvers = multiSigApprovers[_invoiceId];
        for (uint256 i = 0; i < approvers.length; i++) {
            delete hasMultiSigApproved[_invoiceId][approvers[i]];
        }
        
        emit HighValueTransactionCreated(_invoiceId, 0); // Signal cancellation
    }

    /*//////////////////////////////////////////////////////////////
                            ESCROW LOGIC
    //////////////////////////////////////////////////////////////*/

    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyAdmin returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");

        // Validate minimum escrow amount to prevent zero-fee edge cases
        require(_amount >= minimumEscrowAmount, "Amount below minimum");

        // Calculate fee amount
        uint256 calculatedFee = (_amount * feePercentage) / 10000; // Basis points calculation

        // Ensure fee is not zero (prevent dust transactions with no platform fee)
        require(calculatedFee > 0, "Fee amount is zero");

        // --- NEW: Lock the Produce NFT as Collateral ---
        // The seller must have approved the EscrowContract to spend this NFT beforehand.
        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).safeTransferFrom(
                _seller,
                address(this),
                _rwaTokenId
            );
        }

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            amount: _amount,
            token: _token,
            status: EscrowStatus.Created,
            payee: _seller,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId,
            feeAmount: calculatedFee,
            discountRate: 0,
            discountDeadline: 0
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }

    function deposit(bytes32 _invoiceId)
        external
        payable
        nonReentrant
        onlyCompliant(_msgSender())
    {
        Escrow storage escrow = escrows[_invoiceId];
        require(_msgSender() == escrow.buyer, "Not buyer");
        require(!escrow.buyerConfirmed, "Already paid");

        uint256 payableAmount = _getPayableAmount(escrow);

        if (escrow.token == address(0)) {
            require(msg.value == payableAmount, "Bad ETH amount");
        } else {
            IERC20(escrow.token).safeTransferFrom(
                _msgSender(),
                address(this),
                payableAmount
            );
        }

        escrow.amount = payableAmount;
        escrow.buyerConfirmed = true;
        escrow.status = EscrowStatus.Funded;

        emit DepositConfirmed(_invoiceId, escrow.buyer, payableAmount);
    }

    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not party"
        );

        if (_msgSender() == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            escrow.buyerConfirmed = true;
        }

        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId) external {
        Escrow storage e = escrows[invoiceId];

        require(
            _msgSender() == e.seller || _msgSender() == e.buyer,
            "Not party"
        );
        require(e.status == EscrowStatus.Funded, "Not funded");
        require(!e.disputeRaised, "Already disputed");

        uint256 arbitratorCount = arbitratorsRegistry.arbitratorCount();
        require(arbitratorCount > 0, "No arbitrators");

        e.disputeRaised = true;
        e.status = EscrowStatus.Disputed;

        // Initialize quorum-based voting
        disputeVotings[invoiceId] = DisputeVoting({
            snapshotArbitratorCount: arbitratorCount,
            votesForBuyer: 0,
            votesForSeller: 0,
            resolved: false
        });

        emit DisputeRaised(invoiceId, _msgSender(), arbitratorCount);
    }
    
    function resolveDispute(bytes32 _invoiceId, bool _sellerWins) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.disputeRaised, "No dispute raised");
        require(escrow.status == EscrowStatus.Disputed, "Not disputed");
        
        _resolveEscrow(_invoiceId, _sellerWins);
    }

    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        
        IERC20(escrow.token).safeTransfer(escrow.seller, escrow.amount);
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }
        
        emit EscrowReleased(_invoiceId, escrow.amount);
    }


    function _getPayableAmount(Escrow storage escrow)
        internal
        view
        returns (uint256)
    {
        if (
            escrow.discountRate > 0 &&
            block.timestamp <= escrow.discountDeadline
        ) {
            uint256 discount =
                (escrow.amount * escrow.discountRate) / 10_000;
            return escrow.amount - discount;
        }
        return escrow.amount;
    }

    function _payout(address to, address token, uint256 amount) internal {
        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _transferNFT(
        address from,
        address to,
        Escrow storage escrow
    ) internal {
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(
                from,
                to,
                escrow.rwaTokenId
            );
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


    /*//////////////////////////////////////////////////////////////
                        ERC721 RECEIVER
    //////////////////////////////////////////////////////////////*/
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    /*//////////////////////////////////////////////////////////////
                    ARBITRATOR VOTING FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Set the arbitrators registry address
    /// @param _registry The address of the ArbitratorsRegistry contract
    function setArbitratorsRegistry(address _registry) external onlyAdmin {
        require(_registry != address(0), "Invalid registry");
        arbitratorsRegistry = ArbitratorsRegistry(_registry);
    }

    /// @notice Update the quorum percentage
    /// @param _percentage The new quorum percentage (e.g., 60 for 60%)
    function updateQuorumPercentage(uint256 _percentage) external onlyAdmin {
        require(_percentage > 0 && _percentage <= 100, "Invalid percentage");
        quorumPercentage = _percentage;
    }

    /// @notice Initialize arbitration voting for a dispute (snapshots arbitrator count)
    /// @dev Called when a dispute is raised to snapshot the current arbitrator count
    /// @param invoiceId The escrow invoice ID
    function startArbitratorVoting(bytes32 invoiceId) internal {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");
        require(address(arbitratorsRegistry) != address(0), "Registry not set");

        // Snapshot the current arbitrator count
        uint256 currentCount = arbitratorsRegistry.arbitratorCount();
        require(currentCount > 0, "No arbitrators");

        disputeVotings[invoiceId] = DisputeVoting({
            snapshotArbitratorCount: currentCount,
            votesForBuyer: 0,
            votesForSeller: 0,
            resolved: false
        });
    }

    function voteOnDispute(bytes32 invoiceId, bool voteForBuyer)
        external
        whenNotPaused
        onlyArbitrator
        nonReentrant
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        DisputeVoting storage voting = disputeVotings[invoiceId];
        require(!voting.resolved, "Already resolved");
        require(!hasVoted[invoiceId][_msgSender()], "Already voted");

        // Handle arbitrator set shrink (acceptance criteria)
        uint256 liveCount = arbitratorsRegistry.arbitratorCount();
        if (liveCount < voting.snapshotArbitratorCount) {
            voting.snapshotArbitratorCount = liveCount;
        }

        hasVoted[invoiceId][_msgSender()] = true;

        if (voteForBuyer) {
            voting.votesForBuyer += 1;
        } else {
            voting.votesForSeller += 1;
        }

        emit ArbitratorVoted(invoiceId, _msgSender(), !voteForBuyer);

        _checkAndResolveVoting(invoiceId);
    }

    function _checkAndResolveVoting(bytes32 invoiceId) internal {
        DisputeVoting storage voting = disputeVotings[invoiceId];
        if (voting.resolved) return;

        uint256 quorumRequired =
            (voting.snapshotArbitratorCount * quorumPercentage) / 100;

        if (quorumRequired == 0) quorumRequired = 1;

        uint256 totalVotes =
            voting.votesForBuyer + voting.votesForSeller;

        if (totalVotes >= quorumRequired) {
            bool sellerWins =
                voting.votesForSeller > voting.votesForBuyer;

            voting.resolved = true;
            _resolveEscrow(invoiceId, sellerWins);

            emit DisputeResolved(
                invoiceId,
                sellerWins,
                voting.votesForSeller,
                voting.votesForBuyer
            );
        }
    }

    /// @notice Get current voting status for a dispute
    /// @param invoiceId The escrow invoice ID
    /// @return snapshotCount The snapshot arbitrator count
    /// @return buyerVotes Number of votes for buyer
    /// @return sellerVotes Number of votes for seller
    /// @return resolved Whether the dispute is resolved
    function getVotingStatus(bytes32 invoiceId)
        external
        view
        returns (
            uint256 snapshotCount,
            uint256 buyerVotes,
            uint256 sellerVotes,
            bool resolved
        )
    {
        DisputeVoting storage voting = disputeVotings[invoiceId];
        return (
            voting.snapshotArbitratorCount,
            voting.votesForBuyer,
            voting.votesForSeller,
            voting.resolved
        );
    }

    /// @notice Safe Escape - Admin function to resolve stuck disputes
    /// @dev Used when quorum is mathematically impossible (e.g., arbitrators fired)
    /// @param invoiceId The escrow invoice ID
    /// @param sellerWins Whether the seller wins
    function safeEscape(bytes32 invoiceId, bool sellerWins)
        external
        onlyAdmin
        nonReentrant
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        DisputeVoting storage voting = disputeVotings[invoiceId];
        require(!voting.resolved, "Already resolved");

        // Verify that it's actually stuck (no quorum possible with live arbitrators)
        uint256 liveCount = arbitratorsRegistry.arbitratorCount();
        uint256 quorumRequired = (voting.snapshotArbitratorCount * quorumPercentage) / 100;

        // Only allow if live count is less than needed for quorum
        require(liveCount < quorumRequired, "Quorum still possible");

        voting.resolved = true;
        _resolveEscrow(invoiceId, sellerWins);
        emit SafeEscape(invoiceId, _msgSender());
    }

    /// @notice Internal function to resolve escrow after voting
    /// @param invoiceId The escrow invoice ID
    /// @param sellerWins Whether the seller wins
    function _resolveEscrow(bytes32 invoiceId, bool sellerWins) internal {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        // EFFECTS
        e.disputeResolver = _msgSender();
        e.status = EscrowStatus.Released;

        address seller = e.seller;
        address buyer = e.buyer;
        uint256 amount = e.amount;
        uint256 fee = e.feeAmount;

        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);

        uint256 payoutAmount = amount;
        if (fee > 0) {
            IERC20(e.token).safeTransfer(treasury, fee);
            emit FeeCollected(invoiceId, fee);
            payoutAmount -= fee;
        }

        IERC20(e.token).safeTransfer(sellerWins ? seller : buyer, payoutAmount);


        // Transfer NFT to winner
        _transferNFT(address(this), sellerWins ? buyer : seller, e);

        delete escrows[invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                    GOVERNANCE INTEGRATION FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Set the governance manager address
     * @param _governanceManager Address of the governance manager
     */
    function setGovernanceManager(address _governanceManager) external onlyAdmin {
        require(_governanceManager != address(0), "Invalid governance manager");
        governanceManager = _governanceManager;
        governanceEnabled = true;
        emit GovernanceManagerSet(_governanceManager);
    }

    /**
     * @notice Enable/disable governance integration
     * @param _enabled Enable state
     */
    function setGovernanceEnabled(bool _enabled) external onlyAdmin {
        governanceEnabled = _enabled;
        emit GovernanceEnabled(_enabled);
    }

    /**
     * @notice Set parameter change delay
     * @param _delay New delay in seconds
     */
    function setParameterChangeDelay(uint256 _delay) external onlyAdmin {
        require(_delay >= 1 days && _delay <= 30 days, "Invalid delay");
        parameterChangeDelay = _delay;
    }

    /**
     * @notice Queue a parameter change from governance
     * @param parameterType Type of parameter to change
     * @param newValue New value
     * @param proposalId Related proposal ID
     */
    function queueParameterChange(
        bytes32 parameterType,
        uint256 newValue,
        bytes32 proposalId
    ) external {
        require(governanceEnabled, "Governance not enabled");
        require(msg.sender == governanceManager, "Only governance");

        if (parameterType == FEE_PERCENTAGE_CHANGE) {
            require(newValue <= 1000, "Fee too high");
            pendingFeePercentage = newValue;
        } else if (parameterType == MINIMUM_ESCROW_CHANGE) {
            require(newValue > 0, "Minimum must be > 0");
            pendingMinimumEscrowAmount = newValue;
        } else if (parameterType == QUORUM_CHANGE) {
            require(newValue > 0 && newValue <= 100, "Invalid quorum");
            pendingQuorumPercentage = newValue;
        } else {
            revert("Unknown parameter");
        }

        pendingParameterChanges[parameterType] = PendingParameterChange({
            newValue: newValue,
            executionTime: block.timestamp + parameterChangeDelay,
            executed: false,
            proposalId: proposalId
        });

        emit ParameterChangeQueued(parameterType, newValue, proposalId);
    }

    /**
     * @notice Execute a queued parameter change
     * @param parameterType Type of parameter to change
     */
    function executeParameterChange(bytes32 parameterType) external {
        PendingParameterChange storage change = pendingParameterChanges[parameterType];
        require(change.executionTime > 0, "No pending change");
        require(block.timestamp >= change.executionTime, "Too early");
        require(!change.executed, "Already executed");

        change.executed = true;

        if (parameterType == FEE_PERCENTAGE_CHANGE) {
            uint256 oldFee = feePercentage;
            feePercentage = change.newValue;
            emit FeePercentageUpdated(oldFee, change.newValue);
        } else if (parameterType == MINIMUM_ESCROW_CHANGE) {
            uint256 oldMinimum = minimumEscrowAmount;
            minimumEscrowAmount = change.newValue;
            emit MinimumEscrowAmountUpdated(oldMinimum, change.newValue);
        } else if (parameterType == QUORUM_CHANGE) {
            uint256 oldQuorum = quorumPercentage;
            quorumPercentage = change.newValue;
            emit QuorumPercentageUpdated(oldQuorum, change.newValue);
        }

        emit ParameterChangeExecuted(parameterType, change.newValue);
    }

    /**
     * @notice Queue treasury change from governance
     * @param newTreasury New treasury address
     * @param proposalId Related proposal ID
     */
    function queueTreasuryChange(address newTreasury, bytes32 proposalId) external {
        require(governanceEnabled, "Governance not enabled");
        require(msg.sender == governanceManager, "Only governance");
        require(newTreasury != address(0), "Invalid treasury");

        pendingTreasury = newTreasury;
        pendingParameterChanges[TREASURY_CHANGE] = PendingParameterChange({
            newValue: 0,
            executionTime: block.timestamp + parameterChangeDelay,
            executed: false,
            proposalId: proposalId
        });

        emit TreasuryChangeQueued(newTreasury, proposalId);
    }

    /**
     * @notice Execute queued treasury change
     */
    function executeTreasuryChange() external {
        PendingParameterChange storage change = pendingParameterChanges[TREASURY_CHANGE];
        require(change.executionTime > 0, "No pending change");
        require(block.timestamp >= change.executionTime, "Too early");
        require(!change.executed, "Already executed");

        change.executed = true;
        address oldTreasury = treasury;
        treasury = pendingTreasury;
        emit TreasuryUpdated(oldTreasury, pendingTreasury);
        emit TreasuryChangeExecuted(pendingTreasury);
    }

    /**
     * @notice Get pending parameter change details
     * @param parameterType Type of parameter
     * @return Pending parameter change details
     */
    function getPendingChange(bytes32 parameterType) external view returns (
        uint256 newValue,
        uint256 executionTime,
        bool executed,
        bytes32 proposalId
    ) {
        PendingParameterChange storage change = pendingParameterChanges[parameterType];
        return (change.newValue, change.executionTime, change.executed, change.proposalId);
    }

    /**
     * @notice Check if governance can update parameters
     * @return Whether governance controls parameters
     */
    function isGovernanceActive() external view returns (bool) {
        return governanceEnabled && governanceManager != address(0);
    }

    // Governance events
    event GovernanceManagerSet(address indexed governanceManager);
    event GovernanceEnabled(bool enabled);
    event ParameterChangeQueued(bytes32 indexed parameterType, uint256 newValue, bytes32 indexed proposalId);
    event ParameterChangeExecuted(bytes32 indexed parameterType, uint256 newValue);
    event TreasuryChangeQueued(address indexed newTreasury, bytes32 indexed proposalId);
    event TreasuryChangeExecuted(address indexed newTreasury);
    event QuorumPercentageUpdated(uint256 oldQuorum, uint256 newQuorum);
}
