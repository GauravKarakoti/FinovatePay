// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./ComplianceManager.sol";
import "./dao/Arbitrators_Registry.sol";


contract EscrowContract is
    ReentrancyGuard,
    Pausable,
    ERC2771Context,
    IERC721Receiver,
    EIP712
{

    using ECDSA for bytes32;

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
        uint256 feeAmount;
        address token;
        EscrowStatus status;
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        address rwaNftContract;
        uint256 rwaTokenId;
    }


    struct Proposal {
        address arbitrator;
        bool add;
        uint256 approvals;
        bool executed;
    }

    /*//////////////////////////////////////////////////////////////
                            STORAGE
    //////////////////////////////////////////////////////////////*/
    address public admin;
    address public treasury;
    address public keeper;
    uint256 public feeBasisPoints;

    ComplianceManager public complianceManager;

    mapping(bytes32 => Escrow) public escrows;

    // Meta-tx
    mapping(address => uint256) public nonces;
    bytes32 private constant META_TX_TYPEHASH =
        keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");

    // Multi-sig arbitrator governance
    address[] public managers;
    mapping(address => bool) public isManager;
    uint256 public threshold;

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public approved;
    mapping(address => bool) public isArbitrator;

    // Arbitrator Registry for dispute voting
    ArbitratorsRegistry public arbitratorsRegistry;

    // Dispute voting state
    struct DisputeVoting {
        uint256 snapshotArbitratorCount;
        uint256 votesForBuyer;
        uint256 votesForSeller;
        bool resolved;
    }
    mapping(bytes32 => DisputeVoting) public disputeVotings;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    // Minimum quorum required (percentage of snapshot count, e.g., 60 = 60%)
    uint256 public quorumPercentage = 60;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount, uint256 fee);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount, uint256 fee);
    event FeeCollected(bytes32 indexed invoiceId, uint256 feeAmount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);

    // Arbitrator voting events
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool voteForBuyer);
    event DisputeVotingResolved(bytes32 indexed invoiceId, bool sellerWins, uint256 buyerVotes, uint256 sellerVotes);
    event SafeEscape(bytes32 indexed invoiceId, address resolver);


    event ArbitratorProposed(uint256 indexed proposalId, address arbitrator, bool add);
    event ProposalApproved(uint256 indexed proposalId, address manager);
    event ProposalExecuted(uint256 indexed proposalId, address arbitrator, bool add);
    event ArbitratorAdded(address indexed arbitrator);
    event ArbitratorRemoved(address indexed arbitrator);

    event MetaTransactionExecuted(address indexed user, address indexed relayer, bytes functionSignature);

    /*//////////////////////////////////////////////////////////////
                                MODIFIERS
    //////////////////////////////////////////////////////////////*/
    modifier onlyAdmin() {
        require(_msgSender() == admin, "Not admin");
        _;
    }

    modifier onlyManager() {
        require(isManager[_msgSender()], "Not manager");
        _;
    }

    modifier onlyEscrowParty(bytes32 invoiceId) {
        Escrow storage e = escrows[invoiceId];
        require(_msgSender() == e.seller || _msgSender() == e.buyer, "Not party");
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
        address _complianceManager,
        address trustedForwarder,
        address[] memory _managers,
        uint256 _threshold
    )
        ERC2771Context(trustedForwarder)
        EIP712("EscrowContract", "1")
    {
        require(_managers.length > 0, "No managers");
        require(_threshold > 0 && _threshold <= _managers.length, "Bad threshold");

        admin = _msgSender();
        treasury = admin;
        keeper = admin;
        feeBasisPoints = 10; // Default 0.1% fee (10 basis points)

        complianceManager = ComplianceManager(_complianceManager);


        for (uint256 i; i < _managers.length; i++) {
            isManager[_managers[i]] = true;
            managers.push(_managers[i]);
        }

        threshold = _threshold;
    }

    /*//////////////////////////////////////////////////////////////
                            ESCROW LOGIC
    //////////////////////////////////////////////////////////////*/

    function createEscrow(
        bytes32 invoiceId,
        address seller,
        address buyer,
        uint256 amount,
        address token,
        uint256 duration,
        address rwaNft,
        uint256 rwaTokenId
    ) external onlyAdmin whenNotPaused {

        require(escrows[invoiceId].seller == address(0), "Exists");

        if (rwaNft != address(0)) {
            IERC721(rwaNft).transferFrom(seller, address(this), rwaTokenId);
        }

        escrows[invoiceId] = Escrow({
            seller: seller,
            buyer: buyer,
            amount: amount,
            token: token,
            status: EscrowStatus.Created,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + duration,
            rwaNftContract: rwaNft,
            rwaTokenId: rwaTokenId
        });

        emit EscrowCreated(invoiceId, seller, buyer, amount);
    }

    function deposit(bytes32 invoiceId) external nonReentrant whenNotPaused {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Created, "Inactive");
        require(_msgSender() == e.buyer, "Not buyer");

        uint256 fee = calculateFee(e.amount);
        uint256 totalAmount = e.amount + fee;

        IERC20(e.token).transferFrom(_msgSender(), address(this), totalAmount);

        e.feeAmount = fee;
        e.buyerConfirmed = true;
        e.status = EscrowStatus.Funded;

        emit DepositConfirmed(invoiceId, _msgSender(), e.amount, fee);
    }

    function calculateFee(uint256 amount) public view returns (uint256) {
        return (amount * feeBasisPoints) / 10000;
    }

    function setFeeBasisPoints(uint256 newFeeBasisPoints) external onlyAdmin {
        require(newFeeBasisPoints <= 50, "Fee too high"); // Max 0.5%
        feeBasisPoints = newFeeBasisPoints;
    }

    function setTreasury(address newTreasury) external onlyAdmin {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }


    function confirmRelease(bytes32 invoiceId)
        external
        nonReentrant
        whenNotPaused
        onlyEscrowParty(invoiceId)
    {

        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "Not funded");

        if (_msgSender() == e.seller) e.sellerConfirmed = true;
        else e.buyerConfirmed = true;

        if (e.sellerConfirmed && e.buyerConfirmed) {
            _releaseFunds(invoiceId);
        }
    }

    function raiseDispute(bytes32 invoiceId) external onlyEscrowParty(invoiceId) whenNotPaused {
        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Funded, "No dispute");

        e.status = EscrowStatus.Disputed;
        e.disputeRaised = true;

        // Initialize arbitrator voting with snapshot of current arbitrator count
        startArbitratorVoting(invoiceId);

        emit DisputeRaised(invoiceId, _msgSender());
    }

    /*//////////////////////////////////////////////////////////////
                        PAUSABLE FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }


    /*//////////////////////////////////////////////////////////////
                        DISPUTE RESOLUTION (CEI)
    //////////////////////////////////////////////////////////////*/
    function resolveDispute(bytes32 invoiceId, bool sellerWins)
        external
        whenNotPaused
        onlyAdmin
        nonReentrant
    {

        Escrow storage e = escrows[invoiceId];
        require(e.status == EscrowStatus.Disputed, "No dispute");

        // EFFECTS
        e.disputeResolver = _msgSender();
        e.status = EscrowStatus.Released;

        address seller = e.seller;
        address buyer = e.buyer;
        uint256 amount = e.amount;
        uint256 fee = e.feeAmount;
        address token = e.token;
        address nft = e.rwaNftContract;
        uint256 nftId = e.rwaTokenId;

        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);

        // INTERACTIONS
        // Transfer fee to treasury first
        if (fee > 0) {
            IERC20(token).transfer(treasury, fee);
            emit FeeCollected(invoiceId, fee);
        }

        // Transfer remaining amount to winner
        IERC20(token).transfer(sellerWins ? seller : buyer, amount);


        if (nft != address(0)) {
            IERC721(nft).transferFrom(
                address(this),
                sellerWins ? buyer : seller,
                nftId
            );
        }

        delete escrows[invoiceId];
    }

    function _releaseFunds(bytes32 invoiceId) internal {
        Escrow storage e = escrows[invoiceId];

        e.status = EscrowStatus.Released;

        address seller = e.seller;
        address buyer = e.buyer;
        uint256 amount = e.amount;
        uint256 fee = e.feeAmount;

        emit EscrowReleased(invoiceId, amount, fee);

        // Transfer fee to treasury
        if (fee > 0) {
            IERC20(e.token).transfer(treasury, fee);
            emit FeeCollected(invoiceId, fee);
        }

        // Transfer remaining amount to seller
        IERC20(e.token).transfer(seller, amount);

        if (e.rwaNftContract != address(0)) {
            IERC721(e.rwaNftContract).transferFrom(
                address(this),
                buyer,
                e.rwaTokenId
            );
        }

        delete escrows[invoiceId];
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

    /// @notice Vote on a dispute (only active arbitrators can vote)
    /// @param invoiceId The escrow invoice ID
    /// @param voteForBuyer True if voting for buyer, false for seller
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

        // Check if registry has shrunk - update snapshot if needed (Option B from acceptance criteria)
        uint256 currentLiveCount = arbitratorsRegistry.arbitratorCount();
        if (currentLiveCount < voting.snapshotArbitratorCount) {
            voting.snapshotArbitratorCount = currentLiveCount;
        }

        // Record the vote
        hasVoted[invoiceId][_msgSender()] = true;
        if (voteForBuyer) {
            voting.votesForBuyer += 1;
        } else {
            voting.votesForSeller += 1;
        }

        emit ArbitratorVoted(invoiceId, _msgSender(), voteForBuyer);

        // Check if quorum is reached and resolve automatically
        _checkAndResolveVoting(invoiceId);
    }

    /// @notice Check if quorum is reached and resolve the dispute
    /// @param invoiceId The escrow invoice ID
    function _checkAndResolveVoting(bytes32 invoiceId) internal {
        DisputeVoting storage voting = disputeVotings[invoiceId];
        if (voting.resolved) return;

        uint256 quorumRequired = (voting.snapshotArbitratorCount * quorumPercentage) / 100;
        uint256 totalVotes = voting.votesForBuyer + voting.votesForSeller;

        // Check if quorum is met
        if (totalVotes >= quorumRequired) {
            bool sellerWins = voting.votesForSeller > voting.votesForBuyer;
            voting.resolved = true;
            _resolveEscrow(invoiceId, sellerWins);
            emit DisputeVotingResolved(invoiceId, sellerWins, voting.votesForBuyer, voting.votesForSeller);
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
        address token = e.token;
        address nft = e.rwaNftContract;
        uint256 nftId = e.rwaTokenId;

        emit DisputeResolved(invoiceId, _msgSender(), sellerWins);

        // INTERACTIONS
        // Transfer fee to treasury first
        if (fee > 0) {
            IERC20(token).transfer(treasury, fee);
            emit FeeCollected(invoiceId, fee);
        }

        // Transfer remaining amount to winner
        IERC20(token).transfer(sellerWins ? seller : buyer, amount);

        if (nft != address(0)) {
            IERC721(nft).transferFrom(
                address(this),
                sellerWins ? buyer : seller,
                nftId
            );
        }

        delete escrows[invoiceId];
    }
}
