// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/metatx/ERC2771ContextUpgradeable.sol";
import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";
import "./EscrowYieldPool.sol";
import "./MultiSigWallet.sol";

contract EscrowContractV2 is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ERC2771ContextUpgradeable,
    IERC721Receiver,
    EIP712Upgradeable
{
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

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
        address rwaNftContract;
        uint256 rwaTokenId;
        uint256 feeAmount;
        uint256 discountRate;
        uint256 discountDeadline;
    }

    struct ApprovalStage {
        address[] approvers; // addresses allowed to approve this stage
        uint256 required; // number of approvals required for this stage
        uint256 approvalCount; // current approvals
        bool completed;
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

    EscrowYieldPool public yieldPool;
    bool public yieldPoolEnabled; // FIX: Remove '= false'
    mapping(bytes32 => bool) public escrowInYieldPool;
    mapping(bytes32 => uint256) public escrowYieldEarned;

    uint256 public multiSigThreshold; // FIX: Remove initial value
    uint256 public multiSigRequiredConfirmations; // FIX: Remove initial value
    MultiSigWallet public multiSigWallet;
    mapping(bytes32 => address[]) public multiSigApprovers;
    mapping(bytes32 => mapping(address => bool)) public hasMultiSigApproved;
    mapping(bytes32 => bool) public requiresMultiSig;
    mapping(bytes32 => bool) public highValueTxReleased;

    address public governanceManager;
    bool public governanceEnabled;
    
    struct PendingParameterChange {
        uint256 newValue;
        uint256 executionTime;
        bool executed;
        bytes32 proposalId;
    }
    
    mapping(bytes32 => PendingParameterChange) public pendingParameterChanges;
    
    bytes32 public constant FEE_PERCENTAGE_CHANGE = keccak256("FEE_PERCENTAGE");
    bytes32 public constant MINIMUM_ESCROW_CHANGE = keccak256("MINIMUM_ESCROW");
    bytes32 public constant TREASURY_CHANGE = keccak256("TREASURY");
    bytes32 public constant QUORUM_CHANGE = keccak256("QUORUM");
    bytes32 public constant TIMELOCK_CHANGE = keccak256("TIMELOCK");
    
    uint256 public pendingFeePercentage;
    uint256 public pendingMinimumEscrowAmount;
    address public pendingTreasury;
    uint256 public pendingQuorumPercentage;
    uint256 public parameterChangeDelay; // FIX: Remove initial value

    address public admin;
    address public treasury;
    uint256 public feePercentage;
    uint256 public quorumPercentage;
    uint256 public minimumEscrowAmount;

    uint256 public version;
    string public constant VERSION_NAME = "EscrowContractV2";

    mapping(bytes32 => ApprovalStage[]) public approvalStages;
    mapping(bytes32 => mapping(uint256 => mapping(address => bool))) public hasStageApproved;

    // Events
    event MultiSigThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event MultiSigRequiredConfirmationsUpdated(uint256 oldConfirmations, uint256 newConfirmations);
    event MultiSigWalletSet(address indexed oldWallet, address indexed newWallet);
    event HighValueTransactionCreated(bytes32 indexed invoiceId, uint256 amount);
    event HighValueTransactionApproved(bytes32 indexed invoiceId, address indexed approver);
    event HighValueTransactionReleased(bytes32 indexed invoiceId);
    event ApprovalStagesSet(bytes32 indexed invoiceId);
    event StageApproved(bytes32 indexed invoiceId, uint256 indexed stageIndex, address approver);
    event EscrowAutoCancelled(bytes32 indexed invoiceId);

    event YieldPoolUpdated(address indexed oldPool, address indexed newPool);
    event YieldPoolEnabled(bool enabled);
    event FundsDepositedToYield(bytes32 indexed invoiceId, uint256 amount);
    event FundsWithdrawnFromYield(bytes32 indexed invoiceId, uint256 principal, uint256 yield);
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy, uint256 arbitratorCount);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event DisputeResolved(bytes32 indexed invoiceId, bool sellerWins, uint256 votesForSeller, uint256 votesForBuyer);
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool voteForBuyer);
    event SafeEscape(bytes32 indexed invoiceId, address indexed admin);
    event FeeCollected(bytes32 indexed invoiceId, uint256 feeAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);
    event MinimumEscrowAmountUpdated(uint256 oldMinimum, uint256 newMinimum);
    event GovernanceManagerSet(address indexed governanceManager);
    event GovernanceEnabled(bool enabled);
    event ParameterChangeQueued(bytes32 indexed parameterType, uint256 newValue, bytes32 indexed proposalId);
    event ParameterChangeExecuted(bytes32 indexed parameterType, uint256 newValue);
    event TreasuryChangeQueued(address indexed newTreasury, bytes32 indexed proposalId);
    event TreasuryChangeExecuted(address indexed newTreasury);
    event QuorumPercentageUpdated(uint256 oldQuorum, uint256 newQuorum);
    event ContractUpgraded(address indexed oldImplementation, address indexed newImplementation, uint256 newVersion);

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _trustedForwarder) ERC2771ContextUpgradeable(_trustedForwarder) {
        _disableInitializers();
    }
    
    function initialize(
        address _trustedForwarder,
        address _complianceManager,
        address _arbitratorsRegistry,
        address _initialAdmin
    ) external initializer {
        __Ownable_init(_initialAdmin);
        __Pausable_init();
        __EIP712_init("EscrowContractV2", "1");
        
        admin = _initialAdmin;
        complianceManager = ComplianceManager(_complianceManager);
        treasury = _initialAdmin;
        feePercentage = 50;
        quorumPercentage = 51;
        minimumEscrowAmount = 100;
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);
        
        // FIX: Set values in initialize instead of declaration
        yieldPoolEnabled = false;
        multiSigThreshold = 1000000000;
        multiSigRequiredConfirmations = 2;
        governanceEnabled = false;
        parameterChangeDelay = 2 days;

        version = 2;
    }

    /**
     * @notice Upgrade authorization for UUPS proxy
     * @dev Only callable by the proxy admin
     * @param newImplementation Address of the new implementation contract
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        // Can add additional upgrade authorization logic here
        // For example, require governance approval for upgrades
    }

    /*//////////////////////////////////////////////////////////////
                    ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    
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
        require(_feePercentage <= 1000, "Fee cannot exceed 10%");
        uint256 oldFee = feePercentage;
        feePercentage = _feePercentage;
        emit FeePercentageUpdated(oldFee, _feePercentage);
    }

    /**
     * @notice Set the minimum escrow amount
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

    function setMultiSigWallet(address _multiSigWallet) external onlyAdmin {
        require(_multiSigWallet != address(0), "Invalid wallet address");
        address oldWallet = address(multiSigWallet);
        // FIX: Cast address to payable before casting to the contract type
        multiSigWallet = MultiSigWallet(payable(_multiSigWallet));
        emit MultiSigWalletSet(oldWallet, _multiSigWallet);
    }

    function setMultiSigThreshold(uint256 _threshold) external onlyAdmin {
        require(_threshold > 0, "Threshold must be > 0");
        uint256 oldThreshold = multiSigThreshold;
        multiSigThreshold = _threshold;
        emit MultiSigThresholdUpdated(oldThreshold, _threshold);
    }

    function setMultiSigRequiredConfirmations(uint256 _requiredConfirmations) external onlyAdmin {
        require(_requiredConfirmations > 0, "Confirmations must be > 0");
        uint256 oldConfirmations = multiSigRequiredConfirmations;
        multiSigRequiredConfirmations = _requiredConfirmations;
        emit MultiSigRequiredConfirmationsUpdated(oldConfirmations, _requiredConfirmations);
    }

    function checkMultiSigRequired(bytes32 _invoiceId) external view returns (bool) {
        Escrow storage escrow = escrows[_invoiceId];
        return escrow.amount >= multiSigThreshold;
    }

    /**
     * @notice Set approval stages for a specific escrow. Only admin.
     * @dev Each stage has a list of approver addresses and required approvals
     */
    function setApprovalStages(
        bytes32 _invoiceId,
        address[][] calldata _approversPerStage,
        uint256[] calldata _requiredPerStage
    ) external onlyAdmin {
        require(_approversPerStage.length == _requiredPerStage.length, "Mismatched stages");
        // clear existing stages
        delete approvalStages[_invoiceId];

        for (uint256 i = 0; i < _approversPerStage.length; i++) {
            ApprovalStage memory s;
            s.approvers = _approversPerStage[i];
            s.required = _requiredPerStage[i];
            s.approvalCount = 0;
            s.completed = false;
            approvalStages[_invoiceId].push(s);
        }

        emit ApprovalStagesSet(_invoiceId);
    }

    /**
     * @notice Approve a specific stage for an escrow
     */
    function approveStage(bytes32 _invoiceId, uint256 _stageIndex) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(_stageIndex < approvalStages[_invoiceId].length, "Invalid stage");

        ApprovalStage storage stage = approvalStages[_invoiceId][_stageIndex];

        // Check caller is listed as an approver for the stage
        bool allowed = false;
        for (uint256 i = 0; i < stage.approvers.length; i++) {
            if (stage.approvers[i] == _msgSender()) {
                allowed = true;
                break;
            }
        }
        require(allowed, "Not authorized for this stage");
        require(!hasStageApproved[_invoiceId][_stageIndex][_msgSender()], "Already approved");

        hasStageApproved[_invoiceId][_stageIndex][_msgSender()] = true;
        stage.approvalCount += 1;

        emit StageApproved(_invoiceId, _stageIndex, _msgSender());

        if (stage.approvalCount >= stage.required) {
            stage.completed = true;
        }

        // If all stages completed, release funds
        bool allDone = true;
        for (uint256 j = 0; j < approvalStages[_invoiceId].length; j++) {
            if (!approvalStages[_invoiceId][j].completed) {
                allDone = false;
                break;
            }
        }

        if (allDone && escrow.status == EscrowStatus.Funded) {
            _releaseFunds(_invoiceId);
        }
    }

    /**
     * @notice Auto-cancel escrow after expiry and refund buyer. Anyone may call.
     */
    function autoCancelEscrow(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(escrow.amount > 0, "Escrow already finalized");
        require(block.timestamp > escrow.expiresAt, "Escrow not expired yet");

        // Update status before external call (CEI pattern)
        escrow.status = EscrowStatus.Expired;

        // Refund buyer
        _payout(escrow.buyer, escrow.token, escrow.amount);
        emit EscrowAutoCancelled(_invoiceId);
        emit EscrowReleased(_invoiceId, 0);

        // Cleanup
        delete approvalStages[_invoiceId];
    }

    function getMultiSigApprovals(bytes32 _invoiceId) external view returns (
        address[] memory approvers,
        uint256 approvalCount,
        uint256 required
    ) {
        approvers = multiSigApprovers[_invoiceId];
        approvalCount = approvers.length;
        required = multiSigRequiredConfirmations;
    }

    function addMultiSigApproval(bytes32 _invoiceId) whenNotPaused external {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.amount >= multiSigThreshold, "Not a high-value transaction");
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not authorized"
        );
        require(!hasMultiSigApproved[_invoiceId][_msgSender()], "Already approved");
        
        hasMultiSigApproved[_invoiceId][_msgSender()] = true;
        multiSigApprovers[_invoiceId].push(_msgSender());
        
        emit HighValueTransactionApproved(_invoiceId, _msgSender());
        
        if (multiSigApprovers[_invoiceId].length >= multiSigRequiredConfirmations) {
            _releaseHighValueFunds(_invoiceId);
        }
    }

    function _releaseHighValueFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        require(!highValueTxReleased[_invoiceId], "Already released");

        uint256 releaseAmount = escrow.amount;
        require(releaseAmount > 0, "No funds to release");

        escrow.status = EscrowStatus.Released;
        escrow.amount = 0;
        
        highValueTxReleased[_invoiceId] = true;
        
        _payout(escrow.seller, escrow.token, releaseAmount);
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(
                address(this), 
                escrow.buyer, 
                escrow.rwaTokenId
            );
        }
        
        emit HighValueTransactionReleased(_invoiceId);
        emit EscrowReleased(_invoiceId, releaseAmount);
    }

    function cancelHighValueTransaction(bytes32 _invoiceId) external onlyAdmin {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.amount >= multiSigThreshold, "Not a high-value transaction");
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        
        delete multiSigApprovers[_invoiceId];
        
        address[] memory approvers = multiSigApprovers[_invoiceId];
        for (uint256 i = 0; i < approvers.length; i++) {
            delete hasMultiSigApproved[_invoiceId][approvers[i]];
        }
        
        emit HighValueTransactionCreated(_invoiceId, 0);
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
        uint256 _rwaTokenId,
        uint256 _discountRate,      // Add this
        uint256 _discountDeadline
    ) external whenNotPaused returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");
        require(_amount >= minimumEscrowAmount, "Amount below minimum");

        uint256 calculatedFee = (_amount * feePercentage) / 10000;
        if (feePercentage > 0) {
            require(calculatedFee > 0, "Amount too small for current fee %");
        }

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
            discountRate: _discountRate,    // Use parameter instead of 0
            discountDeadline: _discountDeadline
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }

    function deposit(bytes32 _invoiceId)
        external
        payable
        whenNotPaused
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

    function confirmRelease(bytes32 _invoiceId) whenNotPaused external {
        Escrow storage escrow = escrows[_invoiceId];
        require(
            _msgSender() == escrow.seller || _msgSender() == escrow.buyer,
            "Not party"
        );
        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");

        if (_msgSender() == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            escrow.buyerConfirmed = true;
        }

        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId) whenNotPaused external {
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

        require(escrow.status == EscrowStatus.Funded, "Escrow not funded");
        uint256 releaseAmount = escrow.amount;
        require(releaseAmount > 0, "No funds to release");

        escrow.status = EscrowStatus.Released;
        escrow.amount = 0;
        
        _payout(escrow.seller, escrow.token, releaseAmount);
        
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).safeTransferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }
        
        emit EscrowReleased(_invoiceId, releaseAmount);

        delete approvalStages[_invoiceId];
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
        Escrow memory escrow
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
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (address)
    {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (bytes calldata)
    {
        return ERC2771ContextUpgradeable._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(ERC2771ContextUpgradeable, ContextUpgradeable)
        returns (uint256)
    {
        return ERC2771ContextUpgradeable._contextSuffixLength();
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

    function setArbitratorsRegistry(address _registry) external onlyAdmin {
        require(_registry != address(0), "Invalid registry");
        arbitratorsRegistry = ArbitratorsRegistry(_registry);
    }

    function updateQuorumPercentage(uint256 _percentage) external onlyAdmin {
        require(_percentage > 0 && _percentage <= 100, "Invalid percentage");
        quorumPercentage = _percentage;
    }

    function voteOnDispute(bytes32 invoiceId, bool voteForBuyer)
        external
        whenNotPaused
        onlyArbitrator
    
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        DisputeVoting storage voting = disputeVotings[invoiceId];
        require(!voting.resolved, "Already resolved");
        require(!hasVoted[invoiceId][_msgSender()], "Already voted");

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

    function safeEscape(bytes32 invoiceId, bool sellerWins)
        external
        onlyAdmin
    
    {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        DisputeVoting storage voting = disputeVotings[invoiceId];
        require(!voting.resolved, "Already resolved");

        uint256 liveCount = arbitratorsRegistry.arbitratorCount();
        uint256 quorumRequired = (voting.snapshotArbitratorCount * quorumPercentage) / 100;

        require(liveCount < quorumRequired, "Quorum still possible");

        voting.resolved = true;
        _resolveEscrow(invoiceId, sellerWins);
        emit SafeEscape(invoiceId, _msgSender());
    }

    function _resolveEscrow(bytes32 invoiceId, bool sellerWins) internal {
        Escrow memory e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "Not disputed");

        delete escrows[invoiceId];

        e.disputeResolver = _msgSender();
        e.status = EscrowStatus.Released;

        address seller = e.seller;
        address buyer = e.buyer;
        uint256 amount = e.amount;
        uint256 fee = e.feeAmount;

        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);

        uint256 payoutAmount = e.amount;
        if (e.feeAmount > 0) {
            IERC20(e.token).safeTransfer(treasury, e.feeAmount);
            emit FeeCollected(invoiceId, fee);
            payoutAmount -= e.feeAmount;
        }

        IERC20(e.token).safeTransfer(sellerWins ? seller : buyer, payoutAmount);
        _transferNFT(address(this), sellerWins ? buyer : seller, e);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    /*//////////////////////////////////////////////////////////////
                    GOVERNANCE INTEGRATION FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function setGovernanceManager(address _governanceManager) external onlyAdmin {
        require(_governanceManager != address(0), "Invalid governance manager");
        governanceManager = _governanceManager;
        governanceEnabled = true;
        emit GovernanceManagerSet(_governanceManager);
    }

    function setGovernanceEnabled(bool _enabled) external onlyAdmin {
        governanceEnabled = _enabled;
        emit GovernanceEnabled(_enabled);
    }

    function setParameterChangeDelay(uint256 _delay) external onlyAdmin {
        require(_delay >= 1 days && _delay <= 30 days, "Invalid delay");
        parameterChangeDelay = _delay;
    }

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

    function getPendingChange(bytes32 parameterType) external view returns (
        uint256 newValue,
        uint256 executionTime,
        bool executed,
        bytes32 proposalId
    ) {
        PendingParameterChange storage change = pendingParameterChanges[parameterType];
        return (change.newValue, change.executionTime, change.executed, change.proposalId);
    }

    function isGovernanceActive() external view returns (bool) {
        return governanceEnabled && governanceManager != address(0);
    }

    /*//////////////////////////////////////////////////////////////
                    VERSION AND UPGRADE INFO
    //////////////////////////////////////////////////////////////*/
    
    /**
     * @notice Get the contract version
     * @return The current version number
     */
    function getVersion() external view returns (uint256) {
        return version;
    }
}
