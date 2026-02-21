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
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";


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
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;

    ComplianceManager public complianceManager;
    ArbitratorsRegistry public arbitratorsRegistry;

    address public admin;
    address public treasury;        // Platform treasury address for fee collection
    uint256 public feePercentage;   // Fee percentage in basis points (e.g., 50 = 0.5%)
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy);
    event DisputeResolved(bytes32 indexed invoiceId, address resolver, bool sellerWins);
    event FeeCollected(bytes32 indexed invoiceId, uint256 feeAmount);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event FeePercentageUpdated(uint256 oldFee, uint256 newFee);

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

        // Calculate fee amount
        uint256 calculatedFee = (_amount * feePercentage) / 10000; // Basis points calculation

        // --- NEW: Lock the Produce NFT as Collateral ---
        // The seller must have approved the EscrowContract to spend this NFT beforehand.
        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).transferFrom(
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
            feeAmount: calculatedFee
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
            IERC20(escrow.token).transferFrom(
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
        
        escrow.disputeResolver = msg.sender;
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: Get paid. Buyer gets the goods (NFT).
            require(token.transfer(escrow.seller, escrow.amount), "Transfer to seller failed");
            
            // Release NFT to Buyer (Ownership Transfer)
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
            }
        } else {
            // Buyer wins: Get refund. Seller gets the goods (NFT) back.
            require(token.transfer(escrow.buyer, escrow.amount), "Transfer to buyer failed");

            // Return NFT to Seller
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId); //
            }
        }
        
        emit DisputeResolved(_invoiceId, msg.sender, _sellerWins);
    }

    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        IERC20 token = IERC20(escrow.token);
        
        // Transfer funds to Seller
        require(token.transfer(escrow.seller, escrow.amount), "Transfer failed");
        
        // --- NEW: Release RWA NFT to Buyer ---
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId); //
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
            IERC20(token).transfer(to, amount);
        }
    }

    function _transferNFT(
        address from,
        address to,
        Escrow storage escrow
    ) internal {
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(
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
