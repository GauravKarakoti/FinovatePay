// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "./ComplianceManager.sol";
import "./ArbitratorsRegistry.sol";

contract EscrowContract is
    ReentrancyGuard,
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
        address token;
        EscrowStatus status;
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

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/
    event EscrowCreated(bytes32 indexed invoiceId, address seller, address buyer, uint256 amount);
    event DepositConfirmed(bytes32 indexed invoiceId, address buyer, uint256 amount);
    event EscrowReleased(bytes32 indexed invoiceId, uint256 amount);
    event DisputeRaised(bytes32 indexed invoiceId, address raisedBy, uint256 snapshotArbitratorCount);
    event ArbitratorVoted(bytes32 indexed invoiceId, address indexed arbitrator, bool votedForSeller);
    event DisputeResolved(bytes32 indexed invoiceId, bool sellerWins, uint256 finalVotesForSeller, uint256 finalVotesForBuyer);

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
            expiresAt: block.timestamp + _duration,
            rwaNftContract: _rwaNftContract,
            rwaTokenId: _rwaTokenId,
            snapshotArbitratorCount: 0,
            votesForSeller: 0,
            votesForBuyer: 0
        });

        emit EscrowCreated(invoiceId, seller, buyer, amount);
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

        delete escrows[invoiceId];
    }

    /*//////////////////////////////////////////////////////////////
                        ERC2771 OVERRIDES
    //////////////////////////////////////////////////////////////*/
    function _msgSender()
        internal
        view
        override(ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
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
}