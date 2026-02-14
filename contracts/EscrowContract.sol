// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";

contract EscrowContract is ReentrancyGuard {
    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        address token; // The ERC20 payment token
        bool sellerConfirmed;
        bool buyerConfirmed;
        bool disputeRaised;
        address disputeResolver;
        uint256 createdAt;
        uint256 expiresAt;
        // RWA Collateral
        address rwaNftContract;
        uint256 rwaTokenId;
        // Issue #127 Fix: Arbitrator quorum snapshot
        uint256 snapshotArbitratorCount;
        uint256 votesForSeller;
        uint256 votesForBuyer;
    }
    
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    
    ComplianceManager public complianceManager;
    ArbitratorsRegistry public arbitratorsRegistry;
    address public admin;
    
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy, uint256 snapshotArbitratorCount);
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool votedForSeller);
    event DisputeResolved(bytes32 indexed invoiceId, bool sellerWins, uint256 finalVotesForSeller, uint256 finalVotesForBuyer);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }
    
    modifier onlyArbitrator() {
        require(arbitratorsRegistry.isArbitrator(msg.sender), "Not an authorized arbitrator");
        _;
    }
    
    modifier onlyCompliant(address _account) {
        require(!complianceManager.isFrozen(_account), "Account frozen");
        require(complianceManager.isKYCVerified(_account), "KYC not verified");
        require(complianceManager.hasIdentity(_account), "Identity not verified (No SBT)");
        _;
    }
    
    constructor(address _complianceManager, address _arbitratorsRegistry) {
        admin = msg.sender;
        complianceManager = ComplianceManager(_complianceManager);
        arbitratorsRegistry = ArbitratorsRegistry(_arbitratorsRegistry);
    }
    
    function createEscrow(
        bytes32 _invoiceId,
        address _seller,
        address _buyer,
        uint256 _amount,
        address _token,
        uint256 _duration,
        // --- RWA Parameters ---
        address _rwaNftContract,
        uint256 _rwaTokenId
    ) external onlyAdmin returns (bool) {
        require(escrows[_invoiceId].seller == address(0), "Escrow already exists");

        // Lock the Produce NFT as Collateral
        // The seller must have approved the EscrowContract beforehand
        if (_rwaNftContract != address(0)) {
            IERC721(_rwaNftContract).transferFrom(_seller, address(this), _rwaTokenId);
        }

        escrows[_invoiceId] = Escrow({
            seller: _seller,
            buyer: _buyer,
            amount: _amount,
            token: _token,
            sellerConfirmed: false,
            buyerConfirmed: false,
            disputeRaised: false,
            disputeResolver: address(0),
            createdAt: block.timestamp,
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId,
            snapshotArbitratorCount: 0,
            votesForSeller: 0,
            votesForBuyer: 0
        });

        emit EscrowCreated(_invoiceId, _seller, _buyer, _amount);
        return true;
    }
    
    function deposit(bytes32 _invoiceId, uint256 _amount) external nonReentrant onlyCompliant(msg.sender) {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.buyer == msg.sender, "Not the buyer");
        require(_amount == escrow.amount, "Incorrect amount");
        
        IERC20 token = IERC20(escrow.token);
        require(token.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        escrow.buyerConfirmed = true;
        emit DepositConfirmed(_invoiceId, msg.sender, _amount);
    }
    
    function confirmRelease(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party to this escrow");

        if (msg.sender == escrow.seller) {
            escrow.sellerConfirmed = true;
        } else {
            // Since the first require confirms the sender is either buyer or seller
            escrow.buyerConfirmed = true;
        }
        
        if (escrow.sellerConfirmed && escrow.buyerConfirmed) {
            _releaseFunds(_invoiceId);
        }
    }
    
    function raiseDispute(bytes32 _invoiceId) external {
        Escrow storage escrow = escrows[_invoiceId];
        require(msg.sender == escrow.seller || msg.sender == escrow.buyer, "Not a party to this escrow");
        require(!escrow.disputeRaised, "Dispute already raised");
        
        // SNAPSHOT arbitrator count when dispute is raised (Issue #127 Fix)
        escrow.snapshotArbitratorCount = arbitratorsRegistry.arbitratorCount();
        require(escrow.snapshotArbitratorCount > 0, "No arbitrators available");
        
        escrow.disputeRaised = true;
        emit DisputeRaised(_invoiceId, msg.sender, escrow.snapshotArbitratorCount);
    }
    
    // Arbitrator votes on a dispute
    function voteOnDispute(bytes32 _invoiceId, bool _voteForSeller) external onlyArbitrator {
        Escrow storage escrow = escrows[_invoiceId];
        require(escrow.disputeRaised, "No active dispute");
        require(!hasVoted[_invoiceId][msg.sender], "Already voted");
        
        // Record the vote
        hasVoted[_invoiceId][msg.sender] = true;
        
        if (_voteForSeller) {
            escrow.votesForSeller++;
        } else {
            escrow.votesForBuyer++;
        }
        
        emit ArbitratorVoted(_invoiceId, msg.sender, _voteForSeller);
        
        // Check if quorum is reached using snapshotted arbitrator count
        uint256 requiredVotes = (escrow.snapshotArbitratorCount / 2) + 1;
        
        if (escrow.votesForSeller >= requiredVotes) {
            _resolveDisputeInternal(_invoiceId, true);
        } else if (escrow.votesForBuyer >= requiredVotes) {
            _resolveDisputeInternal(_invoiceId, false);
        }
    }
    
    // Internal function to resolve dispute after quorum is reached
    function _resolveDisputeInternal(bytes32 _invoiceId, bool _sellerWins) private nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        
        // Mark dispute as resolved
        escrow.disputeRaised = false;
        escrow.disputeResolver = msg.sender;
        
        // Emit event before external calls
        emit DisputeResolved(_invoiceId, _sellerWins, escrow.votesForSeller, escrow.votesForBuyer);
        
        // Perform external calls
        IERC20 token = IERC20(escrow.token);

        if (_sellerWins) {
            // Seller wins: transfer payment and NFT to buyer
            require(token.transfer(escrow.seller, escrow.amount), "Transfer to seller failed");
            
            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
            }
        } else {
            // Buyer wins: refund payment and return NFT to seller
            require(token.transfer(escrow.buyer, escrow.amount), "Transfer to buyer failed");

            if (escrow.rwaNftContract != address(0)) {
                IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
            }
        }
    }
    
    // Get dispute voting status
    function getDisputeVotingStatus(bytes32 _invoiceId) external view returns (
        uint256 snapshotCount,
        uint256 votesForSeller,
        uint256 votesForBuyer,
        uint256 requiredVotes
    ) {
        Escrow storage escrow = escrows[_invoiceId];
        snapshotCount = escrow.snapshotArbitratorCount;
        votesForSeller = escrow.votesForSeller;
        votesForBuyer = escrow.votesForBuyer;
        requiredVotes = (snapshotCount / 2) + 1;
    }
    
    function _releaseFunds(bytes32 _invoiceId) internal {
        Escrow storage escrow = escrows[_invoiceId];
        IERC20 token = IERC20(escrow.token);
        
        // Transfer funds to Seller
        require(token.transfer(escrow.seller, escrow.amount), "Transfer failed");
        
        // Release RWA NFT to buyer
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.buyer, escrow.rwaTokenId);
        }
        
        emit EscrowReleased(_invoiceId, escrow.amount);
    }
    
    function expireEscrow(bytes32 _invoiceId) external nonReentrant {
        Escrow storage escrow = escrows[_invoiceId];
        require(block.timestamp >= escrow.expiresAt, "Escrow not expired");
        require(!escrow.sellerConfirmed || !escrow.buyerConfirmed, "Already confirmed");
        
        // Return NFT to seller on expiry
        if (escrow.rwaNftContract != address(0)) {
            IERC721(escrow.rwaNftContract).transferFrom(address(this), escrow.seller, escrow.rwaTokenId);
        }

        // Refund buyer if they deposited
        if (escrow.buyerConfirmed) {
            IERC20 token = IERC20(escrow.token);
            require(token.transfer(escrow.buyer, escrow.amount), "Refund failed");
        }
    }
}